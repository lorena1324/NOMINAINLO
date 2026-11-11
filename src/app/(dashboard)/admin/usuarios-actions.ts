'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getUserProfile, requireAdmin, type Rol } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

export type PerfilConEmail = {
    id: string
    email: string
    rol: string
    operacion_nombre: string | null
    created_at: string
    banned: boolean
}

export async function listarUsuarios(): Promise<{ success: boolean; data?: PerfilConEmail[]; error?: string }> {
    const profile = await getUserProfile()
    requireAdmin(profile)

    const adminClient = createAdminClient()

    const { data: perfiles, error } = await adminClient
        .from('perfiles')
        .select('*')
        .order('created_at', { ascending: true })

    if (error) {
        return { success: false, error: 'Error obteniendo perfiles: ' + error.message }
    }

    // Obtener emails desde auth.users via admin client
    const { data: { users }, error: usersError } = await adminClient.auth.admin.listUsers()

    if (usersError) {
        return { success: false, error: 'Error obteniendo usuarios auth: ' + usersError.message }
    }

    const usersMap = new Map(users.map(u => [u.id, u]))

    const resultado: PerfilConEmail[] = (perfiles || []).map(p => {
        const authUser = usersMap.get(p.id)
        return {
            id: p.id,
            email: authUser?.email || 'Sin email',
            rol: p.rol,
            operacion_nombre: p.operacion_nombre,
            created_at: p.created_at,
            banned: !!authUser?.banned_until
        }
    })

    return { success: true, data: resultado }
}

export async function crearUsuarioAuth({
    email,
    password,
    rol,
    operacion_nombre
}: {
    email: string
    password: string
    rol: Rol
    operacion_nombre: string | null
}): Promise<{ success: boolean; error?: string }> {
    const profile = await getUserProfile()
    requireAdmin(profile)

    if (!email || !password) {
        return { success: false, error: 'Email y password son obligatorios' }
    }

    if (password.length < 6) {
        return { success: false, error: 'La contraseña debe tener al menos 6 caracteres' }
    }

    if (rol === 'coordinador' && !operacion_nombre) {
        return { success: false, error: 'Un coordinador debe tener una operación asignada' }
    }

    const adminClient = createAdminClient()

    // Crear usuario en auth
    const { data: newUser, error: authError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true
    })

    if (authError) {
        if (authError.message?.includes('already been registered')) {
            return { success: false, error: 'Ya existe un usuario con ese email' }
        }
        return { success: false, error: 'Error creando usuario auth: ' + authError.message }
    }

    if (!newUser.user) {
        return { success: false, error: 'No se pudo crear el usuario' }
    }

    // Crear perfil
    const { error: perfilError } = await adminClient
        .from('perfiles')
        .insert({
            id: newUser.user.id,
            rol,
            operacion_nombre: rol === 'admin' ? null : (operacion_nombre || null)
        })

    if (perfilError) {
        // Rollback: eliminar usuario auth si falla el perfil
        await adminClient.auth.admin.deleteUser(newUser.user.id)
        return { success: false, error: 'Error creando perfil: ' + perfilError.message }
    }

    revalidatePath('/admin/usuarios')
    return { success: true }
}

export async function editarPerfil({
    id,
    rol,
    operacion_nombre
}: {
    id: string
    rol: Rol
    operacion_nombre: string | null
}): Promise<{ success: boolean; error?: string }> {
    const profile = await getUserProfile()
    requireAdmin(profile)

    if (rol === 'coordinador' && !operacion_nombre) {
        return { success: false, error: 'Un coordinador debe tener una operación asignada' }
    }

    const adminClient = createAdminClient()

    const { error } = await adminClient
        .from('perfiles')
        .update({
            rol,
            operacion_nombre: rol === 'admin' ? null : (operacion_nombre || null)
        })
        .eq('id', id)

    if (error) {
        return { success: false, error: 'Error actualizando perfil: ' + error.message }
    }

    revalidatePath('/admin/usuarios')
    return { success: true }
}

export async function toggleBanUsuario(id: string): Promise<{ success: boolean; error?: string }> {
    const profile = await getUserProfile()
    requireAdmin(profile)

    // No permitir auto-ban
    if (profile.userId === id) {
        return { success: false, error: 'No puedes desactivar tu propia cuenta' }
    }

    const adminClient = createAdminClient()

    // Verificar estado actual
    const { data: { user }, error: getUserError } = await adminClient.auth.admin.getUserById(id)

    if (getUserError || !user) {
        return { success: false, error: 'Usuario no encontrado' }
    }

    const isBanned = !!user.banned_until
    const { error } = await adminClient.auth.admin.updateUserById(id, {
        ban_duration: isBanned ? 'none' : '87600h' // 10 anios = efectivamente permanente
    })

    if (error) {
        return { success: false, error: 'Error actualizando estado: ' + error.message }
    }

    revalidatePath('/admin/usuarios')
    return { success: true }
}
