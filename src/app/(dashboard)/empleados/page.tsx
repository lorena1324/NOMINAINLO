import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmpleadoForm } from './EmpleadoForm'
import { Button } from '@/components/ui/button'
import { EmpleadosTable } from './EmpleadosTable'
import Link from 'next/link'
import { getUserProfile, puedeEditar } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function EmpleadosPage() {
    const profile = await getUserProfile()
    if (!profile) redirect('/')

    const supabase = await createClient()

    const empleadosQuery = supabase
        .from('usuarios')
        .select('*')
        .order('nombre', { ascending: true })

    if (profile.rol !== 'admin' && profile.operacion_nombre) {
        empleadosQuery.eq('operacion', profile.operacion_nombre)
    }

    const { data: empleados } = await empleadosQuery

    // Se consultan directo: getOperacionesAdmin() exige rol admin y hacía fallar
    // esta pantalla para coordinadores y visualizadores.
    const { data: opsData } = await supabase
        .from('operaciones')
        .select('id, nombre')
        .order('nombre', { ascending: true })
    const allOperaciones = (opsData ?? []) as { id: string; nombre: string }[]
    const soloLectura = !puedeEditar(profile)

    const operaciones = profile.rol !== 'admin' && profile.operacion_nombre
        ? allOperaciones.filter(op => op.nombre === profile.operacion_nombre)
        : allOperaciones

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Gestión de Usuarios</h1>
                    <p className="text-muted-foreground mt-1">Directorio y creación de personal operativo y administrativo</p>
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                    {/* Plantilla de colaboradores (activos e inactivos) para cruce con RRHH */}
                    <a href="/api/reportes/colaboradores" target="_blank" rel="noreferrer">
                        <Button variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                            ⬇ Descargar colaboradores (Excel)
                        </Button>
                    </a>
                    <Link href="/novedades">
                        <Button variant="outline" className="border-purple-600 text-purple-700 hover:bg-purple-50">
                            📋 Registro de Novedades
                        </Button>
                    </Link>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                {!soloLectura && (
                    <div className="col-span-1">
                        <EmpleadoForm
                            operaciones={operaciones}
                            rol={profile.rol}
                            operacionFija={profile.operacion_nombre}
                        />
                    </div>
                )}
                <div className={soloLectura ? 'col-span-1 lg:col-span-3' : 'col-span-1 lg:col-span-2'}>
                    <Card>
                        <CardHeader>
                            <CardTitle>Usuarios Registrados ({empleados?.length || 0})</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <EmpleadosTable
                                empleados={empleados || []}
                                operaciones={operaciones}
                                rol={profile.rol}
                            />
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
