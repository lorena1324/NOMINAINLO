import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fueraDeAlcance, getUserProfile } from '@/lib/auth'
import { registrarAuditoria } from '@/lib/auditoria'
import { BUCKET_DOCUMENTOS } from '@/lib/portal'

export const dynamic = 'force-dynamic'

/**
 * GET /api/documentos/:id
 * Abre el PDF de un documento (enlace temporal de 2 minutos).
 * Admin, coordinador (solo su operación) y visualizador. Queda en auditoría:
 * pueden ser documentos médicos (datos sensibles).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const profile = await getUserProfile()
    if (!profile) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })

    const { id } = await params
    if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Documento no válido.' }, { status: 400 })

    const supabase = createAdminClient()
    const { data: doc } = await supabase
        .from('documentos')
        .select('id, empleado_id, archivo_ruta, archivo_nombre, usuarios(operacion)')
        .eq('id', id)
        .maybeSingle()
    if (!doc) return NextResponse.json({ error: 'El documento no existe.' }, { status: 404 })

    const operacion = (doc.usuarios as unknown as { operacion: string | null } | null)?.operacion
    if (fueraDeAlcance(profile, operacion)) {
        return NextResponse.json({ error: 'Ese documento es de otra operación.' }, { status: 403 })
    }

    const { data: firmado, error } = await supabase.storage
        .from(BUCKET_DOCUMENTOS)
        .createSignedUrl(doc.archivo_ruta, 120)
    if (error || !firmado) return NextResponse.json({ error: 'No se encontró el archivo.' }, { status: 404 })

    await registrarAuditoria(supabase, {
        accion: 'VER_DOCUMENTO',
        entidad: 'documento',
        entidadId: doc.id,
        autor: profile.email,
        detalle: { cedula: doc.empleado_id, archivo: doc.archivo_nombre },
    })

    return NextResponse.redirect(firmado.signedUrl)
}
