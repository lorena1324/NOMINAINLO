'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fueraDeAlcance, getUserProfile, requireAdminOrCoordinador } from '@/lib/auth'

export type EstadoDocumento = 'PENDIENTE' | 'REVISADO' | 'RECHAZADO'

/**
 * Cambia el estado de un documento.
 *  - REVISADO: nota opcional.
 *  - RECHAZADO: nota obligatoria (el colaborador la ve en el portal).
 *  - PENDIENTE: "Devolver a pendientes".
 * El coordinador solo puede tocar documentos de colaboradores de su operación.
 */
export async function cambiarEstadoDocumento(args: {
    id: string
    estado: EstadoDocumento
    nota?: string
}): Promise<{ success: boolean; error?: string }> {
    const profile = await getUserProfile()
    requireAdminOrCoordinador(profile)

    if (!['PENDIENTE', 'REVISADO', 'RECHAZADO'].includes(args.estado)) {
        return { success: false, error: 'Estado no válido.' }
    }
    const nota = (args.nota ?? '').trim()
    if (args.estado === 'RECHAZADO' && nota.length < 3) {
        return { success: false, error: 'Escribe la nota con el motivo del rechazo.' }
    }

    const supabase = await createClient()
    const { data: doc } = await supabase
        .from('documentos')
        .select('id, usuarios(operacion)')
        .eq('id', args.id)
        .maybeSingle()
    if (!doc) return { success: false, error: 'El documento no existe.' }
    const operacion = (doc.usuarios as unknown as { operacion: string | null } | null)?.operacion
    if (fueraDeAlcance(profile, operacion)) {
        return { success: false, error: 'Ese documento es de otra operación.' }
    }

    const cambios =
        args.estado === 'PENDIENTE'
            ? { estado: 'PENDIENTE', nota: null, revisado_por: null, revisado_en: null }
            : { estado: args.estado, nota: nota || null, revisado_por: profile.email, revisado_en: new Date().toISOString() }

    const { error } = await supabase.from('documentos').update(cambios).eq('id', args.id)
    if (error) return { success: false, error: 'No se pudo actualizar el documento.' }

    revalidatePath('/documentos')
    return { success: true }
}
