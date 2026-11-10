'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function login(formData: FormData) {
    const supabase = await createClient()

    // type-casting here for convenience
    // in practice, you should validate your inputs
    const data = {
        email: formData.get('email') as string,
        password: formData.get('password') as string,
    }

    const { error } = await supabase.auth.signInWithPassword(data)

    if (error) {
        // Se clasifica el motivo para mostrarlo en pantalla (antes no se veía ninguno).
        console.error('[login]', error.status, error.code, error.message)
        let motivo = 'otro'
        if (error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message)) {
            motivo = 'credenciales'
        } else if (error.code === 'email_not_confirmed') {
            motivo = 'sin_confirmar'
        } else if (error.status === 401 || error.status === 403 || /api key/i.test(error.message)) {
            motivo = 'clave_api'
        } else if (!error.status || error.status >= 500 || /fetch failed/i.test(error.message)) {
            motivo = 'conexion'
        }
        const detalle = encodeURIComponent((error.message ?? '').slice(0, 120))
        redirect(`/login?error=${motivo}&detalle=${detalle}`)
    }

    revalidatePath('/', 'layout')
    redirect('/')
}

export async function signup(formData: FormData) {
    const supabase = await createClient()

    const data = {
        email: formData.get('email') as string,
        password: formData.get('password') as string,
    }

    const { error } = await supabase.auth.signUp(data)

    if (error) {
        redirect('/login?message=No+se+pudo+registrar')
    }

    revalidatePath('/', 'layout')
    redirect('/')
}

export async function signout() {
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/login')
}
