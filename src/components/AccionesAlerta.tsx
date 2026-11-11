'use client'

/**
 * Acciones de corrección reutilizables. Se usan igual en el Panel de Control,
 * en las alertas del perfil del colaborador y en la asistencia diaria, para
 * que el coordinador resuelva la novedad desde donde la ve.
 *
 * Todas piden motivo: queda guardado con el usuario, la fecha y la hora.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, XCircle } from 'lucide-react'
import {
    aprobarExtras,
    corregirInconsistente,
    marcarAlertaRevisada,
    rechazarExtras,
} from '@/app/(dashboard)/aprobaciones/actions'
import {
    ETIQUETA_RESULTADO_EXTRAS,
    fechaColombiaISO,
    horaColombia24,
    type ResultadoExtras,
} from '@/lib/asistencia'

// ─── Registrar la salida real de una jornada sin salida ─────────────────────

export function CorregirJornada({
    jornadaId,
    entrada,
    onListo,
}: {
    jornadaId: string
    entrada: string
    onListo?: () => void
}) {
    const router = useRouter()
    const fechaEntrada = fechaColombiaISO(entrada)
    const [fecha, setFecha] = useState(fechaEntrada)
    const [hora, setHora] = useState('')
    const [motivo, setMotivo] = useState('')
    const [guardando, setGuardando] = useState(false)

    const guardar = async () => {
        if (!hora) { toast.error('Ingresa la hora real de salida.'); return }
        if (!motivo.trim()) { toast.error('Escribe el motivo de la corrección.'); return }

        // Hora de Bogotá → instante real
        let salida = new Date(`${fecha}T${hora}:00-05:00`)
        // Si no cambiaron el día y la hora es menor a la de entrada, el turno cruzó la medianoche
        if (fecha === fechaEntrada && salida.getTime() <= new Date(entrada).getTime()) {
            salida = new Date(salida.getTime() + 24 * 60 * 60 * 1000)
        }

        setGuardando(true)
        const res = await corregirInconsistente(jornadaId, salida.toISOString(), motivo)
        setGuardando(false)
        if (!res.success) { toast.error(res.error ?? 'No se pudo corregir'); return }
        toast.success('Salida registrada. Las horas se recalcularon.')
        onListo?.()
        router.refresh()
    }

    return (
        <div className="space-y-2">
            <p className="text-xs text-slate-600">
                Entrada: <b>{fechaEntrada.split('-').reverse().join('/')}</b> a las <b>{horaColombia24(entrada)}</b>.
                Registra la salida real:
            </p>
            <div className="flex flex-wrap items-end gap-2">
                <div>
                    <label className="text-[11px] text-slate-500 block mb-1">Día de salida</label>
                    <Input
                        type="date"
                        value={fecha}
                        min={fechaEntrada}
                        onChange={(e) => setFecha(e.target.value)}
                        className="bg-white h-9 w-40"
                    />
                </div>
                <div>
                    <label className="text-[11px] text-slate-500 block mb-1">Hora de salida</label>
                    <Input
                        type="time"
                        value={hora}
                        onChange={(e) => setHora(e.target.value)}
                        className="bg-white h-9 w-32"
                    />
                </div>
            </div>
            <Textarea
                placeholder="Motivo de la corrección (obligatorio). Ej.: olvidó marcar salida, confirmó supervisor."
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                className="text-sm bg-white"
            />
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" disabled={guardando} onClick={guardar}>
                {guardando ? 'Guardando…' : 'Finalizar turno'}
            </Button>
        </div>
    )
}

// ─── Aprobar o rechazar horas extra ─────────────────────────────────────────

export function ResolverExtras({ aprobacionId, onListo }: { aprobacionId: string; onListo?: () => void }) {
    const router = useRouter()
    const [nota, setNota] = useState('')
    const [resultado, setResultado] = useState<ResultadoExtras>('PAGADA_NOMINA')
    const [guardando, setGuardando] = useState(false)

    const resolver = async (accion: 'aprobar' | 'rechazar') => {
        if (accion === 'rechazar' && !nota.trim()) {
            toast.error('Para rechazar, escribe el motivo.')
            return
        }
        setGuardando(true)
        const res = accion === 'aprobar'
            ? await aprobarExtras(aprobacionId, nota, resultado)
            : await rechazarExtras(aprobacionId, nota)
        setGuardando(false)
        if (!res.success) { toast.error(res.error ?? 'No se pudo guardar'); return }
        toast.success(accion === 'aprobar' ? 'Horas extra aprobadas.' : 'Horas extra rechazadas.')
        onListo?.()
        router.refresh()
    }

    return (
        <div className="space-y-2">
            <div>
                <label className="text-[11px] text-slate-500 block mb-1">Si se aprueban, ¿cómo se reconocen?</label>
                <select
                    value={resultado}
                    onChange={(e) => setResultado(e.target.value as ResultadoExtras)}
                    className="h-9 px-2 w-full max-w-xs border border-slate-200 rounded-md text-sm bg-white"
                >
                    {(['PAGADA_NOMINA', 'COMPENSADA_TIEMPO', 'RECONOCIDA_CLIENTE'] as ResultadoExtras[]).map((r) => (
                        <option key={r} value={r}>{ETIQUETA_RESULTADO_EXTRAS[r]}</option>
                    ))}
                </select>
            </div>
            <Textarea
                placeholder="Motivo (opcional para aprobar, obligatorio para rechazar)"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={2}
                className="text-sm bg-white"
            />
            <div className="flex gap-2">
                <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 gap-1"
                    disabled={guardando}
                    onClick={() => resolver('aprobar')}
                >
                    <CheckCircle2 className="w-4 h-4" /> Aprobar
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    className="border-red-400 text-red-600 hover:bg-red-50 gap-1 bg-white"
                    disabled={guardando}
                    onClick={() => resolver('rechazar')}
                >
                    <XCircle className="w-4 h-4" /> Rechazar
                </Button>
            </div>
        </div>
    )
}

// ─── Marcar como revisada una alerta informativa (jornada >12h) ─────────────

export function RevisarAlerta({ alertaId, onListo }: { alertaId: string; onListo?: () => void }) {
    const router = useRouter()
    const [motivo, setMotivo] = useState('')
    const [guardando, setGuardando] = useState(false)

    const guardar = async () => {
        if (!motivo.trim()) { toast.error('Escribe la justificación.'); return }
        setGuardando(true)
        const res = await marcarAlertaRevisada(alertaId, motivo)
        setGuardando(false)
        if (!res.success) { toast.error(res.error ?? 'No se pudo guardar'); return }
        toast.success('Alerta marcada como revisada.')
        onListo?.()
        router.refresh()
    }

    return (
        <div className="space-y-2">
            <Textarea
                placeholder="Justificación (obligatoria). Ej.: turno extendido autorizado por el cliente."
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                className="text-sm bg-white"
            />
            <Button size="sm" variant="outline" className="bg-white" disabled={guardando} onClick={guardar}>
                {guardando ? 'Guardando…' : 'Marcar como revisada'}
            </Button>
        </div>
    )
}
