'use client'

/**
 * Tabla de asistencia día a día. Muestra TODOS los días, también los que no
 * tienen marcación (00:00 – 00:00, "Sin asistencia") y los que tienen novedad.
 *
 * - modo "colaborador": histórico de una persona (la primera columna es la fecha).
 * - modo "dia": resumen diario de una operación (la primera columna es el colaborador).
 */

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CorregirJornada } from '@/components/AccionesAlerta'
import {
    ETIQUETA_ESTADO_DIA,
    etiquetaNovedad,
    fechaCortaConDia,
    horaColombia24,
    salidaAutomatica,
    type EstadoDia,
} from '@/lib/asistencia'
import type { FilaAsistencia } from '@/lib/asistenciaDatos'

function fmtMinutos(min: number): string {
    const h = Math.floor((min || 0) / 60)
    const m = (min || 0) % 60
    return `${h}h ${String(m).padStart(2, '0')}m`
}

const ESTILO_ESTADO: Record<EstadoDia, string> = {
    ASISTIO: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    PENDIENTE: 'bg-blue-100 text-blue-700 border-blue-200',
    CIERRE_AUTOMATICO: 'bg-red-100 text-red-700 border-red-200',
    NOVEDAD: 'bg-purple-100 text-purple-700 border-purple-200',
    SIN_ASISTENCIA: 'bg-slate-200 text-slate-700 border-slate-300',
}

function Desglose({ f }: { f: FilaAsistencia }) {
    const j = f.jornada
    if (!j || f.estado !== 'ASISTIO') return <span className="text-xs text-slate-400">—</span>
    const tipos = [
        { min: j.minutos_extras_ordinarias, label: 'Extra', cls: 'bg-emerald-100 text-emerald-700' },
        { min: j.minutos_nocturnas, label: 'Noct', cls: 'bg-indigo-100 text-indigo-700' },
        { min: j.minutos_extras_nocturnas, label: 'Ex Noct', cls: 'bg-pink-100 text-pink-700' },
        { min: j.minutos_domingos, label: 'Dom', cls: 'bg-blue-100 text-blue-700' },
        { min: j.minutos_festivos, label: 'Fest', cls: 'bg-amber-100 text-amber-800' },
        { min: j.minutos_domingos_festivos_nocturnos, label: 'D/F N', cls: 'bg-violet-100 text-violet-700' },
        { min: j.minutos_extras_dominical_festivo, label: 'Ex D/F', cls: 'bg-orange-100 text-orange-700' },
        { min: j.minutos_extras_nocturna_dominical_festivo, label: 'Ex D/F N', cls: 'bg-red-100 text-red-700' },
    ].filter((t) => t.min > 0)
    if (tipos.length === 0) return <span className="text-xs text-slate-400">Solo ordinarias</span>
    return (
        <div className="flex flex-wrap gap-1">
            {tipos.map((t) => (
                <span key={t.label} className={`inline-flex gap-1 px-1.5 py-0.5 text-[11px] rounded ${t.cls}`}>
                    <b>{t.label}</b>
                    <span className="font-mono">{fmtMinutos(t.min)}</span>
                </span>
            ))}
        </div>
    )
}

