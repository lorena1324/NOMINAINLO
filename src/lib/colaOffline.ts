/**
 * Cola de marcaciones sin conexión (solo navegador).
 *
 * Cuando el quiosco no tiene internet, la marcación se guarda en el propio
 * dispositivo con su evidencia (hora real, foto y ubicación), CIFRADA con
 * AES-GCM. La clave se genera en el dispositivo como "no extraíble": el
 * navegador puede usarla para cifrar y descifrar, pero no se puede copiar.
 *
 * Al volver la conexión, cada marcación se envía al servidor, que la valida
 * con las mismas reglas de una marcación normal.
 */

const NOMBRE_BD = 'inlotrans-quiosco'
const ALMACEN_CLAVES = 'claves'
const ALMACEN_COLA = 'cola'
const CLAVE_RECHAZADAS = 'inlotrans-marcaciones-rechazadas'

export interface MarcacionPendiente {
    id: string
    cedula: string
    tipo: 'ENTRADA' | 'SALIDA'
    operacion: string
    /** Momento real en que el colaborador marcó (ISO). */
    momento: string
    foto_base64: string
    ubicacion: { lat: number; lng: number } | null
}

export interface MarcacionRechazada {
    cedula: string
    tipo: 'ENTRADA' | 'SALIDA'
    momento: string
    error: string
}

interface RegistroCifrado {
    id: string
    iv: Uint8Array
    datos: ArrayBuffer
    creado: number
}

export function colaDisponible(): boolean {
    return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle
}

function abrirBD(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(NOMBRE_BD, 1)
        req.onupgradeneeded = () => {
            const db = req.result
            if (!db.objectStoreNames.contains(ALMACEN_CLAVES)) db.createObjectStore(ALMACEN_CLAVES)
            if (!db.objectStoreNames.contains(ALMACEN_COLA)) db.createObjectStore(ALMACEN_COLA, { keyPath: 'id' })
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

function pedir<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

async function obtenerClave(db: IDBDatabase): Promise<CryptoKey> {
    const existente = await pedir<CryptoKey | undefined>(
        db.transaction(ALMACEN_CLAVES, 'readonly').objectStore(ALMACEN_CLAVES).get('principal'),
    )
    if (existente) return existente
    // extractable = false: la clave no se puede exportar ni leer desde el código
    const nueva = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await pedir(db.transaction(ALMACEN_CLAVES, 'readwrite').objectStore(ALMACEN_CLAVES).put(nueva, 'principal'))
    return nueva
}

/** Guarda una marcación cifrada en el dispositivo. */
export async function encolarMarcacion(m: Omit<MarcacionPendiente, 'id'>): Promise<void> {
    const db = await abrirBD()
    const clave = await obtenerClave(db)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const plano = new TextEncoder().encode(JSON.stringify({ ...m, id }))
    const datos = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, clave, plano)
    const registro: RegistroCifrado = { id, iv, datos, creado: Date.now() }
    await pedir(db.transaction(ALMACEN_COLA, 'readwrite').objectStore(ALMACEN_COLA).put(registro))
    db.close()
}

export async function contarPendientes(): Promise<number> {
    if (!colaDisponible()) return 0
    try {
        const db = await abrirBD()
        const n = await pedir(db.transaction(ALMACEN_COLA, 'readonly').objectStore(ALMACEN_COLA).count())
        db.close()
        return n
    } catch {
        return 0
    }
}

export function leerRechazadas(): MarcacionRechazada[] {
    try {
        return JSON.parse(localStorage.getItem(CLAVE_RECHAZADAS) ?? '[]') as MarcacionRechazada[]
    } catch {
        return []
    }
}

export function limpiarRechazadas(): void {
    try { localStorage.removeItem(CLAVE_RECHAZADAS) } catch { /* sin almacenamiento */ }
}

function anotarRechazada(r: MarcacionRechazada): void {
    try {
        const lista = [r, ...leerRechazadas()].slice(0, 30)
        localStorage.setItem(CLAVE_RECHAZADAS, JSON.stringify(lista))
    } catch { /* sin almacenamiento */ }
}

type RespuestaEnvio = { success: true } | { success: false; error: string; definitivo?: boolean }

/**
 * Envía las marcaciones guardadas, de la más antigua a la más reciente.
 *  - Aceptada → sale de la cola.
 *  - Rechazada de forma definitiva (regla de negocio) → sale de la cola y
 *    queda anotada para que el coordinador la revise.
 *  - Falla de red o del servidor → se detiene y se reintenta después.
 */
export async function sincronizarCola(
    enviar: (m: MarcacionPendiente) => Promise<RespuestaEnvio>,
): Promise<{ enviadas: number; rechazadas: number; pendientes: number }> {
    if (!colaDisponible()) return { enviadas: 0, rechazadas: 0, pendientes: 0 }
    const db = await abrirBD()
    const clave = await obtenerClave(db)
    const registros = await pedir<RegistroCifrado[]>(
        db.transaction(ALMACEN_COLA, 'readonly').objectStore(ALMACEN_COLA).getAll(),
    )
    registros.sort((a, b) => a.creado - b.creado)

    const borrar = (id: string) =>
        pedir(db.transaction(ALMACEN_COLA, 'readwrite').objectStore(ALMACEN_COLA).delete(id))

    let enviadas = 0
    let rechazadas = 0
    for (const r of registros) {
        let m: MarcacionPendiente
        try {
            const plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(r.iv) }, clave, r.datos)
            m = JSON.parse(new TextDecoder().decode(plano)) as MarcacionPendiente
        } catch {
            // No se puede descifrar (clave del dispositivo cambiada): se descarta
            await borrar(r.id)
            rechazadas++
            continue
        }

        let res: RespuestaEnvio
        try {
            res = await enviar(m)
        } catch {
            break // sin conexión todavía
        }

        if (res.success) {
            await borrar(r.id)
            enviadas++
        } else if (res.definitivo) {
            await borrar(r.id)
            anotarRechazada({ cedula: m.cedula, tipo: m.tipo, momento: m.momento, error: res.error })
            rechazadas++
        } else {
            break // error temporal del servidor: reintentar luego
        }
    }

    const pendientes = await pedir(db.transaction(ALMACEN_COLA, 'readonly').objectStore(ALMACEN_COLA).count())
    db.close()
    return { enviadas, rechazadas, pendientes }
}
