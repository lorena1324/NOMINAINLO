import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { toColombiaTime } from '@/lib/calculoHoras'
import { UMBRAL_CIERRE_AUTOMATICO_HORAS, hoyColombiaISO } from '@/lib/asistencia'
import { aplicarCambiosOperacionPendientes } from '@/lib/cambiosOperacion'
import { cerrarQuincena, quincenaACerrarAutomaticamente } from '@/lib/cierreQuincena'
import { limpiarFotosVencidas } from '@/lib/fotos'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Cierre automático: jornadas abiertas por más de 15 h (ver src/lib/asistencia.ts)
const UMBRAL_INCONSISTENTE_HORAS = UMBRAL_CIERRE_AUTOMATICO_HORAS
const MINUTOS_SEMANA_PACTADOS = 44 * 60 // 2640

/**
 * Cron diario (`0 0 * * *` UTC ≈ 19:00 hora Colombia).
 *
 * Tareas:
 *  1. Marcar como INCONSISTENTE toda jornada ABIERTO con >16h transcurridas.
 *  2. Si ayer (hora Colombia) fue domingo, ejecutar el cierre dominical:
 *     calcula el cumplimiento semanal de cada empleado activo y actualiza
 *     `semanas_dominicales.paga_domingo`.
 */
export async function GET(request: NextRequest) {
    try {
        // Autenticación del cron
        const authHeader = request.headers.get('authorization')
        if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json(
                { success: false, error: 'Missing SUPABASE env vars' },
                { status: 500 },
            )
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        const ahora = new Date()

        // ─── 1. Detectar jornadas INCONSISTENTES ─────────────────
        const umbralMs = UMBRAL_INCONSISTENTE_HORAS * 60 * 60 * 1000

        const { data: jornadasAbiertas, error: errJornadas } = await supabase
            .from('jornadas')
            .select('id, empleado_id, operacion, entrada')
            .eq('estado', 'ABIERTO')

        if (errJornadas) {
            return NextResponse.json({ success: false, error: errJornadas.message }, { status: 500 })
        }

        const inconsistentes: string[] = []

        for (const j of jornadasAbiertas ?? []) {
            const transcurridoMs = ahora.getTime() - new Date(j.entrada).getTime()
            if (transcurridoMs < umbralMs) continue // turno noche válido aún

            await supabase
                .from('jornadas')
                .update({ estado: 'INCONSISTENTE' })
                .eq('id', j.id)
                .eq('estado', 'ABIERTO')

            await supabase.from('alertas').insert({
                tipo: 'INCONSISTENTE',
                empleado_id: j.empleado_id,
                jornada_id: j.id,
                operacion: j.operacion,
                mensaje: `Cierre automático: jornada abierta por más de ${UMBRAL_INCONSISTENTE_HORAS}h sin salida registrada.`,
            })

            inconsistentes.push(j.id)
        }

        // ─── 2. Cierre dominical (si ayer fue domingo en Colombia) ─
        const ahoraBogota = toColombiaTime(ahora)
        const ayerBogota = new Date(ahoraBogota.getTime() - 24 * 60 * 60 * 1000)
        const ayerFueDomingo = ayerBogota.getUTCDay() === 0
        let resumenDominical: {
            semana_inicio: string
            semana_fin: string
            empleados_procesados: number
        } | null = null

        if (ayerFueDomingo) {
            // Domingo (fin de semana) = ayerBogota; lunes = domingo - 6 días
            const domingo = new Date(ayerBogota)
            domingo.setUTCHours(0, 0, 0, 0)
            const lunes = new Date(domingo)
            lunes.setUTCDate(lunes.getUTCDate() - 6)

            const semanaInicio = lunes.toISOString().slice(0, 10)
            const semanaFin = domingo.toISOString().slice(0, 10)

            // Rango UTC que cubre lunes 00:00 a domingo 23:59 hora Colombia.
            // La zona Colombia es UTC-5, así que: lunes Colombia 00:00 = lunes UTC 05:00.
            const inicioUTC = new Date(lunes.getTime() + 5 * 60 * 60 * 1000)
            const finUTC = new Date(
                domingo.getTime() + 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000,
            )

            const { data: empleados } = await supabase
                .from('usuarios')
                .select('id')
                .eq('status', 'activo')

            let procesados = 0

            for (const emp of empleados ?? []) {
                // Minutos ordinarios de la semana: suma de los 5 tipos NO-extra
                const { data: jornadasSemana } = await supabase
                    .from('jornadas')
                    .select(
                        'minutos_normales, minutos_nocturnas, minutos_domingos, minutos_festivos, minutos_domingos_festivos_nocturnos',
                    )
                    .eq('empleado_id', emp.id)
                    .in('estado', ['CERRADO', 'CERRADO_MANUAL'])
                    .gte('entrada', inicioUTC.toISOString())
                    .lt('entrada', finUTC.toISOString())

                const minutosOrdinarios = (jornadasSemana ?? []).reduce(
                    (acc, j) =>
                        acc +
                        (j.minutos_normales ?? 0) +
                        (j.minutos_nocturnas ?? 0) +
                        (j.minutos_domingos ?? 0) +
                        (j.minutos_festivos ?? 0) +
                        (j.minutos_domingos_festivos_nocturnos ?? 0),
                    0,
                )

                // Novedades remuneradas que intersectan la semana
                const { data: novedades } = await supabase
                    .from('novedades')
                    .select('fecha_novedad, fecha_inicio, fecha_fin')
                    .eq('usuario_id', emp.id)
                    .eq('es_pagado', true)

                let minutosNovedades = 0
                for (const nov of novedades ?? []) {
                    // Novedad por rango
                    if (nov.fecha_inicio && nov.fecha_fin) {
                        const ini = new Date(
                            Math.max(
                                new Date(nov.fecha_inicio).getTime(),
                                lunes.getTime(),
                            ),
                        )
                        const fin = new Date(
                            Math.min(
                                new Date(nov.fecha_fin).getTime(),
                                domingo.getTime(),
                            ),
                        )
                        if (fin.getTime() >= ini.getTime()) {
                            const dias =
                                Math.floor((fin.getTime() - ini.getTime()) / 86400000) + 1
                            minutosNovedades += Math.max(0, dias) * 480
                        }
                    } else if (nov.fecha_novedad) {
                        const f = new Date(nov.fecha_novedad)
                        if (f.getTime() >= lunes.getTime() && f.getTime() <= domingo.getTime()) {
                            minutosNovedades += 480
                        }
                    }
                }

                const pagaDomingo =
                    minutosOrdinarios + minutosNovedades >= MINUTOS_SEMANA_PACTADOS

                await supabase
                    .from('semanas_dominicales')
                    .upsert(
                        {
                            empleado_id: emp.id,
                            semana_inicio: semanaInicio,
                            semana_fin: semanaFin,
                            minutos_ordinarios: minutosOrdinarios,
                            minutos_novedades_remuneradas: minutosNovedades,
                            paga_domingo: pagaDomingo,
                            marcado_por: 'sistema',
                        },
                        { onConflict: 'empleado_id,semana_inicio' },
                    )

                procesados++
            }

            resumenDominical = {
                semana_inicio: semanaInicio,
                semana_fin: semanaFin,
                empleados_procesados: procesados,
            }
        }

        // Cada tarea adicional va en su propio try: si una falla, las demás siguen.

        // ─── 3. Cambios de operación programados que ya entran en vigencia ─
        let cambiosOperacion = 0
        try {
            cambiosOperacion = await aplicarCambiosOperacionPendientes(supabase)
        } catch (e) {
            console.error('[CRON] cambios de operación:', e)
        }

        // ─── 4. Cierre de incidencias por quincena (días 1 y 16) ─────────
        let cierreQuincena: Awaited<ReturnType<typeof cerrarQuincena>> | null = null
        try {
            const aCerrar = quincenaACerrarAutomaticamente(hoyColombiaISO(ahora))
            if (aCerrar) {
                cierreQuincena = await cerrarQuincena(supabase, {
                    inicioISO: aCerrar.start,
                    finISO: aCerrar.end,
                    autor: 'sistema',
                    automatico: true,
                })
            }
        } catch (e) {
            console.error('[CRON] cierre de quincena:', e)
        }

        // ─── 5. Fotos que cumplieron el período de retención ─────────────
        let fotosEliminadas = 0
        try {
            fotosEliminadas = await limpiarFotosVencidas()
        } catch (e) {
            console.error('[CRON] limpieza de fotos:', e)
        }

        console.log(
            `[CRON ${ahora.toISOString()}] inconsistentes=${inconsistentes.length} dominical=${ayerFueDomingo ? 'sí' : 'no'} cambiosOperacion=${cambiosOperacion} cierreQuincena=${cierreQuincena ? 'sí' : 'no'} fotosEliminadas=${fotosEliminadas}`,
        )

        return NextResponse.json({
            success: true,
            timestamp: ahora.toISOString(),
            inconsistentes_marcadas: inconsistentes.length,
            ids_inconsistentes: inconsistentes,
            cierre_dominical: resumenDominical,
            cambios_operacion_aplicados: cambiosOperacion,
            cierre_quincena: cierreQuincena,
            fotos_eliminadas: fotosEliminadas,
        })
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error'
        console.error('[CRON] Error:', msg)
        return NextResponse.json({ success: false, error: msg }, { status: 500 })
    }
}
