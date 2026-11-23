import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/auth'
import { hoyColombiaISO, moverQuincena, quincenaDeFecha } from '@/lib/asistencia'
import { ChatToluia } from './ChatToluia'

export const dynamic = 'force-dynamic'

export default async function ToluiaPage() {
    const profile = await getUserProfile()
    if (!profile) redirect('/')

    let operaciones: string[] = []
    if (profile.rol === 'admin') {
        const supabase = await createClient()
        const { data } = await supabase.from('operaciones').select('nombre').order('nombre', { ascending: true })
        operaciones = (data ?? []).map((o) => o.nombre as string)
    }

    const actual = quincenaDeFecha(hoyColombiaISO())
    const anterior = moverQuincena(actual, -1)

    return (
        <ChatToluia
            esAdmin={profile.rol === 'admin'}
            operacionFija={profile.rol === 'admin' ? null : profile.operacion_nombre}
            operaciones={operaciones}
            etiquetaActual={actual.etiqueta}
            etiquetaAnterior={anterior.etiqueta}
        />
    )
}
