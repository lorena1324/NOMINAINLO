'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { FileSpreadsheet, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import type { EstadoFila, FilaRevisada } from '@/lib/importarEmpleados'
import type { ResultadoImportacion } from '@/app/api/empleados/importar/route'

const ETIQUETA: Record<EstadoFila, { texto: string; clase: string }> = {
    nuevo: { texto: 'Nuevo', clase: 'bg-emerald-100 text-emerald-800' },
    mismo_nombre: { texto: 'Revisar: mismo nombre', clase: 'bg-amber-100 text-amber-800' },
    existente: { texto: 'Ya registrado', clase: 'bg-slate-100 text-slate-700' },
    error: { texto: 'Con error', clase: 'bg-red-100 text-red-800' },
}

function dma(iso: string | null) {
    return iso ? iso.split('-').reverse().join('/') : '—'
}

function pesos(n: number | null) {
    return n === null ? '—' : n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
}

export function ImportarEmpleados({ operaciones }: { operaciones: string[] }) {
    const router = useRouter()
    const [archivo, setArchivo] = useState<File | null>(null)
    const [operacion, setOperacion] = useState('')
    const [porFila, setPorFila] = useState<Record<string, string>>({})
    const [incluirMismoNombre, setIncluirMismoNombre] = useState(false)
    const [actualizar, setActualizar] = useState(false)
    const [reactivar, setReactivar] = useState(false)
    const [cargando, setCargando] = useState(false)
    const [revision, setRevision] = useState<ResultadoImportacion | null>(null)
    const [filtro, setFiltro] = useState<EstadoFila | 'todos'>('todos')
    const [resultado, setResultado] = useState<ResultadoImportacion['importado'] | null>(null)

    const enviar = async (accion: 'revisar' | 'importar', cambiosFila = porFila) => {
        if (!archivo) return null
        const fd = new FormData()
        fd.append('archivo', archivo)
        fd.append('accion', accion)
        fd.append('operacion', operacion)
        fd.append('operaciones_por_fila', JSON.stringify(cambiosFila))
        if (incluirMismoNombre) fd.append('incluir_mismo_nombre', '1')
        if (actualizar) fd.append('actualizar_existentes', '1')
        if (reactivar) fd.append('reactivar_inactivos', '1')
        setCargando(true)
        try {
            const res = await fetch('/api/empleados/importar', { method: 'POST', body: fd })
            const json = await res.json()
            if (!res.ok) {
                toast.error(json.error ?? 'No se pudo procesar el archivo.')
                return null
            }
            return json as ResultadoImportacion
        } catch {
            toast.error('No hay conexión con el servidor.')
            return null
        } finally {
            setCargando(false)
        }
    }

    const revisar = async (cambiosFila = porFila) => {
        setResultado(null)
        const r = await enviar('revisar', cambiosFila)
        if (r) setRevision(r)
    }

    const cambiarOperacionFila = (cedula: string, op: string) => {
        const nuevo = { ...porFila, [cedula]: op }
        setPorFila(nuevo)
        void revisar(nuevo)
    }

    const conteo = useMemo(() => {
        const c = { nuevo: 0, mismo_nombre: 0, existente: 0, error: 0, conCambios: 0, inactivos: 0 }
        for (const f of revision?.filas ?? []) {
            c[f.estado]++
            if (f.estado === 'existente' && f.cambios && f.cambios.length > 0) c.conCambios++
            if (f.estado === 'existente' && f.inactivo) c.inactivos++
        }
        return c
    }, [revision])

    const aCrear = conteo.nuevo + (incluirMismoNombre ? conteo.mismo_nombre : 0)
    const aActualizar = (actualizar ? conteo.conCambios : 0) + (reactivar ? conteo.inactivos : 0)
    const filasVisibles = (revision?.filas ?? []).filter((f) => filtro === 'todos' || f.estado === filtro)

    // Cuántas filas nuevas quedarían en cada operación
    const porOperacion = useMemo(() => {
        const m = new Map<string, number>()
        for (const f of revision?.filas ?? []) {
            if (f.estado === 'nuevo' || (incluirMismoNombre && f.estado === 'mismo_nombre')) {
                m.set(f.operacionFinal ?? '—', (m.get(f.operacionFinal ?? '—') ?? 0) + 1)
            }
        }
        return [...m.entries()].sort((a, b) => b[1] - a[1])
    }, [revision, incluirMismoNombre])

    const importar = async () => {
        const partes = [`• Se crearán ${aCrear} colaborador(es).`]
        if (aActualizar > 0) partes.push(`• Se actualizarán ${aActualizar} ya registrado(s).`)
        if (conteo.error > 0) partes.push(`• ${conteo.error} fila(s) con error NO se importan.`)
        if (!confirm(`¿Importar el personal?\n\n${partes.join('\n')}`)) return
        const r = await enviar('importar')
        if (!r?.importado) return
        setResultado(r.importado)
        setRevision(null)
        toast.success(`Listo: ${r.importado.creados} creado(s), ${r.importado.actualizados} actualizado(s).`)
        router.refresh()
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5 text-emerald-600" /> 1. Elige el archivo
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        El archivo debe tener una fila de títulos con estas columnas (en cualquier orden):{' '}
                        <b>CEDULA</b>, <b>NOMBRE</b>, <b>CARGO</b>, <b>INGRESO</b> (fecha de ingreso) y, si se tienen,{' '}
                        <b>SALARIO</b>, <b>FECHA NACIMIENTO</b> y <b>OPERACION</b>. Las cédulas van sin puntos.
                    </p>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="archivo">Archivo de Excel (.xlsx)</Label>
                            <Input
                                id="archivo"
                                type="file"
                                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                onChange={(e) => {
                                    setArchivo(e.target.files?.[0] ?? null)
                                    setRevision(null)
                                    setResultado(null)
                                    setPorFila({})
                                }}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="operacion">Operación para el personal del archivo</Label>
                            <select
                                id="operacion"
                                className="w-full h-9 rounded-md border px-3 text-sm bg-background"
                                value={operacion}
                                onChange={(e) => {
                                    setOperacion(e.target.value)
                                    setRevision(null)
                                }}
                            >
                                <option value="">— Elegir operación —</option>
                                {operaciones.map((o) => (
                                    <option key={o} value={o}>{o}</option>
                                ))}
                            </select>
                            <p className="text-xs text-muted-foreground">
                                Se usa en las filas que no traen columna OPERACION. En la revisión puedes cambiarla
                                fila por fila.
                            </p>
                        </div>
                    </div>
                    <Button onClick={() => revisar()} disabled={!archivo || cargando}>
                        <Upload className="h-4 w-4 mr-2" />
                        {cargando && !revision ? 'Revisando…' : 'Revisar archivo'}
                    </Button>
                </CardContent>
            </Card>

            {resultado && (
                <Card className="border-emerald-300">
                    <CardContent className="pt-6 space-y-2">
                        <p className="font-semibold text-emerald-700">Importación terminada</p>
                        <p className="text-sm">
                            Creados: <b>{resultado.creados}</b> · Actualizados: <b>{resultado.actualizados}</b> ·
                            Reactivados: <b>{resultado.reactivados}</b>
                        </p>
                        {resultado.errores.length > 0 && (
                            <div className="text-sm text-red-700">
                                <p className="font-medium">No se pudieron guardar ({resultado.errores.length}):</p>
                                <ul className="list-disc ml-5">
                                    {resultado.errores.slice(0, 50).map((e) => <li key={e}>{e}</li>)}
                                </ul>
                            </div>
                        )}
                        <p className="text-sm text-muted-foreground">
                            Recuerda asignar el turno a cada colaborador desde la lista de Usuarios.
                        </p>
                        <Link href="/empleados"><Button variant="outline">Ver la lista de Usuarios</Button></Link>
                    </CardContent>
                </Card>
            )}

            {revision && (
                <Card>
                    <CardHeader>
                        <CardTitle>2. Revisa y confirma ({revision.filas.length} filas en el archivo)</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <div className="flex flex-wrap gap-2">
                            {([
                                ['todos', `Todos (${revision.filas.length})`, 'bg-white'],
                                ['nuevo', `Nuevos (${conteo.nuevo})`, ETIQUETA.nuevo.clase],
                                ['mismo_nombre', `Mismo nombre (${conteo.mismo_nombre})`, ETIQUETA.mismo_nombre.clase],
                                ['existente', `Ya registrados (${conteo.existente})`, ETIQUETA.existente.clase],
                                ['error', `Con error (${conteo.error})`, ETIQUETA.error.clase],
                            ] as const).map(([clave, texto, clase]) => (
                                <button
                                    key={clave}
                                    onClick={() => setFiltro(clave)}
                                    className={`rounded-full border px-3 py-1 text-sm ${clase} ${filtro === clave ? 'ring-2 ring-offset-1 ring-slate-500' : ''}`}
                                >
                                    {texto}
                                </button>
                            ))}
                        </div>

                        {porOperacion.length > 0 && (
                            <p className="text-sm text-muted-foreground">
                                Quedarían en:{' '}
                                {porOperacion.map(([op, n]) => `${op} (${n})`).join(' · ')}
                            </p>
                        )}

                        <div className="space-y-2 rounded-md border p-3 bg-slate-50 text-sm">
                            {conteo.mismo_nombre > 0 && (
                                <label className="flex items-start gap-2">
                                    <input type="checkbox" className="mt-1" checked={incluirMismoNombre} onChange={(e) => setIncluirMismoNombre(e.target.checked)} />
                                    <span>
                                        Crear también los <b>{conteo.mismo_nombre}</b> que tienen el mismo nombre que otro
                                        colaborador con otra cédula (revisa que no sea un error de digitación).
                                    </span>
                                </label>
                            )}
                            {conteo.conCambios > 0 && (
                                <label className="flex items-start gap-2">
                                    <input type="checkbox" className="mt-1" checked={actualizar} onChange={(e) => setActualizar(e.target.checked)} />
                                    <span>
                                        Actualizar cargo, salario y fechas de los <b>{conteo.conCambios}</b> ya registrados
                                        que tienen datos distintos en el archivo. La operación no se cambia (para eso se usa
                                        “Cambiar operación”).
                                    </span>
                                </label>
                            )}
                            {conteo.inactivos > 0 && (
                                <label className="flex items-start gap-2">
                                    <input type="checkbox" className="mt-1" checked={reactivar} onChange={(e) => setReactivar(e.target.checked)} />
                                    <span>Reactivar a los <b>{conteo.inactivos}</b> que están inactivos en el sistema.</span>
                                </label>
                            )}
                            {conteo.mismo_nombre === 0 && conteo.conCambios === 0 && conteo.inactivos === 0 && (
                                <p className="text-muted-foreground">Los ya registrados no tienen cambios: se dejan como están.</p>
                            )}
                        </div>

                        <div className="max-h-[520px] overflow-auto rounded-md border">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-slate-100 text-left">
                                    <tr>
                                        <th className="p-2">Fila</th>
                                        <th className="p-2">Estado</th>
                                        <th className="p-2">Cédula</th>
                                        <th className="p-2">Nombre</th>
                                        <th className="p-2">Cargo</th>
                                        <th className="p-2">Ingreso</th>
                                        <th className="p-2">Salario</th>
                                        <th className="p-2">Operación</th>
                                        <th className="p-2">Observación</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filasVisibles.map((f: FilaRevisada) => {
                                        const seCrea = f.estado === 'nuevo' || f.estado === 'mismo_nombre'
                                        const puedeElegirOp = seCrea || (f.estado === 'error' && f.motivo?.includes('operación'))
                                        return (
                                            <tr key={`${f.fila}-${f.cedula}`} className="border-t align-top">
                                                <td className="p-2 text-muted-foreground">{f.fila}</td>
                                                <td className="p-2">
                                                    <span className={`rounded px-2 py-0.5 text-xs whitespace-nowrap ${ETIQUETA[f.estado].clase}`}>
                                                        {ETIQUETA[f.estado].texto}
                                                    </span>
                                                </td>
                                                <td className="p-2 font-mono">{f.cedula}</td>
                                                <td className="p-2">{f.nombre}</td>
                                                <td className="p-2">{f.cargo}</td>
                                                <td className="p-2 whitespace-nowrap">{dma(f.fechaIngreso)}</td>
                                                <td className="p-2 whitespace-nowrap">{pesos(f.salario)}</td>
                                                <td className="p-2">
                                                    {puedeElegirOp ? (
                                                        <select
                                                            className="h-8 rounded border px-1 text-xs bg-background max-w-[180px]"
                                                            value={porFila[f.cedula] ?? f.operacionFinal ?? ''}
                                                            disabled={cargando}
                                                            onChange={(e) => cambiarOperacionFila(f.cedula, e.target.value)}
                                                        >
                                                            <option value="">— Elegir —</option>
                                                            {operaciones.map((o) => <option key={o} value={o}>{o}</option>)}
                                                        </select>
                                                    ) : (
                                                        <span className="text-xs">{f.operacionFinal ?? '—'}</span>
                                                    )}
                                                </td>
                                                <td className="p-2 text-xs text-muted-foreground">
                                                    {f.motivo}
                                                    {f.cambios && f.cambios.length > 0 && (
                                                        <div className="text-amber-700">Cambios: {f.cambios.join('; ')}</div>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                    {filasVisibles.length === 0 && (
                                        <tr><td colSpan={9} className="p-4 text-center text-muted-foreground">No hay filas en este grupo.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            <Button
                                onClick={importar}
                                disabled={cargando || (aCrear === 0 && aActualizar === 0)}
                                className="bg-emerald-600 hover:bg-emerald-700"
                            >
                                {cargando ? 'Procesando…' : `Importar: crear ${aCrear}${aActualizar > 0 ? ` y actualizar ${aActualizar}` : ''}`}
                            </Button>
                            {conteo.error > 0 && (
                                <span className="text-sm text-red-700">
                                    {conteo.error} fila(s) con error no se importan. Corrígelas en el Excel y vuelve a subirlo.
                                </span>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
