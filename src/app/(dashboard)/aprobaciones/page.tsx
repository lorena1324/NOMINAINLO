import { getAprobacionesPendientes, getCierresRecientes, getJornadasInconsistentes } from './actions'
import { AprobacionesPanel, InconsistentesPanel } from './AprobacionesClient'
import { CierreQuincena } from './CierreQuincena'
import { Button } from '@/components/ui/button'
import { Clock, AlertTriangle, Download } from 'lucide-react'
import { hoyColombiaISO, moverQuincena, quincenaDeFecha } from '@/lib/asistencia'
import { getUserProfile, puedeEditar } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function AprobacionesPage() {
    const profile = await getUserProfile()
    if (!profile) redirect('/')
    // El visualizador ve todo, pero sin botones de acción
    const soloLectura = !puedeEditar(profile)

    const [aprobacionesRes, inconsistentesRes, cierres] = await Promise.all([
        getAprobacionesPendientes(),
        getJornadasInconsistentes(),
        getCierresRecientes(),
    ])

    const aprobaciones = aprobacionesRes.data ?? []
    const inconsistentes = inconsistentesRes.data ?? []
    const q = quincenaDeFecha(hoyColombiaISO())

    // Quincenas ya terminadas (las tres últimas) que todavía no tienen cierre
    const cerradas = new Set(cierres.map((c) => `${c.periodo_inicio}|${c.periodo_fin}`))
    const opciones: { start: string; end: string; etiqueta: string }[] = []
    let cursor = moverQuincena(q, -1)
    for (let i = 0; i < 3; i++) {
        if (!cerradas.has(`${cursor.start}|${cursor.end}`)) {
            opciones.push({ start: cursor.start, end: cursor.end, etiqueta: cursor.etiqueta })
        }
        cursor = moverQuincena(cursor, -1)
    }

    return (
        <div className="space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Panel de Control</h1>
                    <p className="text-slate-500 text-sm">
                        {soloLectura
                            ? 'Consulta de horas extra pendientes y jornadas que quedaron abiertas. Tu perfil es de solo consulta.'
                            : 'Aprueba horas extra y registra la salida real de las jornadas que quedaron abiertas. Cada acción guarda quién la hizo, cuándo y el motivo.'}
                    </p>
                </div>
                {/* Reporte para revisar antes del cierre de la quincena en curso */}
                <a href={`/api/reportes/inconsistencias?start=${q.start}&end=${q.end}`} target="_blank" rel="noreferrer">
                    <Button variant="outline" className="gap-2 border-red-300 text-red-700 hover:bg-red-50">
                        <Download className="h-4 w-4" />
                        Inconsistencias de la quincena
                    </Button>
                </a>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Extras pendientes */}
                <section className="space-y-4">
                    <div className="flex items-center gap-2">
                        <Clock className="w-5 h-5 text-amber-500" />
                        <h2 className="text-lg font-semibold text-slate-700">
                            Horas Extra Pendientes
                            {aprobaciones.length > 0 && (
                                <span className="ml-2 text-sm font-normal text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                                    {aprobaciones.length}
                                </span>
                            )}
                        </h2>
                    </div>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <AprobacionesPanel aprobaciones={aprobaciones as any} soloLectura={soloLectura} />
                </section>

                {/* Jornadas sin salida */}
                <section className="space-y-4">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-red-500" />
                        <h2 className="text-lg font-semibold text-slate-700">
                            Jornadas sin salida (cierre automático)
                            {inconsistentes.length > 0 && (
                                <span className="ml-2 text-sm font-normal text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                                    {inconsistentes.length}
                                </span>
                            )}
                        </h2>
                    </div>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <InconsistentesPanel jornadas={inconsistentes as any} soloLectura={soloLectura} />
                </section>
            </div>

            <CierreQuincena cierres={cierres} opciones={opciones} esAdmin={profile.rol === 'admin'} />
        </div>
    )
}
