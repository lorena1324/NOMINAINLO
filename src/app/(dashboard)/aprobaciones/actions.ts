'use server'

import { createClient } from '@/lib/supabase/server'
import { getUserProfile, requireAdminOrCoordinador, requirePerfil, getOperationFilter } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import {
    UMBRAL_CIERRE_AUTOMATICO_HORAS,
    fechaColombiaISO,
    horaColombia24,
    hoyColombiaISO,
    type ResultadoExtras,
} from '@/lib/asistencia'
import { requireAdmin } from '@/lib/auth'
import { cerrarQuincena } from '@/lib/cierreQuincena'

// ─── Cierre de incidencias por quincena ─────────────────────────────

export interface CierreResumen {
    id: string
    periodo_inicio: string
    periodo_fin: string
    automatico: boolean
    ejecutado_por: string
    aprobaciones_cerradas: number
    alertas_cerradas: number
    jornadas_pendientes: number
    created_at: string
}

/** Últimos cierres ejecutados (para mostrar el historial en el Panel de Control). */
export async function getCierresRecientes(): Promise<CierreResumen[]> {
    const supabase = await createClient()
    const profile = await getUserProfile()
    requirePerfil(profile)
    const { data, error } = await supabase
        .from('cierres_quincena')
        .select('id, periodo_inicio, periodo_fin, automatico, ejecutado_por, aprobaciones_cerradas, alertas_cerradas, jornadas_pendientes, created_at')
        .order('periodo_fin', { ascending: false })
        .limit(6)
    if (error) return []
    return (data ?? []) as CierreResumen[]
}

/**
 * Cierre manual de una quincena ya terminada (solo administrador).
 * Guarda respaldo, pasa a "No aprobada" las horas extra que seguían pendientes
 * y limpia las alertas del período. No toca ninguna marcación.
 */
export async function cerrarQuincenaManual(inicioISO: string, finISO: string) {
    const supabase = await createClient()
    const profile = await getUserProfile()
    requireAdmin(profile)

    const formato = /^\d{4}-\d{2}-\d{2}$/
    if (!formato.test(inicioISO) || !formato.test(finISO) || inicioISO > finISO) {
        return { success: false as const, error: 'El período no es válido.' }
    }
    if (finISO >= hoyColombiaISO()) {
        return { success: false as const, error: 'Solo se puede cerrar una quincena que ya terminó.' }
    }

    try {
        const resultado = await cerrarQuincena(supabase, {
            inicioISO,
            finISO,
            autor: profile.email,
            automatico: false,
        })
        revalidarVistas()
        return { success: true as const, resultado }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'No se pudo cerrar la quincena.'
        return { success: false as const, error: msg }
    }
}

/** "correo · AAAA-MM-DD HH:MM" — sello de quién y cuándo, para trazabilidad. */
function sello(email: string): string {
    const ahora = new Date()
    return `${email} · ${fechaColombiaISO(ahora)} ${horaColombia24(ahora)}`
}

function revalidarVistas(empleadoId?: string | null) {
    revalidatePath('/aprobaciones')
    revalidatePath('/asistencia')
    if (empleadoId) revalidatePath(`/empleados/${empleadoId}`)
}

/** Al resolver unas horas extra, su alerta deja de aparecer como pendiente. */
async function cerrarAlertaExtras(
    supabase: Awaited<ReturnType<typeof createClient>>,
    jornadaId: string | null,
) {
    if (!jornadaId) return
    await supabase
        .from('alertas')
        .update({ leida: true })
        .eq('jornada_id', jornadaId)
        .eq('tipo', 'EXTRAS_PENDIENTES')
}

export async function getAprobacionesPendientes() {
    const supabase = await createClient()
    const profile = await getUserProfile()
    requirePerfil(profile)
    const filtroOp = getOperationFilter(profile)

    const { data, error } = await supabase
        .from('aprobaciones_extras')
        .select(`
            id,
            minutos_solicitados,
            estado,
            created_at,
            empleado_id,
            jornada_id,
            jornadas ( entrada, salida, operacion, minutos_total ),
            usuarios!aprobaciones_extras_empleado_id_fkey ( nombre, operacion )
        `)
        .eq('estado', 'PENDIENTE')
        .order('created_at', { ascending: false })

    if (error) return { success: false, error: error.message, data: [] }

    const resultado = filtroOp.length > 0
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (data ?? []).filter((ap: any) => filtroOp.includes(ap.jornadas?.operacion))
        : (data ?? [])

    return { success: true, data: resultado }
}

/**
 * Aprueba unas horas extra dejando registrado CÓMO se reconocen:
 * pagadas en nómina, compensadas en tiempo o reconocidas por el cliente.
 */
export async function aprobarExtras(
    aprobacionId: string,
    nota?: string,
    resultado: ResultadoExtras = 'PAGADA_NOMINA',
) {
    const supabase = await createClient()
    const profile = await getUserProfile()
    requireAdminOrCoordinador(profile)

    if (!['PAGADA_NOMINA', 'COMPENSADA_TIEMPO', 'RECONOCIDA_CLIENTE'].includes(resultado)) {
        return { success: false, error: 'Indica cómo se reconocen las horas extra.' }
    }

    const { data, error } = await supabase
        .from('aprobaciones_extras')
        .update({
            estado: 'APROBADA',
            resultado,
            coordinador_id: profile.userId,
            nota_coordinador: `${nota?.trim() || 'Aprobada'} — ${sello(profile.email)}`,
            updated_at: new Date().toISOString(),
        })
        .eq('id', aprobacionId)
        .eq('estado', 'PENDIENTE')
        .select('jornada_id, empleado_id')
        .maybeSingle()

    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: 'Esta solicitud ya fue resuelta.' }
    await cerrarAlertaExtras(supabase, data.jornada_id)
    revalidarVistas(data.empleado_id)
    return { success: true }
}

