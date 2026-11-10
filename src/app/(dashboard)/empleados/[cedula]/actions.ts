'use server'

import { createClient } from '@/lib/supabase/server'

export async function getEmpleadoDetalle(cedula: string) {
    const supabase = await createClient()

    const { data: empleado, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('id', cedula)
        .maybeSingle()

    if (error) {
        console.error('[getEmpleadoDetalle]', error)
        return null
    }
    return empleado
}

/**
 * Jornadas del empleado en un rango (por fecha de entrada).
 * Trae el snapshot completo de minutos + estado para mostrar desglose por día.
 */
export async function getJornadasRango(
    cedula: string,
    fechaInicio: string,
    fechaFin: string,
) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('jornadas')
        .select(
            'id, empleado_id, operacion, entrada, salida, estado, minutos_total, minutos_normales, minutos_nocturnas, minutos_domingos, minutos_festivos, minutos_domingos_festivos_nocturnos, minutos_extras_ordinarias, minutos_extras_nocturnas, minutos_extras_dominical_festivo, minutos_extras_nocturna_dominical_festivo, minutos_almuerzo_descontados, cerrada_por, alerta_critica',
        )
        .eq('empleado_id', cedula)
        .gte('entrada', fechaInicio)
        .lte('entrada', fechaFin)
        .order('entrada', { ascending: false })

    if (error) {
        console.error('[getJornadasRango]', error)
        return []
    }
    return data ?? []
}

export async function getNovedadesEmpleado(cedula: string, limite = 20) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('novedades')
        .select(
            'id, tipo_novedad, fecha_novedad, fecha_inicio, fecha_fin, es_pagado, codigo_causa, valor_monetario, descripcion, created_at',
        )
        .eq('usuario_id', cedula)
        .order('fecha_novedad', { ascending: false })
        .limit(limite)

    if (error) return []
    return data ?? []
}

export async function getMovimientosBolsa(cedula: string, limite = 15) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('movimientos_bolsa')
        .select(
            'id, minutos, motivo, saldo_antes, saldo_despues, nota, created_at, jornada_id, novedad_id',
        )
        .eq('empleado_id', cedula)
        .order('created_at', { ascending: false })
        .limit(limite)

    if (error) return []
    return data ?? []
}

/**
 * Aprobaciones de extras del empleado (últimas N, ordenadas por estado y fecha).
 */
export async function getAprobacionesEmpleado(cedula: string, limite = 10) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('aprobaciones_extras')
        .select(
            'id, jornada_id, minutos_solicitados, estado, coordinador_id, nota_coordinador, created_at, updated_at',
        )
        .eq('empleado_id', cedula)
        .order('created_at', { ascending: false })
        .limit(limite)

    if (error) return []
    return data ?? []
}

/**
 * Alertas no leídas del empleado.
 */
export async function getAlertasEmpleado(cedula: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('alertas')
        .select('id, tipo, jornada_id, operacion, mensaje, leida, created_at')
        .eq('empleado_id', cedula)
        .eq('leida', false)
        .order('created_at', { ascending: false })

    if (error) return []
    const alertas = data ?? []
    if (alertas.length === 0) return []

    // Datos de la jornada de cada alerta (para poder corregir desde el perfil)
    const idsJornada = Array.from(new Set(alertas.map((a) => a.jornada_id).filter(Boolean))) as string[]
    const jornadaPorId = new Map<string, { entrada: string; estado: string }>()
    const aprobacionPorJornada = new Map<string, string>()
    if (idsJornada.length > 0) {
        const { data: js } = await supabase.from('jornadas').select('id, entrada, estado').in('id', idsJornada)
        for (const j of js ?? []) jornadaPorId.set(j.id, { entrada: j.entrada, estado: j.estado })

        const { data: aps } = await supabase
            .from('aprobaciones_extras')
            .select('id, jornada_id')
            .eq('estado', 'PENDIENTE')
            .in('jornada_id', idsJornada)
        for (const ap of aps ?? []) aprobacionPorJornada.set(ap.jornada_id, ap.id)
    }

    return alertas
        .map((a) => ({
            ...a,
            jornada: a.jornada_id ? (jornadaPorId.get(a.jornada_id) ?? null) : null,
            aprobacionId: a.jornada_id ? (aprobacionPorJornada.get(a.jornada_id) ?? null) : null,
        }))
        // Se ocultan las alertas que ya se resolvieron (de quincenas anteriores):
        // jornada sin salida ya corregida, u horas extra ya aprobadas/rechazadas.
        .filter((a) => {
            if (a.tipo === 'INCONSISTENTE') return a.jornada?.estado === 'INCONSISTENTE'
            if (a.tipo === 'EXTRAS_PENDIENTES') return !!a.aprobacionId
            return true
        })
}

/**
 * Asistencia día a día del empleado en un rango (YYYY-MM-DD): incluye los días
 * sin marcación ("Sin asistencia") y los días con novedad.
 */
export async function getMallaEmpleado(cedula: string, start: string, end: string) {
    const supabase = await createClient()
    try {
        const { construirMallaAsistencia } = await import('@/lib/asistenciaDatos')
        const malla = await construirMallaAsistencia(supabase, { start, end, cedula })
        return malla.filas
    } catch (err) {
        console.error('[getMallaEmpleado]', err)
        return []
    }
}

/** Correcciones registradas sobre las jornadas del empleado (quién, cuándo, motivo). */
export async function getCorreccionesEmpleado(cedula: string, limite = 20) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('alertas')
        .select('id, mensaje, created_at')
        .eq('empleado_id', cedula)
        .eq('leida', true)
        .or('mensaje.ilike.Corrección*,mensaje.ilike.*Revisada por*')
        .order('created_at', { ascending: false })
        .limit(limite)
    if (error) return []
    return data ?? []
}

/**
 * Semana dominical más reciente con datos de cumplimiento (44h).
 */
export async function getSemanaDominicalActual(cedula: string) {
    const supabase = await createClient()
    const { data, error } = await supabase
        .from('semanas_dominicales')
        .select(
            'semana_inicio, semana_fin, minutos_ordinarios, minutos_novedades_remuneradas, total_minutos_cumplimiento, paga_domingo, marcado_por, created_at',
        )
        .eq('empleado_id', cedula)
        .order('semana_inicio', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (error) return null
    return data
}

/**
 * Turno asignado a la operación del empleado (si existe). Se muestra como
 * referencia informativa — todavía no se usa en el motor de liquidación.
 */
export async function getTurnoOperacion(operacion: string | null) {
    if (!operacion) return null
    const supabase = await createClient()

    const { data: op } = await supabase
        .from('operaciones')
        .select('id, limite_horas, minutos_almuerzo')
        .eq('nombre', operacion)
        .maybeSingle()

    if (!op) return null

    const { data: turnos } = await supabase
        .from('turnos')
        .select('nombre, hora_inicio, hora_fin')
        .eq('operacion_id', op.id)
        .order('hora_inicio', { ascending: true })

    return {
        limite_horas: op.limite_horas,
        minutos_almuerzo: op.minutos_almuerzo,
        turnos: turnos ?? [],
    }
}
