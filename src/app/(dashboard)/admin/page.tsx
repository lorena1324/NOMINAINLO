import { calcularHorasTodosEnPeriodo, type ResumenEmpleadoPeriodo } from '@/lib/reportes'
import { AdminFilters } from './AdminFilters'
import { AdminTablesClient } from './AdminTablesClient'
import { AdminResumen } from './AdminResumen'
import { Suspense } from 'react'
import { getUserProfile, getOperationFilter } from '@/lib/auth'
import { redirect } from 'next/navigation'

interface Grupo {
    nombre: string
    start: Date
    end: Date
}

interface GrupoConDatos extends Omit<Grupo, 'start' | 'end'> {
    startString: string
    endString: string
    datos: ResumenEmpleadoPeriodo[]
}

export default async function AdminPage({
    searchParams,
}: {
    searchParams: Promise<{
        start?: string
        end?: string
        op?: string
        mes?: string
        anio?: string
        periodo?: string
    }>
}) {
    const profile = await getUserProfile()
    if (!profile) redirect('/')

    const pParams = await searchParams
    const grupos: Grupo[] = []

    if (pParams.periodo === 'personalizado' && pParams.start && pParams.end) {
        const start = new Date(`${pParams.start}T00:00:00`)
        const end = new Date(`${pParams.end}T23:59:59.999`)
        grupos.push({ nombre: 'Período personalizado', start, end })
    } else {
        const mes = pParams.mes ? parseInt(pParams.mes) : new Date().getMonth()
        const anio = pParams.anio ? parseInt(pParams.anio) : new Date().getFullYear()

        if (pParams.periodo === 'mensual') {
            grupos.push({
                nombre: 'Mes completo',
                start: new Date(anio, mes, 1),
                end: new Date(anio, mes + 1, 0, 23, 59, 59, 999),
            })
        } else if (pParams.periodo === 'semanal') {
            grupos.push({ nombre: 'Semana 1 (1-7)', start: new Date(anio, mes, 1), end: new Date(anio, mes, 7, 23, 59, 59, 999) })
            grupos.push({ nombre: 'Semana 2 (8-14)', start: new Date(anio, mes, 8), end: new Date(anio, mes, 14, 23, 59, 59, 999) })
            grupos.push({ nombre: 'Semana 3 (15-21)', start: new Date(anio, mes, 15), end: new Date(anio, mes, 21, 23, 59, 59, 999) })
            grupos.push({ nombre: 'Semana 4 (22-fin)', start: new Date(anio, mes, 22), end: new Date(anio, mes + 1, 0, 23, 59, 59, 999) })
        } else {
            // Quincenal (default)
            grupos.push({ nombre: 'Primera quincena', start: new Date(anio, mes, 1), end: new Date(anio, mes, 15, 23, 59, 59, 999) })
            grupos.push({ nombre: 'Segunda quincena', start: new Date(anio, mes, 16), end: new Date(anio, mes + 1, 0, 23, 59, 59, 999) })
        }
    }

    // Coordinador y visualizador con operación asignada solo ven esa operación
    const filtroPerfil = getOperationFilter(profile)
    const operaciones =
        filtroPerfil.length > 0
            ? filtroPerfil
            : pParams.op
                ? pParams.op.split(',')
                : []

    const gruposConDatos: GrupoConDatos[] = await Promise.all(
        grupos.map(async (g) => {
            const datos = await calcularHorasTodosEnPeriodo(g.start, g.end, operaciones)
            return {
                nombre: g.nombre,
                startString: g.start.toLocaleDateString('es-CO'),
                endString: g.end.toLocaleDateString('es-CO'),
                datos,
            }
        }),
    )

    // Totales agregados del período completo (todos los grupos sumados)
    const totales = gruposConDatos.reduce(
        (acc, grupo) => {
            for (const d of grupo.datos) {
                acc.empleados.add(d.cedula)
                acc.minutos += d.totalMinutos
                acc.valor += d.valorTotal
            }
            return acc
        },
        { empleados: new Set<string>(), minutos: 0, valor: 0 },
    )

    const rangoTotal =
        grupos.length > 0
            ? `${grupos[0].start.toLocaleDateString('es-CO')} — ${grupos[grupos.length - 1].end.toLocaleDateString('es-CO')}`
            : '—'

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">Reporte Administrativo</h1>
                <p className="text-sm text-slate-500 mt-1">
                    Liquidación del período seleccionado — {rangoTotal}
                </p>
            </div>

            <Suspense fallback={<div className="h-20 bg-slate-100 animate-pulse rounded-xl" />}>
                <AdminFilters rol={profile.rol} operacionFija={profile.operacion_nombre} />
            </Suspense>

            <AdminResumen
                empleados={totales.empleados.size}
                minutosTotales={totales.minutos}
                valorTotal={totales.valor}
                operacionesFiltradas={operaciones.length}
            />

            <AdminTablesClient grupos={gruposConDatos} />
        </div>
    )
}
