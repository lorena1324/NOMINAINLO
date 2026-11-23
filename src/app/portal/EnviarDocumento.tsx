'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FileUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { prepararSubida, registrarDocumento } from './actions'

const BUCKET = 'documentos-empleados'
const MAXIMO = 10 * 1024 * 1024

export function EnviarDocumento() {
    const router = useRouter()
    const [archivo, setArchivo] = useState<File | null>(null)
    const [descripcion, setDescripcion] = useState('')
    const [enviando, setEnviando] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const enviar = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!archivo) { toast.error('Elige el PDF.'); return }
        if (archivo.size > MAXIMO) { toast.error('El PDF supera 10 MB.'); return }
        if (descripcion.trim().length < 3) { toast.error('Escribe de qué se trata el documento.'); return }

        setEnviando(true)
        const id = toast.loading('Enviando documento…')
        try {
            const permiso = await prepararSubida({ nombre: archivo.name, tamano: archivo.size, tipo: archivo.type })
            if (!permiso.success) { toast.error(permiso.error, { id }); return }

            const { error } = await createClient()
                .storage.from(BUCKET)
                .uploadToSignedUrl(permiso.ruta, permiso.token, archivo, { contentType: 'application/pdf' })
            if (error) { toast.error('No se pudo subir el archivo. Revisa tu conexión e intenta de nuevo.', { id }); return }

            const res = await registrarDocumento({ ruta: permiso.ruta, nombre: archivo.name, descripcion })
            if (!res.success) { toast.error(res.error ?? 'No se pudo registrar el documento.', { id }); return }

            toast.success('Documento enviado. Tu coordinador lo revisará.', { id })
            setArchivo(null)
            setDescripcion('')
            if (inputRef.current) inputRef.current.value = ''
            router.refresh()
        } catch {
            toast.error('No hay conexión. Intenta de nuevo.', { id })
        } finally {
            setEnviando(false)
        }
    }

    return (
        <form onSubmit={enviar} className="rounded-xl border bg-white p-5 space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
                <FileUp className="h-5 w-5 text-sky-600" /> Enviar un documento
            </h2>
            <div className="space-y-2">
                <Label htmlFor="descripcion">¿De qué se trata?</Label>
                <Textarea
                    id="descripcion"
                    value={descripcion}
                    maxLength={300}
                    onChange={(e) => setDescripcion(e.target.value)}
                    placeholder="Ej.: Incapacidad médica del 16 al 23 de noviembre"
                />
            </div>
            <div className="space-y-2">
                <Label htmlFor="pdf">Archivo PDF (máx. 10 MB)</Label>
                <Input
                    id="pdf"
                    ref={inputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                />
                <p className="text-xs text-muted-foreground">
                    Si tienes una foto, conviértela a PDF antes de enviarla.
                </p>
            </div>
            <Button type="submit" disabled={enviando} className="w-full sm:w-auto">
                {enviando ? 'Enviando…' : 'Enviar documento'}
            </Button>
        </form>
    )
}
