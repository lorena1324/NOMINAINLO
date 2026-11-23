import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { cedulaDelPortal } from '@/lib/portal'
import { Button } from '@/components/ui/button'
import { salirPortal } from './actions'
import { EnviarDocumento } from './EnviarDocumento'

export const dynamic = 'force-dynamic'

const ESTADO: Record<string, { texto: string; clase: string }> = {
    PENDIENTE: { texto: 'Pendiente', clase: 'bg-amber-50 text-amber-700 border-amber-200' },
    REVISADO: { texto: 'Revisado', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    RECHAZADO: { texto: 'Rechazado', clase: 'bg-red-50 text-red-700 border-red-200' },
}

function fechaHora(iso: string) {
    return new Date(iso).toLocaleString('es-CO', {
        timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
}

export default async function PortalPage() {
    const cedula = await cedulaDelPortal()
    if (!cedula) redirect('/portal/login')

    const supabase = createAdminClient()
    const { data: usuario } = await supabase
        .from('usuarios')
        .select('id, nombre, operacion, status')
        .eq('id', cedula)
        .maybeSingle()
    if (!usuario || usuario.status !== 'activo') redirect('/portal/login')

    const { data: documentos } = await supabase
        .from('documentos')
        .select('id, descripcion, archivo_nombre, estado, nota, created_at')
        .eq('empleado_id', cedula)
        .order('created_at', { ascending: false })
        .limit(30)

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold">Hola, {usuario.nombre.split(' ').slice(-2).join(' ') || usuario.nombre}</h1>
                        <p className="text-sm text-muted-foreground">
                            {usuario.id}{usuario.operacion ? ` · ${usuario.operacion}` : ''}
                        </p>
                    </div>
                    <form action={salirPortal}>
                        <Button variant="outline" size="sm">Salir</Button>
                    </form>
                </div>

                <EnviarDocumento />

                <div className="rounded-xl border bg-white p-5">
                    <h2 className="font-semibold mb-3">Mis documentos enviados</h2>
                    {(documentos ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">Aún no has enviado documentos.</p>
                    ) : (
                        <ul className="divide-y">
                            {(documentos ?? []).map((d) => {
                                const e = ESTADO[d.estado] ?? ESTADO.PENDIENTE
                                return (
                                    <li key={d.id} className="py-3 flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium">{d.descripcion}</p>
                                            <p className="text-xs text-muted-foreground truncate">
                                                {d.archivo_nombre} · {fechaHora(d.created_at)}
                                            </p>
                                            {d.estado === 'RECHAZADO' && d.nota && (
                                                <p className="text-xs text-red-700 mt-1">Motivo: {d.nota}</p>
                                            )}
                                        </div>
                                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${e.clase}`}>{e.texto}</span>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    )
}
