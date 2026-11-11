import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any, any, any>

export interface RegistroAuditoria {
    /** Qué se hizo. Ej.: CAMBIO_OPERACION, ELIMINAR_COLABORADOR, CIERRE_QUINCENA, VER_FOTO. */
    accion: string
    /** Sobre qué. Ej.: colaborador, jornada, quincena. */
    entidad: string
    entidadId?: string | null
    /** Correo de quien lo hizo, o "sistema". */
    autor: string
    motivo?: string | null
    detalle?: Record<string, unknown> | null
}

/**
 * Deja constancia de una acción en la tabla `auditoria`.
 * Nunca interrumpe la operación principal: si falla, solo lo reporta en el registro del servidor.
 */
export async function registrarAuditoria(supabase: Cliente, r: RegistroAuditoria): Promise<void> {
    try {
        const { error } = await supabase.from('auditoria').insert({
            accion: r.accion,
            entidad: r.entidad,
            entidad_id: r.entidadId ?? null,
            autor: r.autor,
            motivo: r.motivo ?? null,
            detalle: r.detalle ?? null,
        })
        if (error) console.error('[auditoria]', r.accion, error.message)
    } catch (err) {
        console.error('[auditoria]', r.accion, err)
    }
}
