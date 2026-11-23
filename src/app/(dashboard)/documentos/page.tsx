import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getOperationFilter, getUserProfile, puedeEditar } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DocumentoTarjeta, type DocumentoFila } from './DocumentoTarjeta'
import type { EstadoDocumento } from './actions'

export const dynamic = 'force-dynamic'

const PESTANAS: { estado: EstadoDocumento; texto: string }[] = [
    { estado: 'PENDIENTE', texto: 'Pendientes' },
    { estado: 'REVISADO', texto: 'Revisados' },
    { estado: 'RECHAZADO', texto: 'Rechazados' },
]

export default async function DocumentosPage({
    searchParams,
}: {
    searchParams: Promise<{ estado?: string }>
}) {
    const profile = await getUserProfile()
    if (!profile) redirect('/')

    const { estado: estadoParam } = await searchParams
    const estado: EstadoDocumento = (['PENDIENTE', 'REVISADO', 'RECHAZADO'] as const).find((e) => e === estadoParam) ?? 'PENDIENTE'

    const supabase = await createClient()
    const filtro = getOperationFilter(profile)

    // usuarios!inner permite filtrar por la operación del colaborador
    let q = supabase
        .from('documentos')
        .select('id, empleado_id, descripcion, archivo_nombre, archivo_tamano, estado, nota, revisado_por, revisado_en, created_at, usuarios!inner(nombre, operacion)')
        .eq('estado', estado)
        .order('created_at', { ascending: false })
        .limit(300)
    if (filtro.length > 0) q = q.in('usuarios.operacion', filtro)
    const { data, error } = await q

    const documentos: DocumentoFila[] = (data ?? []).map((d) => {
        const u = d.usuarios as unknown as { nombre: string; operacion: string | null }
        return {
            id: d.id,
            cedula: d.empleado_id,
            nombre: u?.nombre ?? '',
            operacion: u?.operacion ?? null,
            descripcion: d.descripcion,
            archivoNombre: d.archivo_nombre,
            archivoTamano: d.archivo_tamano,
            estado: d.estado as EstadoDocumento,
            nota: d.nota,
            revisadoPor: d.revisado_por,
            revisadoEn: d.revisado_en,
            creado: d.created_at,
        }
    })

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Documentos</h1>
                <p className="text-muted-foreground mt-1">
                    PDFs enviados por los colaboradores desde el portal (<span className="font-mono">/portal</span>).
                </p>
            </div>

            <div className="flex gap-2">
                {PESTANAS.map((p) => (
                    <Link
                        key={p.estado}
                        href={`/documentos?estado=${p.estado}`}
                        className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                            estado === p.estado ? 'bg-slate-900 text-white border-slate-900' : 'bg-white hover:bg-slate-50'
                        }`}
                    >
                        {p.texto}
                    </Link>
                ))}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <FileText className="h-5 w-5 text-slate-500" />
                        {documentos.length} documento{documentos.length === 1 ? '' : 's'}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {error && (
                        <p className="text-sm text-red-700">
                            No se pudieron cargar los documentos. Verifica que la migración 003 esté aplicada.
                        </p>
                    )}
                    {!error && documentos.length === 0 && (
                        <p className="text-sm text-muted-foreground">No hay documentos en esta bandeja.</p>
                    )}
                    {documentos.map((d) => (
                        <DocumentoTarjeta key={d.id} doc={d} puedeEditar={puedeEditar(profile)} />
                    ))}
                </CardContent>
            </Card>
        </div>
    )
}
