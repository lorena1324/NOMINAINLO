import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Rutas que solo admin puede acceder
const ADMIN_ONLY_ROUTES = ['/admin/operaciones', '/admin/usuarios']

// Rutas del dashboard (requieren perfil admin o coordinador)
function isDashboardRoute(pathname: string): boolean {
    return pathname.startsWith('/empleados')
        || pathname.startsWith('/novedades')
        || pathname.startsWith('/admin')
        || pathname.startsWith('/asistencia')
        || pathname.startsWith('/aprobaciones')
}

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    const {
        data: { user },
    } = await supabase.auth.getUser()

    const pathname = request.nextUrl.pathname
    const isAuthRoute = pathname.startsWith('/login')
    const isCronRoute = pathname.startsWith('/api/cron')

    // No autenticado: redirigir a login (excepto login y cron)
    if (!user && !isAuthRoute && !isCronRoute) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    // Autenticado intentando acceder a login: redirigir al kiosco
    if (user && isAuthRoute) {
        const url = request.nextUrl.clone()
        url.pathname = '/'
        return NextResponse.redirect(url)
    }

    // Gate por roles para rutas del dashboard
    if (user && isDashboardRoute(pathname)) {
        const { data: perfil } = await supabase
            .from('perfiles')
            .select('rol')
            .eq('id', user.id)
            .single()

        // Sin perfil = trabajador o cuenta sin vincular -> solo kiosco
        if (!perfil) {
            const url = request.nextUrl.clone()
            url.pathname = '/'
            return NextResponse.redirect(url)
        }

        // Solo el administrador entra a las rutas de configuración
        if (perfil.rol !== 'admin') {
            const isAdminOnly = ADMIN_ONLY_ROUTES.some(route => pathname.startsWith(route))
            if (isAdminOnly) {
                const url = request.nextUrl.clone()
                url.pathname = '/admin'
                return NextResponse.redirect(url)
            }
        }
    }

    return supabaseResponse
}
