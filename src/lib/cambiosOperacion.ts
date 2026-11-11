/**
 * Cambios de operación (CECO) con fecha de vigencia.
 *
 * Un cambio queda registrado con motivo, autor y la fecha desde la que rige.
 * Si la fecha ya llegó se aplica de inmediato; si es futura queda programado
 * y lo aplica el proceso nocturno (o el quiosco, la primera vez que el
 * colaborador marque ese día). Nunca se reescriben las marcaciones pasadas:
 * cada jornada conserva la operación con la que se registró.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { hoyColombiaISO } from '@/lib/asistencia'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any, any, any>

export interface CambioOperacion {
    id: string
    empleado_id: string
    operacion_anterior: string | null
    operacion_nueva: string
    vigente_desde: string
    motivo: string
    autor: string
    aplicado: boolean
    aplicado_en: string | null
    created_at: string
}

/**
 * Aplica los cambios programados cuya fecha de vigencia ya llegó.
 * Con `cedula` se limita a un colaborador (uso del quiosco).
 * Retorna cuántos se aplicaron.
 */
export async function aplicarCambiosOperacionPendientes(
    supabase: Cliente,
    cedula?: string,
): Promise<number> {
    let q = supabase
        .from('cambios_operacion')
        .select('id, empleado_id, operacion_nueva')
        .eq('aplicado', false)
        .lte('vigente_desde', hoyColombiaISO())
        .order('vigente_desde', { ascending: true })
        .order('created_at', { ascending: true })
    if (cedula) q = q.eq('empleado_id', cedula)

    const { data, error } = await q
    if (error || !data || data.length === 0) return 0

    let aplicados = 0
    for (const c of data) {
        const { error: errUsuario } = await supabase
            .from('usuarios')
            .update({ operacion: c.operacion_nueva })
            .eq('id', c.empleado_id)
        if (errUsuario) {
            console.error('[cambiosOperacion] No se pudo aplicar', c.id, errUsuario.message)
            continue
        }
        await supabase
            .from('cambios_operacion')
            .update({ aplicado: true, aplicado_en: new Date().toISOString() })
            .eq('id', c.id)
        aplicados++
    }
    return aplicados
}
