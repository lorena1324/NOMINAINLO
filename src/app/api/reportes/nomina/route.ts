import { NextRequest, NextResponse } from 'next/server'
import { toColombiaTime } from '@/lib/calculoHoras'
import { generarExcelNomina, type LineaNomina, type TarifaConCodigo } from '@/lib/excel/nomina'
import { fechaISOaDateUTC } from '@/lib/asistencia'
import {
    construirMallaAsistencia,
    resumirRetardos,
    ETIQUETA_ESTADO_DIA,
    type FilaAsistencia,
} from '@/lib/asistenciaDatos'
import { contextoReporte, esFechaISO, respuestaExcel } from '@/lib/reportesAuth'

function minToRoundedHours(min: number): number {
    if (!min || min <= 0) return 0
    const remainder = min % 60
    const base = Math.floor(min / 60)
    return remainder >= 30 ? base + 1 : base
}

export const dynamic = 'force-dynamic'

function horaEnteraColombia(fechaUTC: Date): number {
    return toColombiaTime(fechaUTC).getUTCHours()
}

/** Texto de la columna "POR VALIDAR": excepciones que el coordinador debe revisar. */
function textoValidar(f: FilaAsistencia): string {
    const notas: string[] = []
    if (f.estado === 'PENDIENTE') notas.push('Salida pendiente: las horas aún no se liquidan')
    if (f.estado === 'CIERRE_AUTOMATICO') notas.push('Sin salida registrada: horas no pagables hasta validar')
    if (f.operacionDistinta) notas.push(`Marcó en operación distinta a la asignada (${f.colaborador.operacion})`)
    if (f.timbradaConNovedad) notas.push('Marcó asistencia en un día con novedad')
    if (f.jornada?.alerta_critica) notas.push('Jornada mayor a 12 h')
    if (f.jornada?.fuera_geocerca) notas.push('Marcación fuera de geocerca o sin ubicación')
    if (f.jornada?.marcacion_offline) notas.push('Marcación hecha sin conexión')
    return notas.join(' · ')
}

// ════════════════════════════════════════════════════════════════════
// GET /api/reportes/nomina?start=YYYY-MM-DD&end=YYYY-MM-DD&op=OP1,OP2
//
// Una fila por colaborador y por día, de corrido (incluye domingos):
//  - Día trabajado: horas liquidadas (igual que antes).
//  - Día en curso o sin salida: aparece con salida pendiente y sin sumar horas.
//  - Día sin marcación: fila en 0 con estado "Sin asistencia" o la novedad.
// ════════════════════════════════════════════════════════════════════

export async function GET(request: NextRequest) {
    try {
        const ctx = await contextoReporte(request)
        if (!ctx.ok) return ctx.response
        const { supabase, operaciones } = ctx

        const { searchParams } = new URL(request.url)
        const startParam = searchParams.get('start')
        const endParam = searchParams.get('end')

        if (!esFechaISO(startParam) || !esFechaISO(endParam)) {
            return NextResponse.json({ error: 'Faltan parámetros start y end (AAAA-MM-DD).' }, { status: 400 })
        }
        if (startParam > endParam) {
            return NextResponse.json({ error: 'La fecha inicial es posterior a la final.' }, { status: 400 })
        }

        const malla = await construirMallaAsistencia(supabase, {
            start: startParam,
            end: endParam,
            operaciones,
        })

        // ─── Tarifas con código de nómina ───────────────────────
        const { data: tarifas } = await supabase
            .from('tarifas')
            .select('tipo_hora, precio_por_hora, codigo_nomina')
            .eq('activo', true)

        const tarifasConCodigo: TarifaConCodigo[] = (tarifas ?? []).map((t) => ({
            tipo_hora: t.tipo_hora,
            precio_por_hora: parseFloat(t.precio_por_hora),
            codigo_nomina: t.codigo_nomina,
        }))

        // ─── Armar líneas ───────────────────────────────────────
        const lineas: LineaNomina[] = []

        for (const f of malla.filas) {
            const j = f.jornada
            // Solo las jornadas cerradas suman horas; pendientes y cierres automáticos van en 0.
            const liquidada = !!j && (j.estado === 'CERRADO' || j.estado === 'CERRADO_MANUAL')

            let horaIn = 0
            let horaOut: number | null = 0
            let horas = 0
            if (j) {
                horaIn = horaEnteraColombia(new Date(j.entrada))
                if (liquidada && j.salida) {
                    horaOut = horaEnteraColombia(new Date(j.salida))
                    horas = horaOut >= horaIn ? horaOut - horaIn : 24 - horaIn + horaOut
                } else {
                    horaOut = null
                }
            }

            const base: Omit<LineaNomina, 'novedad' | 'detalleNovedad'> = {
                fecha: fechaISOaDateUTC(f.fecha),
                cargo: f.colaborador.cargo ?? '',
                cedula: f.colaborador.id,
                nombre: f.colaborador.nombre,
                horaIn,
                horaOut,
                almuerzo: liquidada ? minToRoundedHours(j!.minutos_almuerzo_descontados) : 0,
                horas,
                extraDiurna: liquidada ? minToRoundedHours(j!.minutos_extras_ordinarias) : 0,
                extraNocturna: liquidada ? minToRoundedHours(j!.minutos_extras_nocturnas) : 0,
                extraFestivaDiurna: liquidada ? minToRoundedHours(j!.minutos_extras_dominical_festivo) : 0,
                extraFestivaNocturna: liquidada ? minToRoundedHours(j!.minutos_extras_nocturna_dominical_festivo) : 0,
                recargoNocturno: liquidada ? minToRoundedHours(j!.minutos_nocturnas) : 0,
                recargoFestivoNocturno: liquidada ? minToRoundedHours(j!.minutos_domingos_festivos_nocturnos) : 0,
                recargoFestivo: liquidada ? minToRoundedHours((j!.minutos_festivos ?? 0) + (j!.minutos_domingos ?? 0)) : 0,
                operacion: f.operacion,
                codigoOperacion: malla.codigoOperacion.get(f.operacion) ?? '',
                detalleOperacion: '',
                estado: ETIQUETA_ESTADO_DIA[f.estado],
                domingo: f.esDomingo,
                festivo: f.esFestivo,
                inasistencia: f.inasistencia,
                retardoMin: f.retardoMin,
                turno: f.turnoNombre,
                validar: textoValidar(f),
            }

            if (f.novedades.length > 0) {
                // Igual que antes: una fila por cada novedad del día
                for (const nov of f.novedades) {
                    lineas.push({ ...base, novedad: nov.tipo, detalleNovedad: nov.detalle })
                }
            } else {
                lineas.push({ ...base, novedad: '', detalleNovedad: '' })
            }
        }

        const buffer = await generarExcelNomina(lineas, tarifasConCodigo, resumirRetardos(malla.filas))
        return respuestaExcel(buffer, `nomina_${startParam}_${endParam}.xlsx`)
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error interno'
        console.error('[API /reportes/nomina]', err)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
