'use client'

import { useState } from 'react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Edit2, Ban, CheckCircle, Eye, Trash2, ArrowLeftRight } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
    editarEmpleado,
    cambiarEstadoEmpleado,
    eliminarEmpleado,
    programarCambioOperacion,
    getCambiosOperacion,
    cancelarCambioOperacion,
} from './actions'
import type { CambioOperacion } from '@/lib/cambiosOperacion'
import { hoyColombiaISO } from '@/lib/asistencia'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

/* eslint-disable @typescript-eslint/no-explicit-any */

function fechaDMA(iso: string | null | undefined) {
    if (!iso) return '—'
    return iso.slice(0, 10).split('-').reverse().join('/')
}

export function EmpleadosTable({
    empleados,
    operaciones,
    rol
}: {
    empleados: any[],
    operaciones: { id: string, nombre: string }[],
    rol: string
}) {
    const router = useRouter()
    const esAdmin = rol === 'admin'
    // El visualizador solo consulta: no ve botones de edición
    const puedeEditar = rol === 'admin' || rol === 'coordinador'

    const [editingEmp, setEditingEmp] = useState<any>(null)
    const [isSaving, setIsSaving] = useState(false)
    const [searchTerm, setSearchTerm] = useState('')

    // Formulario de edición
    const [editNombre, setEditNombre] = useState('')
    const [editCargo, setEditCargo] = useState('')
    const [editStatus, setEditStatus] = useState('')
    const [editCedula, setEditCedula] = useState('')
    const [editSalario, setEditSalario] = useState('')
    const [editIngreso, setEditIngreso] = useState('')

    const openEditDialog = (emp: any) => {
        setEditingEmp(emp)
        setEditNombre(emp.nombre)
        setEditCargo(emp.cargo ?? '')
        setEditStatus(emp.status)
        setEditCedula(emp.id)
        setEditSalario(emp.salario?.toString() || '')
        setEditIngreso(emp.fecha_ingreso ? String(emp.fecha_ingreso).slice(0, 10) : '')
    }

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingEmp) return

        setIsSaving(true)
        const formData = new FormData()
        formData.append('cedula', editingEmp.id)
        formData.append('nueva_cedula', editCedula)
        formData.append('nombre', editNombre)
        formData.append('cargo', editCargo)
        formData.append('status', editStatus)
        formData.append('salario', editSalario)
        formData.append('fecha_ingreso', editIngreso)

        const result = await editarEmpleado(formData)

        setIsSaving(false)
        if (!result.success) {
            toast.error(result.error)
        } else {
            toast.success('Empleado actualizado exitosamente')
            setEditingEmp(null)
            router.refresh()
        }
    }

    // ─── Eliminar ───────────────────────────────────────────────
    const [deletingEmp, setDeletingEmp] = useState<any>(null)
    const [isDeleting, setIsDeleting] = useState(false)

    const handleDelete = async () => {
        if (!deletingEmp) return
        setIsDeleting(true)
        const res = await eliminarEmpleado(deletingEmp.id)
        setIsDeleting(false)
        if (!res.success) {
            toast.error(res.error || 'No se pudo eliminar')
            return
        }
        if (res.accion === 'inactivado') toast.warning(res.mensaje, { duration: 8000 })
        else toast.success(res.mensaje)
        setDeletingEmp(null)
        router.refresh()
    }

    // ─── Cambio de operación (CECO) ─────────────────────────────
    const [cambioEmp, setCambioEmp] = useState<any>(null)
    const [cambioOp, setCambioOp] = useState('')
    const [cambioDesde, setCambioDesde] = useState(hoyColombiaISO())
    const [cambioMotivo, setCambioMotivo] = useState('')
    const [historial, setHistorial] = useState<CambioOperacion[]>([])
    const [guardandoCambio, setGuardandoCambio] = useState(false)

    const abrirCambio = async (emp: any) => {
        setCambioEmp(emp)
        setCambioOp('')
        setCambioDesde(hoyColombiaISO())
        setCambioMotivo('')
        setHistorial([])
        setHistorial(await getCambiosOperacion(emp.id))
    }

    const guardarCambio = async () => {
        if (!cambioEmp) return
        if (!cambioOp) { toast.error('Elige la nueva operación.'); return }
        if (cambioMotivo.trim().length < 5) { toast.error('Escribe el motivo del cambio.'); return }
        const esFuturo = cambioDesde > hoyColombiaISO()
        const texto = esFuturo
            ? `¿Programar el cambio de ${cambioEmp.nombre} a "${cambioOp}" desde el ${fechaDMA(cambioDesde)}?`
            : `¿Cambiar ahora a ${cambioEmp.nombre} a "${cambioOp}"? Sus marcaciones anteriores no se modifican.`
        if (!confirm(texto)) return

        setGuardandoCambio(true)
        const res = await programarCambioOperacion({
            cedula: cambioEmp.id,
            operacionNueva: cambioOp,
            vigenteDesde: cambioDesde,
            motivo: cambioMotivo,
        })
        setGuardandoCambio(false)
        if (!res.success) { toast.error(res.error); return }
        toast.success(res.aplicado ? 'Operación cambiada.' : `Cambio programado para el ${fechaDMA(cambioDesde)}.`)
        setCambioEmp(null)
        router.refresh()
    }

    const cancelarCambio = async (id: string) => {
        if (!confirm('¿Cancelar este cambio programado?')) return
        const res = await cancelarCambioOperacion(id)
        if (!res.success) { toast.error(res.error); return }
        toast.success('Cambio cancelado.')
        if (cambioEmp) setHistorial(await getCambiosOperacion(cambioEmp.id))
    }

    const toggleStatus = async (emp: any) => {
        const newStatus = emp.status === 'activo' ? 'inactivo' : 'activo'
        const res = await cambiarEstadoEmpleado(emp.id, newStatus)
        if (res.success) {
            toast.success(`Empleado ${newStatus}`)
            router.refresh()
        } else {
            toast.error(res.error || 'Error cambiando estado')
        }
    }

    const filteredEmpleados = empleados?.filter((emp: any) =>
        emp.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
        emp.id.includes(searchTerm)
    )

    return (
        <div className="space-y-4">
            <div className="pb-4">
                <Input
                    placeholder="Buscar por cédula o nombre completo..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="max-w-md bg-white border-slate-200"
                />
            </div>

            <div className="rounded-md border overflow-x-auto">
                <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Cédula</TableHead>
                        <TableHead>Nombre Completo</TableHead>
                        <TableHead>Operación Base</TableHead>
                        <TableHead>Ingreso</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {filteredEmpleados?.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                No se encontraron empleados.
                            </TableCell>
                        </TableRow>
                    )}
                    {filteredEmpleados?.map((emp: any) => (
                        <TableRow key={emp.id}>
                            <TableCell className="font-semibold">{emp.id}</TableCell>
                            <TableCell>
                                <Link href={`/empleados/${emp.id}`} className="hover:underline">
                                    <div className="font-medium text-sm text-blue-700 hover:text-blue-900">{emp.nombre}</div>
                                    <div className="text-xs text-muted-foreground">{emp.cargo}</div>
                                </Link>
                            </TableCell>
                            <TableCell>
                                {emp.operacion || <span className="text-red-600 text-sm">Sin operación</span>}
                            </TableCell>
                            <TableCell className="text-sm text-slate-600">
                                {emp.fecha_ingreso
                                    ? fechaDMA(emp.fecha_ingreso)
                                    : <span className="text-amber-700 text-xs">Sin fecha</span>}
                            </TableCell>
                            <TableCell>
                                {emp.status === 'activo' ? (
                                    <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Activo</Badge>
                                ) : (
                                    <Badge variant="destructive">Inactivo</Badge>
                                )}
                            </TableCell>
                            <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                    <Link href={`/empleados/${emp.id}`}>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                                            title="Ver detalle"
                                        >
                                            <Eye className="h-4 w-4" />
                                        </Button>
                                    </Link>
                                    {puedeEditar && (
                                        <>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                                onClick={() => openEditDialog(emp)}
                                                title="Editar Empleado"
                                            >
                                                <Edit2 className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className={emp.status === 'activo' ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50" : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"}
                                                onClick={() => toggleStatus(emp)}
                                                title={emp.status === 'activo' ? 'Inactivar Empleado' : 'Activar Empleado'}
                                            >
                                                {emp.status === 'activo' ? <Ban className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                                            </Button>
                                        </>
                                    )}
                                    {esAdmin && (
                                        <>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                                                onClick={() => abrirCambio(emp)}
                                                title="Cambiar operación (CECO)"
                                            >
                                                <ArrowLeftRight className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                onClick={() => setDeletingEmp(emp)}
                                                title="Eliminar (creado por error)"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            {/* ─── Editar ─── */}
            <Dialog open={!!editingEmp} onOpenChange={(open) => !open && setEditingEmp(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Editar Funcionario</DialogTitle>
                    </DialogHeader>
                    {editingEmp && (
                        <form onSubmit={handleSave} className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="edit-cedula">Cédula</Label>
                                <Input
                                    id="edit-cedula"
                                    value={editCedula}
                                    onChange={e => setEditCedula(e.target.value.replace(/\D/g, ''))}
                                    inputMode="numeric"
                                    maxLength={10}
                                    required
                                />
                                <p className="text-xs text-slate-500">Solo números, entre 6 y 10 dígitos.</p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="edit-nombre">Nombre Completo *</Label>
                                <Input id="edit-nombre" value={editNombre} onChange={e => setEditNombre(e.target.value)} required />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="edit-cargo">Cargo *</Label>
                                <Input id="edit-cargo" value={editCargo} onChange={e => setEditCargo(e.target.value)} required />
                            </div>

                            <div className="space-y-2">
                                <Label>Operación (CECO)</Label>
                                <div className="h-10 px-3 flex items-center rounded-md border bg-slate-50 text-sm">
                                    {editingEmp.operacion || 'Sin operación'}
                                </div>
                                <p className="text-xs text-slate-500">
                                    {esAdmin
                                        ? 'Para cambiarla usa el botón "Cambiar operación" (⇄) de la lista: pide motivo y fecha de vigencia.'
                                        : 'Solo un administrador puede cambiar la operación (CECO).'}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="edit-ingreso">Fecha de ingreso</Label>
                                <Input
                                    id="edit-ingreso"
                                    type="date"
                                    value={editIngreso}
                                    max={hoyColombiaISO()}
                                    onChange={e => setEditIngreso(e.target.value)}
                                />
                                <p className="text-xs text-slate-500">Desde este día se cuenta la asistencia del colaborador.</p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="edit-status">Estado *</Label>
                                <Select value={editStatus} onValueChange={setEditStatus}>
                                    <SelectTrigger id="edit-status">
                                        <SelectValue placeholder="Seleccionar estado" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="activo">Activo</SelectItem>
                                        <SelectItem value="inactivo">Inactivo</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="edit-salario">Salario Mensual</Label>
                                <Input
                                    id="edit-salario"
                                    type="number"
                                    value={editSalario}
                                    onChange={e => setEditSalario(e.target.value)}
                                    placeholder="Ej. 1300000"
                                    min="0"
                                />
                            </div>

                            <div className="pt-4 flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setEditingEmp(null)}>Cancelar</Button>
                                <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isSaving}>
                                    {isSaving ? 'Guardando...' : 'Guardar Cambios'}
                                </Button>
                            </div>
                        </form>
                    )}
                </DialogContent>
            </Dialog>

            {/* ─── Cambiar operación ─── */}
            <Dialog open={!!cambioEmp} onOpenChange={(open) => !open && setCambioEmp(null)}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Cambiar operación (CECO)</DialogTitle>
                    </DialogHeader>
                    {cambioEmp && (
                        <div className="space-y-4 py-2 text-sm">
                            <p className="text-slate-700">
                                <b>{cambioEmp.nombre}</b> (CC {cambioEmp.id}) · operación actual:{' '}
                                <b>{cambioEmp.operacion || 'sin operación'}</b>
                            </p>

                            <div className="space-y-2">
                                <Label>Nueva operación *</Label>
                                <Select value={cambioOp} onValueChange={setCambioOp}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccione la operación..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {operaciones
                                            .filter(op => op.nombre !== cambioEmp.operacion)
                                            .map(op => (
                                                <SelectItem key={op.id} value={op.nombre}>{op.nombre}</SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="cambio-desde">Rige desde *</Label>
                                <Input
                                    id="cambio-desde"
                                    type="date"
                                    value={cambioDesde}
                                    onChange={e => setCambioDesde(e.target.value)}
                                />
                                <p className="text-xs text-slate-500">
                                    Hoy o una fecha pasada: se aplica de inmediato. Fecha futura: queda programado
                                    y se aplica solo ese día. Las marcaciones ya registradas no se modifican.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="cambio-motivo">Motivo *</Label>
                                <Textarea
                                    id="cambio-motivo"
                                    rows={2}
                                    value={cambioMotivo}
                                    onChange={e => setCambioMotivo(e.target.value)}
                                    placeholder="Ej.: traslado definitivo solicitado por el cliente."
                                />
                            </div>

                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setCambioEmp(null)}>Cancelar</Button>
                                <Button
                                    type="button"
                                    className="bg-indigo-600 hover:bg-indigo-700"
                                    disabled={guardandoCambio}
                                    onClick={guardarCambio}
                                >
                                    {guardandoCambio ? 'Guardando...' : 'Confirmar cambio'}
                                </Button>
                            </div>

                            {historial.length > 0 && (
                                <div className="border-t pt-3">
                                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
                                        Historial de cambios
                                    </p>
                                    <ul className="space-y-2 max-h-48 overflow-y-auto">
                                        {historial.map(c => (
                                            <li key={c.id} className="text-xs border-l-2 border-slate-300 pl-3">
                                                <div className="flex items-start justify-between gap-2">
                                                    <span>
                                                        <b>{c.operacion_anterior || 'sin operación'}</b> → <b>{c.operacion_nueva}</b>
                                                        {' · '}desde {fechaDMA(c.vigente_desde)}
                                                        {' · '}
                                                        {c.aplicado
                                                            ? <span className="text-emerald-700">aplicado</span>
                                                            : <span className="text-amber-700">programado</span>}
                                                    </span>
                                                    {!c.aplicado && (
                                                        <button className="text-red-600 underline shrink-0" onClick={() => cancelarCambio(c.id)}>
                                                            Cancelar
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="text-slate-500">{c.motivo} — {c.autor}</div>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* ─── Eliminar ─── */}
            <Dialog open={!!deletingEmp} onOpenChange={(open) => !open && setDeletingEmp(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Eliminar colaborador</DialogTitle>
                    </DialogHeader>
                    {deletingEmp && (
                        <div className="space-y-4 text-sm text-slate-700">
                            <p>
                                Vas a eliminar a <b>{deletingEmp.nombre}</b> (CC {deletingEmp.id}).
                            </p>
                            <ul className="list-disc pl-5 space-y-1 text-slate-600">
                                <li>Si <b>no tiene marcaciones ni novedades</b>, se elimina definitivamente.</li>
                                <li>Si <b>ya tiene marcaciones o novedades</b>, no se elimina: queda <b>inactivo</b> para conservar su historial.</li>
                            </ul>
                            <div className="flex justify-end gap-2 pt-2">
                                <Button type="button" variant="outline" onClick={() => setDeletingEmp(null)}>Cancelar</Button>
                                <Button
                                    type="button"
                                    className="bg-red-600 hover:bg-red-700"
                                    disabled={isDeleting}
                                    onClick={handleDelete}
                                >
                                    {isDeleting ? 'Procesando...' : 'Sí, eliminar'}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
        </div>
    )
}
