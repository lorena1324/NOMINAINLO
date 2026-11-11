'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { getOperacionesActivas } from './operaciones-actions'
import { Filter, RotateCcw, Check, X, ChevronDown, Download } from 'lucide-react'
import { ExportPlanosDialog } from '@/components/ExportPlanosDialog'

type TipoPeriodo = 'quincenal' | 'semanal' | 'mensual' | 'personalizado'

/**
 * Dado un tipo de período y un mes/año base, retorna el rango ISO YYYY-MM-DD.
 * Para períodos agrupados se usa el mes completo; la página lo va a partir.
 */
function defaultRange(tipo: TipoPeriodo, mes: number, anio: number): { start: string; end: string } {
    const inicio = new Date(anio, mes, 1)
    const fin = new Date(anio, mes + 1, 0)
    return {
        start: inicio.toISOString().slice(0, 10),
        end: fin.toISOString().slice(0, 10),
    }
}

export function AdminFilters({ operacionFija }: { rol: string; operacionFija: string | null }) {
    // Con operación fija (coordinador o visualizador) no se puede elegir otra
    const puedeElegirOperacion = !operacionFija
    const router = useRouter()
    const searchParams = useSearchParams()

    const now = new Date()
    const initialMes = parseInt(searchParams.get('mes') ?? String(now.getMonth()))
    const initialAnio = parseInt(searchParams.get('anio') ?? String(now.getFullYear()))
    const initialPeriodo = (searchParams.get('periodo') as TipoPeriodo) || 'quincenal'

    const defaults = defaultRange(initialPeriodo, initialMes, initialAnio)

    const [periodo, setPeriodo] = useState<TipoPeriodo>(initialPeriodo)
    const [start, setStart] = useState(searchParams.get('start') || defaults.start)
    const [end, setEnd] = useState(searchParams.get('end') || defaults.end)
    const [operacionesSeleccionadas, setOperacionesSeleccionadas] = useState<string[]>(
        searchParams.get('op') ? searchParams.get('op')!.split(',') : [],
    )
    const [listaOperaciones, setListaOperaciones] = useState<{ id: string; nombre: string }[]>([])
    const [dropdownOpen, setDropdownOpen] = useState(false)
    const [isLoading, setIsLoading] = useState(false)

    const dropdownRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        getOperacionesActivas().then((res) => {
            if (res.success && res.data) setListaOperaciones(res.data)
        })
    }, [])

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    // Cuando cambia el tipo de período, ajustar el rango a valores coherentes
    function handlePeriodoChange(p: TipoPeriodo) {
        setPeriodo(p)
        if (p !== 'personalizado') {
            const d = new Date(start)
            const rango = defaultRange(p, d.getMonth(), d.getFullYear())
            setStart(rango.start)
            setEnd(rango.end)
        }
    }

    const toggleOperacion = (opNombre: string) => {
        setOperacionesSeleccionadas((prev) =>
            prev.includes(opNombre) ? prev.filter((o) => o !== opNombre) : [...prev, opNombre],
        )
    }

    const handleApply = () => {
        setIsLoading(true)
        const params = new URLSearchParams()
        const d = new Date(start)

        params.set('mes', String(d.getMonth()))
        params.set('anio', String(d.getFullYear()))
        params.set('periodo', periodo)

        if (periodo === 'personalizado') {
            params.set('start', start)
            params.set('end', end)
        }
        if (operacionesSeleccionadas.length > 0) {
            params.set('op', operacionesSeleccionadas.join(','))
        }

        router.push(`?${params.toString()}`)
        setIsLoading(false)
    }

    const handleReset = () => {
        setIsLoading(true)
        const rango = defaultRange('quincenal', now.getMonth(), now.getFullYear())
        setPeriodo('quincenal')
        setStart(rango.start)
        setEnd(rango.end)
        setOperacionesSeleccionadas([])
        router.push('?')
        setIsLoading(false)
    }

    const totalOps = listaOperaciones.length
    const opsLabel =
        operacionesSeleccionadas.length === 0
            ? 'Todas las operaciones'
            : operacionesSeleccionadas.length === 1
                ? operacionesSeleccionadas[0]
                : `${operacionesSeleccionadas.length} seleccionadas`

    return (
        <div className="bg-white rounded-xl border shadow-sm p-4 md:p-5 mb-6">
            {/* Línea superior: filtros compactos */}
            <div className="flex flex-wrap items-end gap-3">
                {/* Período */}
                <div className="space-y-1.5 min-w-40 flex-1 md:flex-none">
                    <Label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                        Período
                    </Label>
                    <select
                        value={periodo}
                        onChange={(e) => handlePeriodoChange(e.target.value as TipoPeriodo)}
                        className="w-full h-10 px-3 bg-white border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition"
                    >
                        <option value="quincenal">Quincenal</option>
                        <option value="semanal">Semanal</option>
                        <option value="mensual">Mensual</option>
                        <option value="personalizado">Personalizado</option>
                    </select>
                </div>

                {/* Desde */}
                <div className="space-y-1.5 flex-1 min-w-35">
                    <Label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                        Desde
                    </Label>
                    <input
                        type="date"
                        value={start}
                        onChange={(e) => {
                            setStart(e.target.value)
                            if (periodo !== 'personalizado') setPeriodo('personalizado')
                        }}
                        className="w-full h-10 px-3 bg-white border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition"
                    />
                </div>

                {/* Hasta */}
                <div className="space-y-1.5 flex-1 min-w-35">
                    <Label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                        Hasta
                    </Label>
                    <input
                        type="date"
                        value={end}
                        onChange={(e) => {
                            setEnd(e.target.value)
                            if (periodo !== 'personalizado') setPeriodo('personalizado')
                        }}
                        className="w-full h-10 px-3 bg-white border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-400 transition"
                    />
                </div>

                {/* Operaciones (solo admin) */}
                {puedeElegirOperacion && (
                    <div className="space-y-1.5 flex-1 min-w-50 relative" ref={dropdownRef}>
                        <Label className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                            Operaciones
                        </Label>
                        <button
                            type="button"
                            onClick={() => setDropdownOpen(!dropdownOpen)}
                            className="w-full h-10 px-3 bg-white border border-slate-200 rounded-md text-sm text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500/40 hover:border-slate-300 transition"
                        >
                            <span className={operacionesSeleccionadas.length === 0 ? 'text-slate-500' : 'text-slate-800 font-medium'}>
                                {opsLabel}
                            </span>
                            <ChevronDown
                                className={`w-4 h-4 text-slate-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
                            />
                        </button>

                        {dropdownOpen && (
                            <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
                                {totalOps === 0 ? (
                                    <div className="px-3 py-2.5 text-xs text-slate-400">Cargando…</div>
                                ) : (
                                    <>
                                        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50/80">
                                            <span className="text-xs text-slate-500">
                                                {operacionesSeleccionadas.length} de {totalOps}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setOperacionesSeleccionadas([])}
                                                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                                            >
                                                Limpiar
                                            </button>
                                        </div>
                                        {listaOperaciones.map((op) => {
                                            const isSelected = operacionesSeleccionadas.includes(op.nombre)
                                            return (
                                                <label
                                                    key={op.id}
                                                    className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-sm"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleOperacion(op.nombre)}
                                                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                    />
                                                    <span className={isSelected ? 'text-blue-700 font-medium' : 'text-slate-700'}>
                                                        {op.nombre}
                                                    </span>
                                                    {isSelected && <Check className="h-3.5 w-3.5 text-blue-600 ml-auto" />}
                                                </label>
                                            )
                                        })}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Botones */}
                <div className="flex gap-2 shrink-0">
                    <Button
                        variant="outline"
                        onClick={handleReset}
                        disabled={isLoading}
                        className="h-10 gap-1.5"
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Restablecer</span>
                    </Button>
                    <Button
                        onClick={handleApply}
                        disabled={isLoading}
                        className="h-10 gap-1.5 bg-blue-600 hover:bg-blue-700"
                    >
                        <Filter className="h-3.5 w-3.5" />
                        {isLoading ? 'Calculando…' : 'Aplicar'}
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => {
                            const params = new URLSearchParams()
                            params.set('start', start)
                            params.set('end', end)
                            if (operacionesSeleccionadas.length > 0) {
                                params.set('op', operacionesSeleccionadas.join(','))
                            }
                            window.open(`/api/reportes/nomina?${params.toString()}`, '_blank')
                        }}
                        disabled={!start || !end}
                        className="h-10 gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    >
                        <Download className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Nómina</span>
                    </Button>
                    <Button
                        variant="outline"
                        title="Todo lo que conviene revisar antes de cerrar la quincena"
                        onClick={() => {
                            const params = new URLSearchParams()
                            params.set('start', start)
                            params.set('end', end)
                            if (operacionesSeleccionadas.length > 0) {
                                params.set('op', operacionesSeleccionadas.join(','))
                            }
                            window.open(`/api/reportes/inconsistencias?${params.toString()}`, '_blank')
                        }}
                        disabled={!start || !end}
                        className="h-10 gap-1.5 border-red-300 text-red-700 hover:bg-red-50"
                    >
                        <Download className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Inconsistencias</span>
                    </Button>
                    <ExportPlanosDialog />
                </div>
            </div>

            {/* Chips de operaciones seleccionadas (solo si hay más de una) */}
            {puedeElegirOperacion && operacionesSeleccionadas.length > 1 && (
                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-slate-100">
                    {operacionesSeleccionadas.map((op) => (
                        <span
                            key={op}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-700 rounded-full border border-blue-200"
                        >
                            {op}
                            <button
                                type="button"
                                onClick={() => toggleOperacion(op)}
                                className="hover:text-blue-900 -mr-0.5"
                                aria-label={`Quitar ${op}`}
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    )
}
