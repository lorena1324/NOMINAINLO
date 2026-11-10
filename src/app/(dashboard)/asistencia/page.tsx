import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getOperationFilter, getUserProfile } from '@/lib/auth'
import { construirMallaAsistencia } from '@/lib/asistenciaDatos'
import { hoyColombiaISO, quincenaDeFecha } from '@/lib/asistencia'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Download } from 'lucide-react'
import { AsistenciaDiariaClient } from './AsistenciaDiariaClient'

export const dynamic = 'force-dynamic'

/**
 * Resumen diario por operación: todos los colaboradores de la operación en la
 * fecha elegida — los que ya marcaron entrada (aunque no tengan salida), los
 * que tienen novedad y los que no han asistido.
 */
export default async function AsistenciaDiariaPage({
    searchParams,
}: {
    searchParams: Promise<{ fecha?: string; op?: string }>
}) {
    const profile = await getUserProfile()
    if (!profile) redirect('/')

    const params = await searchParams
    const hoy = hoyColombiaISO()
    const fecha = params.fecha && /^\d{4}-\d{2}-\d{2}$/.test(params.fecha) ? params.fecha : hoy

    const supabase = await createClient()
    const { data: ops } = await supabase.from('operaciones').select('nombre').order('nombre', { ascending: true })
    const listaOperaciones = (ops ?? []).map((o) => o.nombre as string)

    // El coordinador siempre ve su operación; el administrador elige (o todas).
    const filtroPerfil = getOperationFilter(profile)
    const operacionElegida = filtroPerfil.length > 0 ? filtroPerfil[0] : (params.op ?? '')
    const operaciones = operacionElegida ? [operacionElegida] : []

    let filas: Awaited<ReturnType<typeof construirMallaAsistencia>>['filas'] = []
    let error: string | null = null
    try {
        const malla = await construirMallaAsistencia(supabase, { start: fecha, end: fecha, operaciones })
        filas = malla.filas
    } catch (e) {
        error = e instanceof Error ? e.message : 'No se pudo cargar la asistencia.'
    }

    const q = quincenaDeFecha(fecha)
    const qsOp = operacionElegida ? `&op=${encodeURIComponent(operacionElegida)}` : ''

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Asistencia diaria</h1>
                    <p className="text-slate-500 text-sm">
                        Quién marcó, quién sigue en turno, quién llegó tarde y quién no asistió, por día y operación.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <a href={`/api/reportes/nomina?start=${fecha}&end=${fecha}${qsOp}`} target="_blank" rel="noreferrer">
                        <Button variant="outline" className="gap-2">
                            <Download className="h-4 w-4" /> Excel de este día
                        </Button>
                    </a>
                    <a href={`/api/reportes/nomina?start=${q.start}&end=${q.end}${qsOp}`} target="_blank" rel="noreferrer">
                        <Button variant="outline" className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                            <Download className="h-4 w-4" /> Quincena completa
                        </Button>
                    </a>
                </div>
            </div>

            {/* Filtros (formulario simple: al cambiar y aplicar se recarga la página) */}
            <Card>
                <CardContent className="pt-6">
                    <form method="get" className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1.5">
                            <label htmlFor="fecha" className="text-xs font-medium text-slate-600 uppercase tracking-wide block">
                                Fecha
                            </label>
                            <input
                                id="fecha"
                                name="fecha"
                                type="date"
                                defaultValue={fecha}
                                max={hoy}
                                className="h-10 px-3 bg-white border border-slate-200 rounded-md text-sm"
                            />
                        </div>
                        <div className="space-y-1.5 min-w-56">
                            <label htmlFor="op" className="text-xs font-medium text-slate-600 uppercase tracking-wide block">
                                Operación
                            </label>
                            {filtroPerfil.length > 0 ? (
                                <div className="h-10 px-3 flex items-center bg-slate-50 border border-slate-200 rounded-md text-sm font-medium">
                                    {operacionElegida}
                                </div>
                            ) : (
                                <select
                                    id="op"
                                    name="op"
                                    defaultValue={operacionElegida}
                                    className="h-10 px-3 w-full bg-white border border-slate-200 rounded-md text-sm"
                                >
                                    <option value="">Todas las operaciones</option>
                                    {listaOperaciones.map((o) => (
                                        <option key={o} value={o}>{o}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                        <Button type="submit" className="h-10 bg-blue-600 hover:bg-blue-700">Ver</Button>
                        {fecha !== hoy && (
                            <a href={`/asistencia${operacionElegida && filtroPerfil.length === 0 ? `?op=${encodeURIComponent(operacionElegida)}` : ''}`}>
                                <Button type="button" variant="ghost" className="h-10">Ir a hoy</Button>
                            </a>
                        )}
                    </form>
                </CardContent>
            </Card>

            {error ? (
                <Card>
                    <CardContent className="py-8 text-center text-sm text-red-600">{error}</CardContent>
                </Card>
            ) : (
                <AsistenciaDiariaClient filas={filas} fecha={fecha} esHoy={fecha === hoy} />
            )}
        </div>
    )
}
