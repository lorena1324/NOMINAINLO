'use server'

import { randomUUID } from 'crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import {
    BUCKET_DOCUMENTOS,
    COOKIE_PORTAL,
    OPCIONES_COOKIE,
    TAMANO_MAXIMO_DOCUMENTO,
    cedulaDelPortal,
    crearValorSesion,
} from '@/lib/portal'

// ─── Ingreso ───────────────────────────────────────────────────────────

export async function ingresarPortal(
    _previo: { error?: string } | null,
    formData: FormData,
): Promise<{ error?: string }> {
    const cedula = ((formData.get('cedula') as string) ?? '').replace(/[.\s]/g, '').trim()
    const clave = ((formData.get('clave') as string) ?? '').replace(/[.\s]/g, '').trim()

    if (!cedula || !clave) return { error: 'Escribe tu cédula y tu clave.' }
    if (!/^\d{4,15}$/.test(cedula)) return { error: 'La cédula solo lleva números, sin puntos.' }
    if (clave !== cedula) return { error: 'Cédula o clave incorrecta. Tu clave es tu número de cédula.' }

    const supabase = createAdminClient()
    const { data: usuario } = await supabase
        .from('usuarios')
        .select('id, status')
        .eq('id', cedula)
        .maybeSingle()
    if (!usuario) return { error: 'Cédula no registrada. Consulta con tu coordinador.' }
    if (usuario.status !== 'activo') return { error: 'Tu usuario está inactivo. Consulta con tu coordinador.' }

    const almacen = await cookies()
    almacen.set(COOKIE_PORTAL, crearValorSesion(cedula), OPCIONES_COOKIE)
    redirect('/portal')
}

export async function salirPortal() {
    const almacen = await cookies()
    almacen.delete(COOKIE_PORTAL)
    redirect('/portal/login')
}

// ─── Envío de documentos ───────────────────────────────────────────────

/**
 * Paso 1: el servidor entrega un permiso de subida de un solo uso para una ruta
 * dentro de la carpeta del colaborador. El PDF se sube directo al almacenamiento
 * privado (así no hay límite de tamaño del servidor web).
 */
export async function prepararSubida(args: {
    nombre: string
    tamano: number
    tipo: string
}): Promise<{ success: true; ruta: string; token: string } | { success: false; error: string }> {
    const cedula = await cedulaDelPortal()
    if (!cedula) return { success: false, error: 'Tu sesión terminó. Vuelve a ingresar.' }
    if (args.tipo !== 'application/pdf' && !/\.pdf$/i.test(args.nombre)) {
        return { success: false, error: 'Solo se aceptan archivos PDF.' }
    }
    if (!(args.tamano > 0)) return { success: false, error: 'El archivo está vacío.' }
    if (args.tamano > TAMANO_MAXIMO_DOCUMENTO) {
        return { success: false, error: 'El PDF supera 10 MB. Redúcelo o divídelo e intenta de nuevo.' }
    }

    const ruta = `${cedula}/${randomUUID()}.pdf`
    const supabase = createAdminClient()
    const { data, error } = await supabase.storage.from(BUCKET_DOCUMENTOS).createSignedUploadUrl(ruta)
    if (error || !data) {
        console.error('[portal] permiso de subida:', error?.message)
        return { success: false, error: 'No se pudo preparar el envío. Intenta de nuevo.' }
    }
    return { success: true, ruta: data.path, token: data.token }
}

/** Paso 2: con el PDF ya subido, se registra el documento como "Pendiente". */
export async function registrarDocumento(args: {
    ruta: string
    nombre: string
    descripcion: string
}): Promise<{ success: boolean; error?: string }> {
    const cedula = await cedulaDelPortal()
    if (!cedula) return { success: false, error: 'Tu sesión terminó. Vuelve a ingresar.' }

    const descripcion = (args.descripcion ?? '').trim().replace(/\s+/g, ' ')
    if (descripcion.length < 3) return { success: false, error: 'Escribe de qué se trata el documento.' }
    if (descripcion.length > 300) return { success: false, error: 'La descripción es muy larga (máximo 300 caracteres).' }

    // La ruta debe ser de su propia carpeta y con el formato que entregó el servidor
    const m = (args.ruta ?? '').match(/^(\d{4,15})\/([0-9a-f-]{36})\.pdf$/)
    if (!m || m[1] !== cedula) return { success: false, error: 'Envío no válido.' }

    const supabase = createAdminClient()
    const { data: archivos } = await supabase.storage.from(BUCKET_DOCUMENTOS).list(cedula, { search: `${m[2]}.pdf` })
    const archivo = archivos?.find((a) => a.name === `${m[2]}.pdf`)
    if (!archivo) return { success: false, error: 'El archivo no terminó de subir. Intenta de nuevo.' }
    const tamano = Number((archivo.metadata as { size?: number } | null)?.size ?? 0)

    const nombre = (args.nombre ?? 'documento.pdf').replace(/[\\/]/g, '_').slice(0, 150)
    const { error } = await supabase.from('documentos').insert({
        empleado_id: cedula,
        descripcion,
        archivo_ruta: args.ruta,
        archivo_nombre: nombre,
        archivo_tamano: tamano,
    })
    if (error) {
        console.error('[portal] registrar documento:', error.message)
        return { success: false, error: 'No se pudo registrar el documento. Intenta de nuevo.' }
    }

    revalidatePath('/portal')
    revalidatePath('/documentos')
    return { success: true }
}
