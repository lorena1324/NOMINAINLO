'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { TablaAsistencia } from '@/components/TablaAsistencia'
import type { FilaAsistencia } from '@/lib/asistenciaDatos'

type Vista = 'todos' | 'presentes' | 'pendientes' | 'retardos' | 'ausentes' | 'novedades' | 'validar'

export function AsistenciaDiariaClient({
    filas,
    fecha,
    esHoy,
    puedeCorregir = true,
}: {
    filas: FilaAsistencia[]
    fecha: string
    esHoy: boolean
    /** false para el perfil visualizador: no muestra botones de corrección. */
    puedeCorregir?: boolean
}) {
    const [vista, setVista] = useState<Vista>('todos')
    const [turno, setTurno] = useState('')
    const [busqueda, setBusqueda] = useState('')

    // Orden por nombre para ubicar rápido a cada colaborador
    const ordenadas = useMemo(
        () => [...filas].sort((a, b) => a.colaborador.nombre.localeCompare(b.colaborador.nombre)),
        [filas],
    )

    const turnos = useMemo(
        () => Array.from(new Set(filas.map((f) => f.turnoNombre).filter(Boolean))).sort(),
        [filas],
    )

    const conteo = useMemo(() => {
        const c = { presentes: 0, pendientes: 0, retardos: 0, ausentes: 0, novedades: 0, validar: 0 }
        for (const f of filas) {
            if (f.jornada) c.presentes++
            if (f.estado === 'PENDIENTE') c.pendientes++
            if (f.retardoMin && f.retardoMin > 0) c.retardos++
            if (f.estado === 'SIN_ASISTENCIA') c.ausentes++
            if (f.estado === 'NOVEDAD') c.novedades++
            if (f.estado === 'CIERRE_AUTOMATICO' || f.operacionDistinta || f.timbradaConNovedad || !!f.jornada?.fuera_geocerca) c.validar++
        }
        return c
    }, [filas])

    const visibles = useMemo(() => {
        const texto = busqueda.trim().toLowerCase()
        return ordenadas.filter((f) => {
            if (texto && !f.colaborador.nombre.toLowerCase().includes(texto) && !f.colaborador.id.includes(texto)) {
                return false
            }
            if (turno) {
                // Quien no marcó (ausente o con novedad) se muestra en el primer turno de la lista
                const sinMarcacion = !f.jornada
                if (sinMarcacion ? turno !== turnos[0] : f.turnoNombre !== turno) return false
            }
            switch (vista) {
                case 'presentes': return !!f.jornada
                case 'pendientes': return f.estado === 'PENDIENTE'
                case 'retardos': return !!f.retardoMin && f.retardoMin > 0
                case 'ausentes': return f.estado === 'SIN_ASISTENCIA'
                case 'novedades': return f.estado === 'NOVEDAD'
                case 'validar': return f.estado === 'CIERRE_AUTOMATICO' || f.operacionDistinta || f.timbradaConNovedad || !!f.jornada?.fuera_geocerca
                default: return true
            }
        })
    }, [ordenadas, vista, turno, turnos, busqueda])

    const tarjetas: { vista: Vista; titulo: string; valor: number; cls: string }[] = [
        { vista: 'todos', titulo: 'Colaboradores', valor: filas.length, cls: 'text-slate-800' },
        { vista: 'presentes', titulo: 'Marcaron entrada', valor: conteo.presentes, cls: 'text-emerald-600' },
        { vista: 'pendientes', titulo: esHoy ? 'En turno (sin salida)' : 'Salida pendiente', valor: conteo.pendientes, cls: 'text-blue-600' },
        { vista: 'retardos', titulo: 'Con retardo', valor: conteo.retardos, cls: 'text-orange-600' },
        { vista: 'ausentes', titulo: 'Sin asistencia', valor: conteo.ausentes, cls: 'text-slate-700' },
        { vista: 'novedades', titulo: 'Con novedad', valor: conteo.novedades, cls: 'text-purple-600' },
        { vista: 'validar', titulo: 'Por validar', valor: conteo.validar, cls: 'text-red-600' },
    ]

    return (
        <div className="space-y-4">
            {/* Tarjetas: al hacer clic filtran la tabla */}
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
                {tarjetas.map((t) => (
                    <button
                        key={t.vista}
                        onClick={() => setVista(t.vista)}
                        className={`text-left rounded-xl border bg-white p-3 transition hover:shadow-sm ${
                            vista === t.vista ? 'ring-2 ring-blue-500 border-blue-300' : ''
                        }`}
                    >
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">{t.titulo}</p>
                        <p className={`text-2xl font-bold ${t.cls}`}>{t.valor}</p>
                    </button>
                ))}
            </div>

            <Card>
                <CardContent className="p-0">
                    <div className="flex flex-wrap items-center gap-3 p-4 border-b">
                        <input
                            value={busqueda}
                            onChange={(e) => setBusqueda(e.target.value)}
                            placeholder="Buscar por nombre o cédula…"
                            className="h-9 px-3 border border-slate-200 rounded-md text-sm w-64 max-w-full"
                        />
                        {turnos.length > 0 && (
                            <select
                                value={turno}
                                onChange={(e) => setTurno(e.target.value)}
                                className="h-9 px-3 border border-slate-200 rounded-md text-sm bg-white"
                            >
                                <option value="">Todos los turnos</option>
                                {turnos.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                            </select>
                        )}
                        <span className="text-xs text-slate-500 ml-auto">
                            {fecha.split('-').reverse().join('/')} · {visibles.length} de {filas.length}
                        </span>
                    </div>
                    <TablaAsistencia filas={visibles} modo="dia" puedeCorregir={puedeCorregir} />
                </CardContent>
            </Card>
        </div>
    )
}
