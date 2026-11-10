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
import { Edit2, Ban, CheckCircle, Eye, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { editarEmpleado, cambiarEstadoEmpleado, eliminarEmpleado } from './actions'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

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
    const [editingEmp, setEditingEmp] = useState<any>(null)
    const [isSaving, setIsSaving] = useState(false)
    const [searchTerm, setSearchTerm] = useState('')

    // Form states
    const [editNombre, setEditNombre] = useState('')
    const [editCargo, setEditCargo] = useState('')
    const [editOp, setEditOp] = useState('')
    const [editStatus, setEditStatus] = useState('')
    const [editCedula, setEditCedula] = useState('')
    const [editSalario, setEditSalario] = useState('')

    const openEditDialog = (emp: any) => {
        setEditingEmp(emp)
        setEditNombre(emp.nombre)
        setEditCargo(emp.cargo)
        setEditOp(emp.operacion)
        setEditStatus(emp.status)
        setEditCedula(emp.id)
        setEditSalario(emp.salario?.toString() || '')
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
        formData.append('operacion', editOp)
        formData.append('status', editStatus)
        formData.append('salario', editSalario)

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

    const [deletingEmp, setDeletingEmp] = useState<any>(null)
    const [isDeleting, setIsDeleting] = useState(false)
    const esAdmin = rol === 'admin'

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
                        <TableHead>Estado</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {filteredEmpleados?.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
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
                            <TableCell>{emp.operacion}</TableCell>
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
                                    {esAdmin && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                            onClick={() => setDeletingEmp(emp)}
                                            title="Eliminar (creado por error)"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

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
                                <Label htmlFor="edit-op">Operación *</Label>
                                <Select value={editOp} onValueChange={setEditOp} disabled={!esAdmin}>
                                    <SelectTrigger id="edit-op">
                                        <SelectValue placeholder="Seleccione una operación..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {operaciones.map(op => (
                                            <SelectItem key={op.id} value={op.nombre}>{op.nombre}</SelectItem>
                                        ))}
                                        {operaciones.length === 0 && <SelectItem value="default" disabled>No hay operaciones activas</SelectItem>}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-slate-500">
                                    {esAdmin
                                        ? 'Es la operación (CECO) por defecto con la que marca en el quiosco. El cambio aplica a las próximas marcaciones; las anteriores no se modifican.'
                                        : 'Solo un administrador puede cambiar la operación (CECO).'}
                                </p>
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
