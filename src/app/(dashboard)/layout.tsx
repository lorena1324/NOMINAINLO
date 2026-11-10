import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { signout } from '@/app/login/actions'
import { getUserProfile } from '@/lib/auth'
import {
    Users,
    Settings,
    Clock,
    LogOut,
    FileText,
    Briefcase,
    UserCog,
    ShieldCheck,
    CalendarCheck
} from 'lucide-react'

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const profile = await getUserProfile()

    // Sin perfil = trabajador o cuenta sin vincular -> solo kiosco
    if (!profile) {
        redirect('/')
    }

    const isAdmin = profile.rol === 'admin'

    return (
        <div className="flex min-h-screen bg-slate-50/40">
            <aside className="w-64 border-r bg-white p-4 hidden md:flex flex-col gap-4">
                <div className="flex h-14 items-center font-bold text-xl px-2">
                    Inlotrans
                </div>
                <nav className="flex-1 space-y-1">
                    <Link href="/admin">
                        <Button variant="ghost" className="w-full justify-start gap-2">
                            <Settings className="h-4 w-4" />
                            Administración
                        </Button>
                    </Link>
                    <Link href="/asistencia">
                        <Button variant="ghost" className="w-full justify-start gap-2">
                            <CalendarCheck className="h-4 w-4" />
                            Asistencia diaria
                        </Button>
                    </Link>
                    <Link href="/novedades">
                        <Button variant="ghost" className="w-full justify-start gap-2">
                            <FileText className="h-4 w-4" />
                            Novedades
                        </Button>
                    </Link>
                    <Link href="/aprobaciones">
                        <Button variant="ghost" className="w-full justify-start gap-2">
                            <ShieldCheck className="h-4 w-4" />
                            Panel de Control
                        </Button>
                    </Link>
                    {isAdmin && (
                        <Link href="/admin/usuarios">
                            <Button variant="ghost" className="w-full justify-start gap-2">
                                <UserCog className="h-4 w-4" />
                                Usuarios
                            </Button>
                        </Link>
                    )}
                    <Link href="/empleados">
                        <Button variant="ghost" className="w-full justify-start gap-2">
                            <Users className="h-4 w-4" />
                            Empleados
                        </Button>
                    </Link>
                    {isAdmin && (
                        <Link href="/admin/operaciones">
                            <Button variant="ghost" className="w-full justify-start gap-2">
                                <Briefcase className="h-4 w-4" />
                                Operaciones
                            </Button>
                        </Link>
                    )}
                    <div className="pt-3 mt-3 border-t border-slate-100">
                        <Link href="/">
                            <Button variant="ghost" className="w-full justify-start gap-2 text-slate-600">
                                <Clock className="h-4 w-4" />
                                Asistencia Web
                            </Button>
                        </Link>
                    </div>
                </nav>
                <div className="border-t pt-4">
                    <div className="px-2 mb-2">
                        <p className="text-sm font-medium truncate text-slate-500">
                            {profile.email}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                            <Badge variant={isAdmin ? 'default' : 'secondary'} className="text-xs">
                                {profile.rol}
                            </Badge>
                            {profile.operacion_nombre && (
                                <span className="text-xs text-slate-400 truncate">
                                    {profile.operacion_nombre}
                                </span>
                            )}
                        </div>
                    </div>
                    <form action={signout}>
                        <Button variant="outline" className="w-full justify-start gap-2 text-red-500 hover:text-red-600 hover:bg-red-50">
                            <LogOut className="h-4 w-4" />
                            Cerrar Sesión
                        </Button>
                    </form>
                </div>
            </aside>

            <main className="flex-1 overflow-y-auto">
                <div className="container mx-auto p-4 md:p-8">
                    {children}
                </div>
            </main>
        </div>
    )
}
