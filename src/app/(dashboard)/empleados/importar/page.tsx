import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { ImportarEmpleados } from './ImportarEmpleados'

export default async function ImportarEmpleadosPage() {
    const profile = await getUserProfile()
    if (!profile) redirect('/')
    if (profile.rol !== 'admin') redirect('/empleados')

    const supabase = await createClient()
    const { data } = await supabase.from('operaciones').select('nombre').order('nombre', { ascending: true })
    const operaciones = (data ?? []).map((o) => o.nombre as string)

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Importar personal desde Excel</h1>
                    <p className="text-muted-foreground mt-1">
                        Crea en un solo paso a los colaboradores de un archivo de Excel. Primero se muestra una
                        revisión; no se guarda nada hasta que confirmes.
                    </p>
                </div>
                <Link href="/empleados">
                    <Button variant="outline">← Volver a Usuarios</Button>
                </Link>
            </div>
            <ImportarEmpleados operaciones={operaciones} />
        </div>
    )
}