export async function rechazarExtras(aprobacionId: string, nota: string) {
    const supabase = await createClient()
    const profile = await getUserProfile()
    requireAdminOrCoordinador(profile)

    if (!nota?.trim()) return { success: false, error: 'Escribe el motivo del rechazo.' }

    const { data, error } = await supabase
        .from('aprobaciones_extras')
        .update({
            estado: 'RECHAZADA',
            resultado: 'NO_APROBADA',
            coordinador_id: profile.userId,
            nota_coordinador: `${nota.trim()} — ${sello(profile.email)}`,
            updated_at: new Date().toISOString(),
        })
        .eq('id', aprobacionId)
        .eq('estado', 'PENDIENTE')
        .select('jornada_id, empleado_id')
        .maybeSingle()

    if (error) return { success: false, error: error.message }
    if (!data) return { success: false, error: 'Esta solicitud ya fue resuelta.' }
    await cerrarAlertaExtras(supabase, data.jornada_id)
    revalidarVistas(data.empleado_id)
    return { success: true }
}

export async function getJornadasInconsistentes() {
    const supabase = await createClient()
    const profile = await getUserProfile()
    requirePerfil(profile)
    const filtroOp = getOperationFilter(profile)

    // Cierre automático al consultar: toda jornada abierta por más de 15 h pasa
    // a "por validar" de inmediato, sin esperar al proceso nocturno.
    const limite = new Date(Date.now() - UMBRAL_CIERRE_AUTOMATICO_HORAS * 60 * 60 * 1000).toISOString()
    let vencidas = supabase
        .from('jornadas')
        .select('id, empleado_id, operacion')
        .eq('estado', 'ABIERTO')
        .lt('entrada', limite)
    if (filtroOp.length > 0) vencidas = vencidas.in('operacion', filtroOp)
    const { data: porCerrar } = await vencidas
    if (porCerrar && porCerrar.length > 0) {
        const { marcarCierreAutomatico } = await import('@/lib/jornadas')
        for (const j of porCerrar) await marcarCierreAutomatico(j)
    }

    let query = supabase
        .from('jornadas')
        .select(`
            id,
            empleado_id,
            operacion,
            entrada,
            estado,
            created_at,
            usuarios!jornadas_empleado_id_fkey (
                nombre
            )
        `)
        .eq('estado', 'INCONSISTENTE')
        .order('entrada', { ascending: false })

    if (filtroOp.length > 0) query = query.in('operacion', filtroOp)

    const { data, error } = await query
    if (error) return { success: false, error: error.message, data: [] }
    return { success: true, data: data ?? [] }
}

/**
 * Corrige una jornada sin salida (cierre automático o abierta) registrando la
 * hora real de salida. El motivo es obligatorio y queda guardado junto con el
 * usuario, la fecha y la hora de la corrección.
 */
export async function corregirInconsistente(jornadaId: string, horaSalidaISO: string, motivo: string) {
    const supabase = await createClient()
    const profile = await getUserProfile()
    requireAdminOrCoordinador(profile)

    if (!motivo?.trim()) return { success: false, error: 'Escribe el motivo de la corrección.' }
    const salida = new Date(horaSalidaISO)
    if (Number.isNaN(salida.getTime())) return { success: false, error: 'La hora de salida no es válida.' }

    // El coordinador solo corrige jornadas de su operación
    const filtroOp = getOperationFilter(profile)
    if (filtroOp.length > 0) {
        const { data: j } = await supabase.from('jornadas').select('operacion').eq('id', jornadaId).maybeSingle()
        if (!j || !filtroOp.includes(j.operacion)) {
            return { success: false, error: 'Solo puedes corregir jornadas de tu operación.' }
        }
    }

    const { corregirJornadaInconsistente } = await import('@/lib/jornadas')
    const { data, error } = await corregirJornadaInconsistente(jornadaId, salida, {
        autor: profile.email,
        motivo: motivo.trim(),
    })
    if (error || !data) return { success: false, error: error ?? 'Error al corregir jornada' }

    revalidarVistas(data.empleado_id)
    return { success: true }
}

/**
 * Marca como revisada una alerta informativa (por ejemplo "Jornada >12h").
 * Guarda quién la revisó, cuándo y la justificación.
 */
export async function marcarAlertaRevisada(alertaId: string, motivo: string) {
    const supabase = await createClient()
    const profile = await getUserProfile()
    requireAdminOrCoordinador(profile)

    if (!motivo?.trim()) return { success: false, error: 'Escribe la justificación.' }

    const { data: alerta } = await supabase
        .from('alertas')
        .select('id, mensaje, empleado_id, operacion')
        .eq('id', alertaId)
        .maybeSingle()
    if (!alerta) return { success: false, error: 'La alerta no existe.' }

    const filtroOp = getOperationFilter(profile)
    if (filtroOp.length > 0 && alerta.operacion && !filtroOp.includes(alerta.operacion)) {
        return { success: false, error: 'Solo puedes gestionar alertas de tu operación.' }
    }

    const { error } = await supabase
        .from('alertas')
        .update({
            leida: true,
            mensaje: `${alerta.mensaje ?? ''} | Revisada por ${sello(profile.email)}. Justificación: ${motivo.trim()}`,
        })
        .eq('id', alertaId)

    if (error) return { success: false, error: error.message }
    revalidarVistas(alerta.empleado_id)
    return { success: true }
}
