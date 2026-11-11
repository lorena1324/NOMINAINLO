import { createClient } from '@/lib/supabase/server'

/**
 * Perfiles del panel:
 *  - admin:        acceso total (configuración, usuarios, reportes, correcciones).
 *  - coordinador:  gestiona su operación (corrige, aprueba, registra novedades).
 *  - visualizador: solo consulta y descarga; no puede modificar nada.
 */
export type Rol = 'admin' | 'coordinador' | 'visualizador'

export type UserProfile = {
    userId: string
    email: string
    rol: Rol
    operacion_nombre: string | null
}

export const ETIQUETA_ROL: Record<Rol, string> = {
    admin: 'Administrador',
    coordinador: 'Coordinador',
    visualizador: 'Visualizador (solo consulta)',
}

/**
 * Obtiene el perfil del usuario autenticado actual.
 * Retorna null si no hay sesion o si el usuario no tiene perfil en `perfiles`.
 */
export async function getUserProfile(): Promise<UserProfile | null> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return null

    const { data: perfil } = await supabase
        .from('perfiles')
        .select('rol, operacion_nombre')
        .eq('id', user.id)
        .single()

    if (!perfil) return null

    return {
        userId: user.id,
        email: user.email!,
        rol: perfil.rol as Rol,
        operacion_nombre: perfil.operacion_nombre
    }
}

/**
 * Assertion: requiere que el perfil sea admin. Lanza error si no.
 */
export function requireAdmin(profile: UserProfile | null): asserts profile is UserProfile {
    if (!profile || profile.rol !== 'admin') {
        throw new Error('No autorizado: se requiere rol de administrador')
    }
}

/**
 * Assertion: requiere que el perfil pueda MODIFICAR (admin o coordinador).
 * El visualizador queda por fuera: toda acción que cambia datos pasa por aquí.
 */
export function requireAdminOrCoordinador(profile: UserProfile | null): asserts profile is UserProfile {
    if (!profile || !['admin', 'coordinador'].includes(profile.rol)) {
        throw new Error('No autorizado: tu perfil es de solo consulta')
    }
}

/**
 * Assertion: requiere cualquier perfil del panel (incluye visualizador).
 * Úsese solo en consultas, nunca en acciones que modifican datos.
 */
export function requirePerfil(profile: UserProfile | null): asserts profile is UserProfile {
    if (!profile || !['admin', 'coordinador', 'visualizador'].includes(profile.rol)) {
        throw new Error('No autorizado: se requiere un perfil del panel')
    }
}

/** ¿El perfil puede corregir, aprobar y registrar? (false para el visualizador) */
export function puedeEditar(profile: UserProfile | null): boolean {
    return !!profile && (profile.rol === 'admin' || profile.rol === 'coordinador')
}

/**
 * Retorna el filtro de operaciones para queries.
 * Admin: array vacio (sin filtro, ve todo).
 * Coordinador / visualizador: [operacion_nombre]. Un visualizador sin
 * operación asignada consulta todas las operaciones.
 */
export function getOperationFilter(profile: UserProfile): string[] {
    if (profile.rol === 'admin') return []
    return profile.operacion_nombre ? [profile.operacion_nombre] : []
}

/** ¿La operación dada queda por fuera de lo que este perfil puede ver? */
export function fueraDeAlcance(profile: UserProfile, operacion: string | null | undefined): boolean {
    const filtro = getOperationFilter(profile)
    return filtro.length > 0 && (!operacion || !filtro.includes(operacion))
}
