'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, Clock, ExternalLink, RotateCcw, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cambiarEstadoDocumento, type EstadoDocumento } from './actions'

export interface DocumentoFila {
    id: string
    cedula: string
    nombre: string
    operacion: string | null
    descripcion: string
    archivoNombre: string
    archivoTamano: number
    estado: EstadoDocumento
    nota: string | null
    revisadoPor: string | null
    revisadoEn: string | null
    creado: string
}

const ESTADO = {
    PENDIENTE: { texto: 'Pendiente', clase: 'bg-amber-50 text-amber-700 border-amber-200', Icono: Clock },
    REVISADO: { texto: 'Revisado', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icono: CheckCircle2 },
    RECHAZADO: { texto: 'Rechazado', clase: 'bg-red-50 text-red-700 border-red-200', Icono: XCircle },
}

function tamano(bytes: number) {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function fechaHora(iso: string) {
    return new Date(iso).toLocaleString('es-CO', {
        timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
}

export function DocumentoTarjeta({ doc, puedeEditar }: { doc: DocumentoFila; puedeEditar: boolean }) {
    const router = useRouter()
    const [nota, setNota] = useState('')
    const [guardando, setGuardando] = useState(false)
    const e = ESTADO[doc.estado]

    const cambiar = async (estado: EstadoDocumento) => {
        if (estado === 'RECHAZADO' && nota.trim().length < 3) {
            toast.error('Para rechazar, escribe la nota con el motivo.')
            return
        }
        setGuardando(true)
        const res = await cambiarEstadoDocumento({ id: doc.id, estado, nota })
        setGuardando(false)
        if (!res.success) {
            toast.error(res.error ?? 'No se pudo actualizar.')
            return
        }
        toast.success(
            estado === 'REVISADO' ? 'Documento marcado como revisado.' : estado === 'RECHAZADO' ? 'Documento rechazado.' : 'Documento devuelto a pendientes.',
        )
        router.refresh()
    }

    return (
        <div className="rounded-lg border bg-white p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="font-semibold">{doc.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                        {doc.cedula} · {doc.operacion ?? 'Sin operación'}
                    </p>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${e.clase}`}>
                    <e.Icono className="h-3 w-3" /> {e.texto}
                </span>
            </div>

            <p className="text-sm">{doc.descripcion}</p>

            <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2">
                <a
                    href={`/api/documentos/${doc.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                    <ExternalLink className="h-3 w-3" /> {doc.archivoNombre}
                </a>
                <span>{tamano(doc.archivoTamano)}</span>
                <span>{fechaHora(doc.creado)}</span>
            </p>

            {doc.estado !== 'PENDIENTE' && (doc.nota || doc.revisadoPor) && (
                <p className="text-xs rounded bg-slate-50 p-2 text-slate-600">
                    {doc.nota && <>Nota: {doc.nota}<br /></>}
                    {doc.revisadoPor && <>Por {doc.revisadoPor}{doc.revisadoEn ? ` · ${fechaHora(doc.revisadoEn)}` : ''}</>}
                </p>
            )}

            {puedeEditar && doc.estado === 'PENDIENTE' && (
                <>
                    <Textarea
                        value={nota}
                        onChange={(ev) => setNota(ev.target.value)}
                        placeholder="Nota (opcional al aprobar, obligatoria al rechazar)"
                        className="text-sm"
                    />
                    <div className="flex gap-2">
                        <Button size="sm" disabled={guardando} onClick={() => cambiar('REVISADO')} className="bg-emerald-600 hover:bg-emerald-700">
                            <CheckCircle2 className="h-4 w-4 mr-1" /> Marcar revisado
                        </Button>
                        <Button size="sm" disabled={guardando} onClick={() => cambiar('RECHAZADO')} className="bg-red-600 hover:bg-red-700">
                            <XCircle className="h-4 w-4 mr-1" /> Rechazar
                        </Button>
                    </div>
                </>
            )}

            {puedeEditar && doc.estado !== 'PENDIENTE' && (
                <Button
                    size="sm"
                    variant="outline"
                    disabled={guardando}
                    onClick={() => cambiar('PENDIENTE')}
                    className="border-amber-300 text-amber-700 hover:bg-amber-50"
                >
                    <RotateCcw className="h-4 w-4 mr-1" /> Devolver a pendientes
                </Button>
            )}
        </div>
    )
}