export function TablaAsistencia({
    filas,
    modo,
    puedeCorregir = true,
}: {
    filas: FilaAsistencia[]
    modo: 'colaborador' | 'dia'
    puedeCorregir?: boolean
}) {
    const [corrigiendo, setCorrigiendo] = useState<string | null>(null)

    if (filas.length === 0) {
        return <p className="text-sm text-slate-500 py-8 text-center">No hay días para mostrar en este período.</p>
    }

    return (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{modo === 'colaborador' ? 'Día' : 'Colaborador'}</TableHead>
                        <TableHead>Entrada</TableHead>
                        <TableHead>Salida</TableHead>
                        <TableHead>Horas pagables</TableHead>
                        <TableHead>Retardo</TableHead>
                        <TableHead>Desglose</TableHead>
                        <TableHead>Operación</TableHead>
                        <TableHead>Estado</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {filas.map((f) => {
                        const j = f.jornada
                        const clave = `${f.colaborador.id}-${f.fecha}-${j?.id ?? 'sin'}`
                        const sinMarcacion = !j
                        const abierta = f.estado === 'PENDIENTE' || f.estado === 'CIERRE_AUTOMATICO'
                        const liquidada = f.estado === 'ASISTIO'

                        return (
                            <TableRow
                                key={clave}
                                className={
                                    f.estado === 'CIERRE_AUTOMATICO'
                                        ? 'bg-red-50/60'
                                        : f.inasistencia
                                            ? 'bg-slate-50'
                                            : ''
                                }
                            >
                                <TableCell className="font-medium whitespace-nowrap">
                                    {modo === 'colaborador' ? (
                                        <>
                                            {fechaCortaConDia(f.fecha)}
                                            {f.esDomingo && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">Domingo</span>}
                                            {f.esFestivo && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Festivo</span>}
                                        </>
                                    ) : (
                                        <Link href={`/empleados/${f.colaborador.id}`} className="hover:underline">
                                            <div className="text-sm text-blue-700">{f.colaborador.nombre}</div>
                                            <div className="text-xs text-slate-500 font-normal">CC {f.colaborador.id}</div>
                                        </Link>
                                    )}
                                </TableCell>

                                <TableCell className="font-mono text-sm">
                                    {j ? horaColombia24(j.entrada) : <span className="text-slate-400">00:00</span>}
                                </TableCell>

                                <TableCell className="font-mono text-sm">
                                    {sinMarcacion && <span className="text-slate-400">00:00</span>}
                                    {liquidada && j?.salida && horaColombia24(j.salida)}
                                    {f.estado === 'PENDIENTE' && <span className="text-blue-700 font-sans font-medium">Pendiente</span>}
                                    {f.estado === 'CIERRE_AUTOMATICO' && j && (
                                        <span className="text-red-700" title="Salida automática: entrada + 15:00 h">
                                            {horaColombia24(salidaAutomatica(j.entrada))}
                                            <span className="block text-[10px] font-sans">automática</span>
                                        </span>
                                    )}
                                </TableCell>

                                <TableCell className="font-mono font-semibold">
                                    {liquidada && j ? (
                                        <>
                                            {fmtMinutos(j.minutos_total)}
                                            {j.minutos_almuerzo_descontados > 0 && (
                                                <div className="text-[10px] text-slate-400 font-normal">
                                                    -{j.minutos_almuerzo_descontados}min almuerzo
                                                </div>
                                            )}
                                        </>
                                    ) : f.estado === 'CIERRE_AUTOMATICO' ? (
                                        <span className="text-red-700 font-sans text-xs font-medium">No pagables hasta validar</span>
                                    ) : (
                                        <span className="text-slate-400">0h 00m</span>
                                    )}
                                </TableCell>

                                <TableCell className="text-sm whitespace-nowrap">
                                    {!j ? (
                                        <span className="text-slate-300">—</span>
                                    ) : f.retardoMin === null ? (
                                        <span className="text-xs text-slate-400" title="No hay turno configurado para comparar la hora de entrada">Sin turno</span>
                                    ) : f.retardoMin > 0 ? (
                                        <span className="inline-flex px-2 py-0.5 rounded bg-orange-100 text-orange-800 font-semibold" title={`Turno ${f.turnoNombre}`}>
                                            {f.retardoMin} min
                                        </span>
                                    ) : (
                                        <span className="text-emerald-600 text-xs">A tiempo</span>
                                    )}
                                </TableCell>

                                <TableCell><Desglose f={f} /></TableCell>

                                <TableCell className="text-sm text-slate-600">
                                    {f.operacion || <span className="text-red-600">Sin operación</span>}
                                    {f.operacionDistinta && (
                                        <div className="text-[10px] text-orange-700 font-medium" title={`Operación asignada: ${f.colaborador.operacion}`}>
                                            ≠ operación asignada
                                        </div>
                                    )}
                                </TableCell>

                                <TableCell>
                                    <span className={`inline-flex text-xs px-2 py-0.5 rounded-full border ${ESTILO_ESTADO[f.estado]}`}>
                                        {f.estado === 'NOVEDAD'
                                            ? f.novedades.map((n) => etiquetaNovedad(n.tipo)).join(', ')
                                            : ETIQUETA_ESTADO_DIA[f.estado]}
                                    </span>
                                    {f.timbradaConNovedad && (
                                        <div className="text-[10px] text-purple-700 mt-1">
                                            + novedad: {f.novedades.map((n) => etiquetaNovedad(n.tipo)).join(', ')}
                                        </div>
                                    )}
                                    {j?.alerta_critica && <div className="text-[10px] text-orange-700 mt-1">Jornada &gt;12h</div>}
                                    {j?.fuera_geocerca && (
                                        <div
                                            className="text-[10px] text-rose-700 mt-1 font-medium"
                                            title={`Entrada: ${j.entrada_distancia_m ?? 'sin ubicación'} m · Salida: ${j.salida_distancia_m ?? 'sin ubicación'} m`}
                                        >
                                            Fuera de geocerca
                                        </div>
                                    )}
                                    {j?.marcacion_offline && (
                                        <div className="text-[10px] text-slate-600 mt-1">Marcó sin conexión</div>
                                    )}
                                    {j && (j.foto_entrada || j.foto_salida) && (
                                        <div className="text-[10px] mt-1 space-x-2">
                                            {j.foto_entrada && (
                                                <a className="text-blue-700 underline" href={`/api/fotos?jornada=${j.id}&tipo=entrada`} target="_blank" rel="noreferrer">
                                                    Foto entrada
                                                </a>
                                            )}
                                            {j.foto_salida && (
                                                <a className="text-blue-700 underline" href={`/api/fotos?jornada=${j.id}&tipo=salida`} target="_blank" rel="noreferrer">
                                                    Foto salida
                                                </a>
                                            )}
                                        </div>
                                    )}
                                    {abierta && j && puedeCorregir && (
                                        <div className="mt-1.5">
                                            {corrigiendo === j.id ? (
                                                <div className="min-w-64 p-2 rounded border bg-white">
                                                    <CorregirJornada jornadaId={j.id} entrada={j.entrada} onListo={() => setCorrigiendo(null)} />
                                                    <button className="text-xs text-slate-500 underline mt-1" onClick={() => setCorrigiendo(null)}>
                                                        Cancelar
                                                    </button>
                                                </div>
                                            ) : (
                                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCorrigiendo(j.id)}>
                                                    Registrar salida
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </TableCell>
                            </TableRow>
                        )
                    })}
                </TableBody>
            </Table>
        </div>
    )
}
