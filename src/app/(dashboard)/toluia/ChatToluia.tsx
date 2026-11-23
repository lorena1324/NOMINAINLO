'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Send, Sparkles, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type Mensaje = { role: 'user' | 'assistant'; content: string }

const SUGERENCIAS = [
    '¿Cómo vamos en la quincena?',
    '¿Quiénes tienen inasistencias sin novedad?',
    '¿Qué falta por revisar antes del cierre?',
    '¿Quiénes tienen más retardos?',
    '¿Cuántas horas extra hay pendientes de aprobar?',
    'Compara las operaciones por horas y valor',
]

export function ChatToluia({
    esAdmin,
    operacionFija,
    operaciones,
    etiquetaActual,
    etiquetaAnterior,
}: {
    esAdmin: boolean
    operacionFija: string | null
    operaciones: string[]
    etiquetaActual: string
    etiquetaAnterior: string
}) {
    const [mensajes, setMensajes] = useState<Mensaje[]>([])
    const [texto, setTexto] = useState('')
    const [quincena, setQuincena] = useState<'actual' | 'anterior'>('actual')
    const [operacion, setOperacion] = useState('')
    const [respondiendo, setRespondiendo] = useState(false)
    const finRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, [mensajes])

    // Cambiar de quincena u operación empieza una conversación nueva (otros datos)
    const reiniciar = () => setMensajes([])

    const preguntar = async (pregunta: string) => {
        const limpia = pregunta.trim()
        if (!limpia || respondiendo) return
        const historial: Mensaje[] = [...mensajes, { role: 'user', content: limpia }]
        setMensajes([...historial, { role: 'assistant', content: '' }])
        setTexto('')
        setRespondiendo(true)

        try {
            const res = await fetch('/api/toluia', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mensajes: historial, quincena, operacion: operacion || null }),
            })
            if (!res.ok || !res.body) {
                const json = await res.json().catch(() => ({}))
                throw new Error(json.error ?? 'TOLUIA no pudo responder.')
            }
            const lector = res.body.getReader()
            const decoder = new TextDecoder()
            let acumulado = ''
            for (;;) {
                const { done, value } = await lector.read()
                if (done) break
                acumulado += decoder.decode(value, { stream: true })
                setMensajes([...historial, { role: 'assistant', content: acumulado }])
            }
            if (!acumulado.trim()) {
                setMensajes([...historial, { role: 'assistant', content: '⚠️ TOLUIA no devolvió respuesta. Intenta de nuevo.' }])
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'TOLUIA no pudo responder.'
            setMensajes([...historial, { role: 'assistant', content: `⚠️ ${msg}` }])
        } finally {
            setRespondiendo(false)
        }
    }

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] max-w-4xl mx-auto">
            <div className="flex flex-wrap items-end justify-between gap-3 pb-4 border-b">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Sparkles className="h-7 w-7 text-violet-600" /> TOLUIA
                    </h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Tu asistente para saber cómo va la quincena
                        {operacionFija ? ` en ${operacionFija}` : ''}.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <select
                        className="h-9 rounded-md border px-2 text-sm bg-background"
                        value={quincena}
                        disabled={respondiendo}
                        onChange={(e) => { setQuincena(e.target.value as 'actual' | 'anterior'); reiniciar() }}
                    >
                        <option value="actual">{etiquetaActual}</option>
                        <option value="anterior">{etiquetaAnterior}</option>
                    </select>
                    {esAdmin && (
                        <select
                            className="h-9 rounded-md border px-2 text-sm bg-background max-w-[220px]"
                            value={operacion}
                            disabled={respondiendo}
                            onChange={(e) => { setOperacion(e.target.value); reiniciar() }}
                        >
                            <option value="">Todas las operaciones</option>
                            {operaciones.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                    )}
                    {mensajes.length > 0 && (
                        <Button variant="outline" size="sm" onClick={reiniciar} disabled={respondiendo}>
                            <RotateCcw className="h-4 w-4 mr-1" /> Nueva
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-4">
                {mensajes.length === 0 && (
                    <div className="text-center py-10 space-y-5">
                        <p className="text-slate-600">Pregúntame por asistencia, horas, extras, retardos o pendientes.</p>
                        <div className="flex flex-wrap justify-center gap-2">
                            {SUGERENCIAS.map((s) => (
                                <button
                                    key={s}
                                    onClick={() => preguntar(s)}
                                    className="rounded-full border bg-white px-3 py-1.5 text-sm hover:bg-violet-50 hover:border-violet-300"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {mensajes.map((m, i) => (
                    <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                        <div
                            className={
                                m.role === 'user'
                                    ? 'max-w-[80%] rounded-2xl bg-violet-600 text-white px-4 py-2 text-sm whitespace-pre-wrap'
                                    : 'max-w-[95%] rounded-2xl bg-white border px-4 py-3 text-sm toluia-respuesta'
                            }
                        >
                            {m.role === 'user' ? (
                                m.content
                            ) : m.content ? (
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                            ) : (
                                <span className="text-slate-400 animate-pulse">TOLUIA está revisando los datos…</span>
                            )}
                        </div>
                    </div>
                ))}
                <div ref={finRef} />
            </div>

            <form
                onSubmit={(e) => { e.preventDefault(); preguntar(texto) }}
                className="flex gap-2 border-t pt-3"
            >
                <Textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); preguntar(texto) }
                    }}
                    placeholder="Escribe tu pregunta… (Enter para enviar)"
                    className="min-h-[44px] max-h-40 resize-none"
                    disabled={respondiendo}
                />
                <Button type="submit" disabled={respondiendo || !texto.trim()} className="bg-violet-600 hover:bg-violet-700 self-end">
                    <Send className="h-4 w-4" />
                </Button>
            </form>
            <p className="text-[11px] text-muted-foreground pt-1">
                TOLUIA responde con los datos de la app; revisa las cifras antes de tomar decisiones de nómina.
            </p>
        </div>
    )
}
