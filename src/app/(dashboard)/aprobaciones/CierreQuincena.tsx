'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Archive } from 'lucide-react'
import { cerrarQuincenaManual, type CierreResumen } from './actions'

function fechaDMA(iso: string) {
    return iso.slice(0, 10).split('-').reverse().join('/')
}

/**
 * Cierre de incidencias de una quincena ya terminada.
 * `opciones` son las quincenas que se pueden cerrar (terminadas y aún sin cierre).
 */
export function CierreQuincena({
    cierres,
    opciones,
    esAdmin,
}: {
    cierres: CierreResumen[]
    opciones: { start: string; end: string; etiqueta: string }[]
    esAdmin: boolean
}) {
    const router = useRouter()
    const [elegida, setElegida] = useState(opciones[0]?.start ?? '')
    const [cerrando, setCerrando] = useState(false)

    const cerrar = async () => {
        const q = opciones.find((o) => o.start === elegida)
        if (!q) return
        const ok = confirm(
            `¿Cerrar las incidencias de la ${q.etiqueta}?\n\n` +
            '• Las horas extra que sigan pendientes quedarán como "No aprobada".\n' +
            '• Las alertas de ese período saldrán de la bandeja.\n' +
            '• Las marcaciones NO se modifican y se guarda un respaldo.',
        )
        if (!ok) return

        setCerrando(true)
        const res = await cerrarQuincenaManual(q.start, q.end)
        setCerrando(false)
        if (!res.success) { toast.error(res.error); return }
        if (res.resultado.yaExistia) {
            toast.info('Esa quincena ya estaba cerrada.')
        } else {
            toast.success(
                `Quincena cerrada: ${res.resultado.aprobacionesCerradas} hora(s) extra y ${res.resultado.alertasCerradas} alerta(s).`,
                { duration: 8000 },
            )
        }
        router.refresh()
    }

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                    <Archive className="h-4 w-4 text-slate-600" />
                    Cierre de incidencias por quincena
                </CardTitle>
                <p className="text-xs text-slate-500">
                    Saca de la bandeja lo pendiente de quincenas ya liquidadas, para que no vuelva a pedir
                    autorización. Se ejecuta solo los días 1 y 16 sobre la quincena que ya tuvo un período completo
                    de margen; aquí se puede adelantar. Nunca borra marcaciones y siempre guarda respaldo.
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                {esAdmin && (
                    opciones.length > 0 ? (
                        <div className="flex flex-wrap items-end gap-2">
                            <div>
                                <label className="text-[11px] text-slate-500 block mb-1">Quincena a cerrar</label>
                                <select
                                    value={elegida}
                                    onChange={(e) => setElegida(e.target.value)}
                                    className="h-9 px-2 border border-slate-200 rounded-md text-sm bg-white"
                                >
                                    {opciones.map((o) => (
                                        <option key={o.start} value={o.start}>{o.etiqueta}</option>
                                    ))}
                                </select>
                            </div>
                            <Button size="sm" variant="outline" disabled={cerrando} onClick={cerrar}>
                                {cerrando ? 'Cerrando…' : 'Cerrar quincena'}
                            </Button>
                        </div>
                    ) : (
                        <p className="text-xs text-slate-500">Las quincenas terminadas recientes ya están cerradas.</p>
                    )
                )}

                {cierres.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-slate-500 border-b">
                                    <th className="py-1.5 pr-3 font-medium">Período</th>
                                    <th className="py-1.5 pr-3 font-medium">Extras cerradas</th>
                                    <th className="py-1.5 pr-3 font-medium">Alertas cerradas</th>
                                    <th className="py-1.5 pr-3 font-medium">Jornadas pendientes de cierre</th>
                                    <th className="py-1.5 font-medium">Ejecutó</th>
                                </tr>
                            </thead>
                            <tbody>
                                {cierres.map((c) => (
                                    <tr key={c.id} className="border-b last:border-0">
                                        <td className="py-1.5 pr-3">{fechaDMA(c.periodo_inicio)} – {fechaDMA(c.periodo_fin)}</td>
                                        <td className="py-1.5 pr-3">{c.aprobaciones_cerradas}</td>
                                        <td className="py-1.5 pr-3">{c.alertas_cerradas}</td>
                                        <td className="py-1.5 pr-3">{c.jornadas_pendientes}</td>
                                        <td className="py-1.5">
                                            {c.automatico ? 'Automático' : c.ejecutado_por} · {fechaDMA(c.created_at)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p className="text-xs text-slate-500">Aún no se ha cerrado ninguna quincena.</p>
                )}
            </CardContent>
        </Card>
    )
}
