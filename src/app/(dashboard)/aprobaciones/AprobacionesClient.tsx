'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Clock, AlertTriangle } from 'lucide-react'
import { CorregirJornada, ResolverExtras } from '@/components/AccionesAlerta'
import { fechaColombiaISO, horaColombia24, salidaAutomatica } from '@/lib/asistencia'

function minutosAHoras(min: number) {
    const h = Math.floor(min / 60)
    const m = min % 60
    return `${h}h ${m}m`
}

function fechaDMA(iso: string) {
    return fechaColombiaISO(iso).split('-').reverse().join('/')
}

// ─── PANEL DE EXTRAS ────────────────────────────────────────────────────────

interface Aprobacion {
    id: string
    minutos_solicitados: number
    estado: string
    created_at: string
    empleado_id: string
    jornada_id: string
    jornadas: { entrada: string; salida: string | null; operacion: string; minutos_total: number } | null
    usuarios: { nombre: string; operacion: string } | null
}

export function AprobacionesPanel({ aprobaciones }: { aprobaciones: Aprobacion[] }) {
    if (aprobaciones.length === 0) {
        return (
            <div className="text-center py-12 text-slate-500">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-400" />
                <p className="font-medium">No hay horas extra pendientes de aprobación.</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {aprobaciones.map(ap => (
                <div key={ap.id} className="border rounded-lg p-4 bg-white space-y-3">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <Link href={`/empleados/${ap.empleado_id}`} className="font-semibold text-slate-800 hover:underline">
                                {ap.usuarios?.nombre ?? ap.empleado_id}
                            </Link>
                            <p className="text-sm text-slate-500">{ap.jornadas?.operacion}</p>
                        </div>
                        <Badge variant="outline" className="text-amber-600 border-amber-400 bg-amber-50 whitespace-nowrap">
                            <Clock className="w-3 h-3 mr-1" />
                            {minutosAHoras(ap.minutos_solicitados)} extra
                        </Badge>
                    </div>
                    {ap.jornadas?.entrada && (
                        <p className="text-xs text-slate-500">
                            Jornada del {fechaDMA(ap.jornadas.entrada)}: {horaColombia24(ap.jornadas.entrada)}
                            {ap.jornadas.salida && ` → ${horaColombia24(ap.jornadas.salida)}`}
                            {ap.jornadas.minutos_total ? ` (${minutosAHoras(ap.jornadas.minutos_total)} pagables)` : ''}
                        </p>
                    )}
                    <ResolverExtras aprobacionId={ap.id} />
                </div>
            ))}
        </div>
    )
}

// ─── PANEL DE CIERRES AUTOMÁTICOS ───────────────────────────────────────────

interface Inconsistente {
    id: string
    empleado_id: string
    operacion: string
    entrada: string
    usuarios: { nombre: string } | null
}

export function InconsistentesPanel({ jornadas }: { jornadas: Inconsistente[] }) {
    if (jornadas.length === 0) {
        return (
            <div className="text-center py-12 text-slate-500">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-400" />
                <p className="font-medium">No hay jornadas sin salida por validar.</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {jornadas.map(j => {
                const auto = salidaAutomatica(j.entrada)
                return (
                    <div key={j.id} className="border border-red-200 rounded-lg p-4 bg-red-50 space-y-3">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <Link href={`/empleados/${j.empleado_id}`} className="font-semibold text-slate-800 hover:underline">
                                    {j.usuarios?.nombre ?? j.empleado_id}
                                </Link>
                                <p className="text-sm text-slate-500">{j.operacion}</p>
                            </div>
                            <Badge variant="destructive" className="whitespace-nowrap">
                                <AlertTriangle className="w-3 h-3 mr-1" /> Cierre automático
                            </Badge>
                        </div>
                        <p className="text-xs text-slate-600">
                            No marcó salida. Cierre automático a las 15:00 h ({fechaDMA(auto.toISOString())} {horaColombia24(auto)}).
                            Estas horas <b>no se pagan</b> hasta registrar la salida real.
                        </p>
                        <CorregirJornada jornadaId={j.id} entrada={j.entrada} />
                    </div>
                )
            })}
        </div>
    )
}
