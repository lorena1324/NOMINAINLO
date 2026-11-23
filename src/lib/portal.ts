/**
 * Sesión del portal de empleados (/portal).
 *
 * El colaborador entra con su cédula (la clave es la misma cédula) solo para
 * enviar documentos y ver en qué estado están. No es una cuenta de Supabase:
 * la sesión es una cookie firmada en el servidor (HMAC-SHA256) que dura 8 horas.
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'

export const COOKIE_PORTAL = 'portal_sesion'
export const BUCKET_DOCUMENTOS = 'documentos-empleados'
export const TAMANO_MAXIMO_DOCUMENTO = 10 * 1024 * 1024 // 10 MB
const DURACION_MS = 8 * 60 * 60 * 1000

function claveFirma(): Buffer {
    const secreto = process.env.PORTAL_SECRETO || process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!secreto) throw new Error('Falta la variable SUPABASE_SERVICE_ROLE_KEY')
    return createHash('sha256').update(`portal-empleados:${secreto}`).digest()
}

function firmar(texto: string): string {
    return createHmac('sha256', claveFirma()).update(texto).digest('base64url')
}

export function crearValorSesion(cedula: string): string {
    const vence = Date.now() + DURACION_MS
    const cuerpo = `${cedula}.${vence}`
    return `${cuerpo}.${firmar(cuerpo)}`
}

/** Cédula de la sesión, o null si no hay sesión válida. */
export function leerValorSesion(valor: string | undefined | null): string | null {
    if (!valor) return null
    const partes = valor.split('.')
    if (partes.length !== 3) return null
    const [cedula, vence, firma] = partes
    if (!/^\d{4,15}$/.test(cedula) || !/^\d+$/.test(vence)) return null
    if (Number(vence) < Date.now()) return null
    const esperada = Buffer.from(firmar(`${cedula}.${vence}`))
    const recibida = Buffer.from(firma)
    if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null
    return cedula
}

export async function cedulaDelPortal(): Promise<string | null> {
    const almacen = await cookies()
    return leerValorSesion(almacen.get(COOKIE_PORTAL)?.value)
}

export const OPCIONES_COOKIE = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: DURACION_MS / 1000,
}
