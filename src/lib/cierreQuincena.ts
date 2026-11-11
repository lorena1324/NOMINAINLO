/**
 * Cierre de incidencias por quincena ("reinicio controlado").
 *
 * Qué hace al cerrar un período:
 *  1. Guarda un respaldo completo de lo que va a cerrar (tabla `cierres_quincena`).
 *  2. Las horas extra que seguían PENDIENTES de ese período pasan a
 *     "No aprobada": ya no vuelven a pedir autorización en la quincena actual.
 *  3. Las alertas informativas de ese período salen de la bandeja.
 *
 * Qué NO hace:
 *  - No borra ni modifica ninguna marcación (jornada).
 *  - No toca las jornadas sin salida: quedan "pendientes de cierre" hasta que
 *    alguien autorizado registre la hora real.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { quincenaDeFecha, moverQuincena, rangoUTCDeDias, type Quincena } from '@/lib/asistencia'
import { registrarAuditoria } from '@/lib/auditoria'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any, any, any>

export interface ResultadoCierre {
    yaExistia: boolean
    periodo: { inicio: string; fin: string }
    aprobacionesCerradas: number
    alertasCerradas: number
    jornadasPendientes: number
}

/**
 * Quincena que el proceso automático debe cerrar en una fecha dada, o `null`
 * si ese día no hay cierre.
 *
 * Se deja una quincena completa de margen para que los coordinadores alcancen
 * a aprobar: el día 16 se cierra la segunda quincena del mes anterior, y el
 * día 1 se cierra la primera quincena del mes anterior.
 */
export function quincenaACerrarAutomaticamente(hoyISO: string): Quincena | null {
    const dia = Number(hoyISO.slice(8, 10))
    if (dia !== 1 && dia !== 16) return null
    const actual = quincenaDeFecha(hoyISO)      // la que empieza hoy
    const anterior = moverQuincena(actual, -1)  // la que acaba de terminar (aún en margen)
    return moverQuincena(anterior, -1)          // la que ya debe estar liquidada y pagada
}

/**
 * Cierra las incidencias abiertas de TODO lo anterior o igual a `finISO`
 * (así también recoge pendientes viejos que hayan quedado de períodos previos).
 */
export async function cerrarQuincena(
    supabase: Cliente,
    args: { inicioISO: string; finISO: string; autor: string; automatico: boolean },
): Promise<ResultadoCierre> {
    const periodo = { inicio: args.inicioISO, fin: args.finISO }

    // Un período se cierra una sola vez
    const { data: previo } = await supabase
        .from('cierres_quincena')
        .select('id, aprobaciones_cerradas, alertas_cerradas, jornadas_pendientes')
        .eq('periodo_inicio', args.inicioISO)
        .eq('periodo_fin', args.finISO)
        .maybeSingle()
    if (previo) {
        return {
            yaExistia: true,
            periodo,
            aprobacionesCerradas: previo.aprobaciones_cerradas,
            alertasCerradas: previo.alertas_cerradas,
            jornadasPendientes: previo.jornadas_pendientes,
        }
    }

    // Corte: fin del último día del período, hora Colombia
    const { finUTC } = rangoUTCDeDias(args.inicioISO, args.finISO)
    const corte = finUTC.toISOString()

    // ─── 1. Qué se va a cerrar ──────────────────────────────────
    const { data: pendientes, error: errAp } = await supabase
        .from('aprobaciones_extras')
        .select('id, jornada_id, empleado_id, minutos_solicitados, estado, created_at, jornadas ( entrada, operacion )')
        .eq('estado', 'PENDIENTE')
    if (errAp) throw new Error(errAp.message)

    const aprobaciones = (pendientes ?? []).filter((p) => {
        const j = Array.isArray(p.jornadas) ? p.jornadas[0] : p.jornadas
        const referencia = (j as { entrada?: string } | null)?.entrada ?? p.created_at
        return referencia < corte
    })

    const { data: alertas, error: errAl } = await supabase
        .from('alertas')
        .select('id, tipo, empleado_id, jornada_id, operacion, mensaje, created_at')
        .eq('leida', false)
        .in('tipo', ['EXTRAS_PENDIENTES', 'ALERTA_CRITICA'])
        .lt('created_at', corte)
    if (errAl) throw new Error(errAl.message)

    const { count: jornadasPendientes } = await supabase
        .from('jornadas')
        .select('id', { count: 'exact', head: true })
        .in('estado', ['ABIERTO', 'INCONSISTENTE'])
        .lt('entrada', corte)

    // ─── 2. Respaldo ANTES de modificar ─────────────────────────
    const { data: cierre, error: errCierre } = await supabase
        .from('cierres_quincena')
        .insert({
            periodo_inicio: args.inicioISO,
            periodo_fin: args.finISO,
            automatico: args.automatico,
            ejecutado_por: args.autor,
            aprobaciones_cerradas: aprobaciones.length,
            alertas_cerradas: (alertas ?? []).length,
            jornadas_pendientes: jornadasPendientes ?? 0,
            respaldo: { aprobaciones, alertas: alertas ?? [] },
        })
        .select('id')
        .single()
    if (errCierre || !cierre) throw new Error(errCierre?.message ?? 'No se pudo guardar el respaldo del cierre.')

    // ─── 3. Cerrar ──────────────────────────────────────────────
    const nota = `Cierre de quincena ${args.inicioISO} a ${args.finISO}: no fue aprobada dentro del período — ${args.autor}`
    const idsAprobaciones = aprobaciones.map((a) => a.id)
    for (let i = 0; i < idsAprobaciones.length; i += 200) {
        const { error } = await supabase
            .from('aprobaciones_extras')
            .update({
                estado: 'RECHAZADA',
                resultado: 'NO_APROBADA',
                nota_coordinador: nota,
                updated_at: new Date().toISOString(),
            })
            .in('id', idsAprobaciones.slice(i, i + 200))
        if (error) throw new Error(error.message)
    }

    const idsAlertas = (alertas ?? []).map((a) => a.id)
    for (let i = 0; i < idsAlertas.length; i += 200) {
        const { error } = await supabase
            .from('alertas')
            .update({ leida: true })
            .in('id', idsAlertas.slice(i, i + 200))
        if (error) throw new Error(error.message)
    }

    await registrarAuditoria(supabase, {
        accion: 'CIERRE_QUINCENA',
        entidad: 'quincena',
        entidadId: cierre.id,
        autor: args.autor,
        motivo: args.automatico ? 'Cierre automático programado' : 'Cierre manual',
        detalle: {
            periodo,
            aprobaciones_cerradas: aprobaciones.length,
            alertas_cerradas: idsAlertas.length,
            jornadas_pendientes: jornadasPendientes ?? 0,
        },
    })

    return {
        yaExistia: false,
        periodo,
        aprobacionesCerradas: aprobaciones.length,
        alertasCerradas: idsAlertas.length,
        jornadasPendientes: jornadasPendientes ?? 0,
    }
}
