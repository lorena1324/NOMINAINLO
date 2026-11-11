/**
 * Fotos de marcación cifradas.
 *
 * La foto es un dato biométrico (dato sensible, Ley 1581 de 2012). Por eso:
 *  - solo se guarda si el colaborador autorizó el tratamiento de sus datos;
 *  - se cifra en el servidor con AES-256-GCM antes de subirla;
 *  - queda en un almacenamiento privado al que solo accede el servidor;
 *  - se elimina sola después del período de retención.
 *
 * La clave sale de la variable de entorno FOTOS_CLAVE_CIFRADO. Si no está
 * configurada, las fotos NO se guardan (se descartan, como antes).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

export const BUCKET_FOTOS = 'fotos-asistencia'

/** Días que se conserva una foto antes de eliminarse. */
export function diasRetencionFotos(): number {
    const n = parseInt(process.env.FOTOS_DIAS_RETENCION ?? '', 10)
    return Number.isFinite(n) && n > 0 ? n : 90
}

function clave(): Buffer | null {
    const secreto = process.env.FOTOS_CLAVE_CIFRADO
    if (!secreto || secreto.length < 16) return null
    return createHash('sha256').update(secreto).digest()
}

export function fotosHabilitadas(): boolean {
    return clave() !== null
}

/** Cifra: [12 bytes IV][16 bytes etiqueta][datos cifrados]. */
export function cifrar(datos: Buffer, k: Buffer): Buffer {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', k, iv)
    const cifrado = Buffer.concat([cipher.update(datos), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), cifrado])
}

export function descifrar(paquete: Buffer, k: Buffer): Buffer {
    const iv = paquete.subarray(0, 12)
    const tag = paquete.subarray(12, 28)
    const cifrado = paquete.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', k, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(cifrado), decipher.final()])
}

/**
 * Cifra y guarda la foto de una marcación. Retorna la ruta guardada, o `null`
 * si no se guardó (sin clave configurada, foto inválida o error de subida).
 * Nunca lanza: una falla con la foto no debe impedir la marcación.
 */
export async function guardarFotoCifrada(args: {
    fotoBase64: string
    cedula: string
    jornadaId: string
    tipo: 'entrada' | 'salida'
}): Promise<string | null> {
    try {
        const k = clave()
        if (!k) return null

        const base64 = args.fotoBase64.includes(',') ? args.fotoBase64.split(',')[1] : args.fotoBase64
        const datos = Buffer.from(base64, 'base64')
        // Entre 1 KB y 3 MB: fuera de eso no es una foto razonable del quiosco
        if (datos.length < 1024 || datos.length > 3 * 1024 * 1024) return null

        const ruta = `${args.cedula}/${args.jornadaId}-${args.tipo}.enc`
        const supabase = createAdminClient()
        const { error } = await supabase.storage
            .from(BUCKET_FOTOS)
            .upload(ruta, cifrar(datos, k), { contentType: 'application/octet-stream', upsert: true })
        if (error) {
            console.error('[fotos] No se pudo guardar la foto:', error.message)
            return null
        }
        return ruta
    } catch (err) {
        console.error('[fotos] Error guardando la foto:', err)
        return null
    }
}

/** Descarga y descifra una foto. Retorna `null` si no existe o no se puede descifrar. */
export async function leerFotoCifrada(ruta: string): Promise<Buffer | null> {
    try {
        const k = clave()
        if (!k) return null
        const supabase = createAdminClient()
        const { data, error } = await supabase.storage.from(BUCKET_FOTOS).download(ruta)
        if (error || !data) return null
        return descifrar(Buffer.from(await data.arrayBuffer()), k)
    } catch (err) {
        console.error('[fotos] Error leyendo la foto:', err)
        return null
    }
}

/**
 * Elimina las fotos más antiguas que el período de retención (máximo 200 por
 * ejecución; el proceso nocturno continúa al día siguiente).
 */
export async function limpiarFotosVencidas(): Promise<number> {
    const supabase = createAdminClient()
    const corte = new Date(Date.now() - diasRetencionFotos() * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase
        .from('jornadas')
        .select('id, foto_entrada, foto_salida')
        .lt('entrada', corte)
        .or('foto_entrada.not.is.null,foto_salida.not.is.null')
        .limit(200)
    if (error || !data || data.length === 0) return 0

    const rutas = data.flatMap((j) => [j.foto_entrada, j.foto_salida]).filter(Boolean) as string[]
    if (rutas.length > 0) await supabase.storage.from(BUCKET_FOTOS).remove(rutas)
    await supabase
        .from('jornadas')
        .update({ foto_entrada: null, foto_salida: null })
        .in('id', data.map((j) => j.id))
    return rutas.length
}
