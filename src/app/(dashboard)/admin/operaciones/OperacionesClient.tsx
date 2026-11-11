'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
    Operacion, Turno,
    upsertOperacion, deleteOperacion,
    getTurnosPorOperacion, crearTurno, editarTurno, eliminarTurno
} from '../operaciones-actions'
import { Plus, Edit2, Trash2, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'

export function OperacionesClient({ initialData }: { initialData: Operacion[] }) {
    const router = useRouter()

    const [openModal, setOpenModal] = useState(false)
    const [loading, setLoading] = useState(false)
    const [form, setForm] = useState<Partial<Operacion>>({})

    // Turnos state
    const [turnosModal, setTurnosModal] = useState<string | null>(null) // operacion_id
    const [turnosModalNombre, setTurnosModalNombre] = useState('')
    const [turnos, setTurnos] = useState<Turno[]>([])
    const [turnoForm, setTurnoForm] = useState<{ nombre: string; hora_inicio: string; hora_fin: string }>({ nombre: '', hora_inicio: '', hora_fin: '' })
    const [editingTurnoId, setEditingTurnoId] = useState<string | null>(null)
    const [turnosLoading, setTurnosLoading] = useState(false)

    const handleOpenModal = (op?: Operacion) => {
        if (op) {
            setForm({ ...op })
        } else {
            setForm({ codigo: '', nombre: '', status: true, limite_horas: 8, max_extras_dia: 2, minutos_almuerzo: 0 })
        }
        setOpenModal(true)
    }

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!form.codigo?.trim()) return toast.error('El código de operación es obligatorio.')
        if (!form.nombre?.trim()) return toast.error('El nombre es obligatorio.')

        setLoading(true)
        const { success, error } = await upsertOperacion(form)
        if (success) {
            toast.success(form.id ? 'Operación actualizada' : 'Operación creada')
            setOpenModal(false)
            router.refresh()
        } else {
            toast.error(error || 'Error al guardar')
        }
        setLoading(false)
    }

    const handleDelete = async (id: string, nombre: string) => {
        if (!confirm(`¿Deseas eliminar permanentemente la operación "${nombre}"?`)) return

        const toastId = toast.loading('Eliminando...')
        const { success, error } = await deleteOperacion(id)
        if (success) {
            toast.success('Eliminada con éxito', { id: toastId })
            router.refresh()
        } else {
            toast.error(error || 'Hubo un error', { id: toastId })
        }
    }

    // Turnos handlers
    const openTurnosModal = async (op: Operacion) => {
        setTurnosModal(op.id)
        setTurnosModalNombre(op.nombre)
        setTurnosLoading(true)
        const res = await getTurnosPorOperacion(op.id)
        if (res.success && res.data) {
            setTurnos(res.data)
        } else {
            setTurnos([])
        }
        setTurnosLoading(false)
    }

    const resetTurnoForm = () => {
        setTurnoForm({ nombre: '', hora_inicio: '', hora_fin: '' })
        setEditingTurnoId(null)
    }

    const handleSaveTurno = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!turnoForm.nombre.trim() || !turnoForm.hora_inicio || !turnoForm.hora_fin) {
            return toast.error('Todos los campos del turno son obligatorios')
        }

        setTurnosLoading(true)
        let result

        if (editingTurnoId) {
            result = await editarTurno(editingTurnoId, turnoForm)
        } else {
            result = await crearTurno({ operacion_id: turnosModal!, ...turnoForm })
        }

        if (result.success) {
            toast.success(editingTurnoId ? 'Turno actualizado' : 'Turno creado')
            resetTurnoForm()
            // Refrescar turnos
            const res = await getTurnosPorOperacion(turnosModal!)
            if (res.success && res.data) setTurnos(res.data)
        } else {
            toast.error(result.error || 'Error al guardar turno')
        }
        setTurnosLoading(false)
    }

    const handleEditTurno = (turno: Turno) => {
        setEditingTurnoId(turno.id)
        setTurnoForm({
            nombre: turno.nombre,
            hora_inicio: turno.hora_inicio.slice(0, 5), // HH:MM
            hora_fin: turno.hora_fin.slice(0, 5)
        })
    }

    const handleDeleteTurno = async (id: string, nombre: string) => {
        if (!confirm(`¿Eliminar el turno "${nombre}"?`)) return
        const result = await eliminarTurno(id)
        if (result.success) {
            toast.success('Turno eliminado')
            setTurnos(prev => prev.filter(t => t.id !== id))
        } else {
            toast.error(result.error || 'Error al eliminar turno')
        }
    }

    return (
        <Card className="shadow-sm">
            <CardContent className="p-0">
                <div className="flex justify-between p-4 border-b bg-slate-50/50">
                    <Input placeholder="Buscar operación..." className="max-w-xs" disabled />
                    <Button onClick={() => handleOpenModal()} className="gap-2 shrink-0">
                        <Plus className="h-4 w-4" />
                        Nueva Operación
                    </Button>
                </div>

                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-slate-50">
                                <TableHead>Código</TableHead>
                                <TableHead>Nombre de la Operación</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead>Jornada</TableHead>
                                <TableHead>Almuerzo</TableHead>
                                <TableHead>Fecha Creación</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {initialData.map((op) => (
                                <TableRow key={op.id}>
                                    <TableCell className="font-mono text-sm text-blue-700 font-semibold">{op.codigo}</TableCell>
                                    <TableCell className="font-medium">{op.nombre}</TableCell>
                                    <TableCell>
                                        {op.status ? (
                                            <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
                                                Activa
                                            </Badge>
                                        ) : (
                                            <Badge variant="secondary" className="bg-slate-100 text-slate-800">
                                                Inactiva
                                            </Badge>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        <Badge variant="outline">{op.limite_horas ?? 8}h</Badge>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {op.minutos_almuerzo ? `${op.minutos_almuerzo} min` : '—'}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-sm">
                                        {op.created_at ? new Date(op.created_at).toLocaleDateString() : '-'}
                                    </TableCell>
                                    <TableCell className="text-right space-x-2">
                                        <Button variant="outline" size="sm" onClick={() => openTurnosModal(op)} title="Gestionar turnos">
                                            <Clock className="h-4 w-4 text-purple-600" />
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => handleOpenModal(op)}>
                                            <Edit2 className="h-4 w-4 text-blue-600" />
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => handleDelete(op.id, op.nombre)}>
                                            <Trash2 className="h-4 w-4 text-red-600" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}

                            {initialData.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                        No hay operaciones configuradas
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>

            {/* Modal: Crear/Editar Operación */}
            <Dialog open={openModal} onOpenChange={setOpenModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{form.id ? 'Editar Operación' : 'Nueva Operación'}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSave} className="space-y-4 pt-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Código de Operación *</label>
                            <Input
                                autoFocus
                                required
                                value={form.codigo || ''}
                                onChange={e => setForm({ ...form, codigo: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })}
                                placeholder="Ej. INL-ADMI"
                                maxLength={15}
                                className="font-mono uppercase"
                            />
                            <p className="text-xs text-slate-500">Formato: INL-XXXX (identificador único del centro de costo).</p>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Nombre *</label>
                            <Input
                                required
                                value={form.nombre || ''}
                                onChange={e => setForm({ ...form, nombre: e.target.value })}
                                placeholder="Ej. Bodega Central"
                            />
                        </div>
                        <div className="space-y-2 flex items-center justify-between">
                            <label className="text-sm font-medium">Estado (Activo vs Inactivo)</label>
                            <Button
                                type="button"
                                variant={form.status ? 'default' : 'outline'}
                                className={form.status ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                                onClick={() => setForm({ ...form, status: !form.status })}
                            >
                                {form.status ? 'Activo' : 'Inactivo'}
                            </Button>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Límite de Jornada</label>
                            <Select
                                value={String(form.limite_horas ?? 8)}
                                onValueChange={v => setForm({ ...form, limite_horas: parseInt(v) as 8 | 12 })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="8">8 horas (jornada estándar)</SelectItem>
                                    <SelectItem value="12">12 horas (turno extendido)</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-slate-500">Las horas extra se calculan a partir de las 8h (marco legal CO).</p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Máx. extras/día</label>
                                <Input
                                    type="number"
                                    min={0}
                                    max={16}
                                    value={form.max_extras_dia ?? 2}
                                    onChange={e => setForm({ ...form, max_extras_dia: parseInt(e.target.value) || 0 })}
                                />
                                <p className="text-xs text-slate-500">Horas extra permitidas por día.</p>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Descuento almuerzo</label>
                                <Input
                                    type="number"
                                    min={0}
                                    max={120}
                                    value={form.minutos_almuerzo ?? 0}
                                    onChange={e => setForm({ ...form, minutos_almuerzo: parseInt(e.target.value) || 0 })}
                                />
                                <p className="text-xs text-slate-500">Minutos a descontar si jornada &gt; 5h.</p>
                            </div>
                        </div>

                        {/* Geocerca: zona donde se acepta la marcación */}
                        <div className="space-y-2 rounded-lg border p-3 bg-slate-50/60">
                            <div className="flex items-center justify-between gap-2">
                                <label className="text-sm font-medium">Geocerca (opcional)</label>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs bg-white"
                                    onClick={() => {
                                        if (!navigator.geolocation) return toast.error('Este dispositivo no permite obtener la ubicación.')
                                        navigator.geolocation.getCurrentPosition(
                                            (pos) => {
                                                setForm((f) => ({
                                                    ...f,
                                                    latitud: Number(pos.coords.latitude.toFixed(6)),
                                                    longitud: Number(pos.coords.longitude.toFixed(6)),
                                                    radio_metros: f.radio_metros || 200,
                                                }))
                                                toast.success('Ubicación tomada. Revisa el radio.')
                                            },
                                            () => toast.error('No se pudo obtener la ubicación. Revisa el permiso del navegador.'),
                                            { enableHighAccuracy: true, timeout: 10000 },
                                        )
                                    }}
                                >
                                    Usar mi ubicación actual
                                </Button>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <label className="text-[11px] text-slate-500">Latitud</label>
                                    <Input
                                        type="number"
                                        step="any"
                                        value={form.latitud ?? ''}
                                        onChange={e => setForm({ ...form, latitud: e.target.value === '' ? null : parseFloat(e.target.value) })}
                                        placeholder="4.7110"
                                        className="bg-white"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] text-slate-500">Longitud</label>
                                    <Input
                                        type="number"
                                        step="any"
                                        value={form.longitud ?? ''}
                                        onChange={e => setForm({ ...form, longitud: e.target.value === '' ? null : parseFloat(e.target.value) })}
                                        placeholder="-74.0721"
                                        className="bg-white"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] text-slate-500">Radio (metros)</label>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={form.radio_metros ?? ''}
                                        onChange={e => setForm({ ...form, radio_metros: e.target.value === '' ? null : parseInt(e.target.value) })}
                                        placeholder="200"
                                        className="bg-white"
                                    />
                                </div>
                            </div>
                            <p className="text-xs text-slate-500">
                                Las marcaciones fuera de este radio, o sin ubicación, <b>no se bloquean</b>: quedan
                                marcadas como &quot;Fuera de geocerca&quot; para que el coordinador las valide.
                                Deja los tres campos vacíos para no usar geocerca.
                            </p>
                        </div>

                        <div className="pt-4 flex justify-end gap-2">
                            <Button type="button" variant="ghost" onClick={() => setOpenModal(false)} disabled={loading}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={loading}>
                                {loading ? 'Guardando...' : 'Guardar'}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Modal: Gestión de Turnos */}
            <Dialog open={!!turnosModal} onOpenChange={(open) => { if (!open) { setTurnosModal(null); resetTurnoForm() } }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Turnos — {turnosModalNombre}</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 pt-2">
                        {/* Formulario para agregar/editar turno */}
                        <form onSubmit={handleSaveTurno} className="space-y-3 p-3 border rounded-lg bg-slate-50">
                            <p className="text-sm font-medium text-slate-700">
                                {editingTurnoId ? 'Editar turno' : 'Agregar turno'}
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <Label className="text-xs">Nombre</Label>
                                    <Input
                                        placeholder="Ej. Mañana"
                                        value={turnoForm.nombre}
                                        onChange={e => setTurnoForm({ ...turnoForm, nombre: e.target.value })}
                                        required
                                    />
                                </div>
                                <div>
                                    <Label className="text-xs">Hora Inicio</Label>
                                    <Input
                                        type="time"
                                        value={turnoForm.hora_inicio}
                                        onChange={e => setTurnoForm({ ...turnoForm, hora_inicio: e.target.value })}
                                        required
                                    />
                                </div>
                                <div>
                                    <Label className="text-xs">Hora Fin</Label>
                                    <Input
                                        type="time"
                                        value={turnoForm.hora_fin}
                                        onChange={e => setTurnoForm({ ...turnoForm, hora_fin: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button type="submit" size="sm" disabled={turnosLoading}>
                                    {editingTurnoId ? 'Actualizar' : 'Agregar'}
                                </Button>
                                {editingTurnoId && (
                                    <Button type="button" size="sm" variant="ghost" onClick={resetTurnoForm}>
                                        Cancelar
                                    </Button>
                                )}
                            </div>
                        </form>

                        {/* Lista de turnos existentes */}
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Turno</TableHead>
                                        <TableHead>Horario</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {turnos.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={3} className="text-center py-4 text-muted-foreground text-sm">
                                                {turnosLoading ? 'Cargando...' : 'No hay turnos configurados'}
                                            </TableCell>
                                        </TableRow>
                                    )}
                                    {turnos.map(turno => (
                                        <TableRow key={turno.id}>
                                            <TableCell className="font-medium text-sm">{turno.nombre}</TableCell>
                                            <TableCell className="text-sm">
                                                {turno.hora_inicio.slice(0, 5)} — {turno.hora_fin.slice(0, 5)}
                                            </TableCell>
                                            <TableCell className="text-right space-x-1">
                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEditTurno(turno)}>
                                                    <Edit2 className="h-3 w-3 text-blue-600" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeleteTurno(turno.id, turno.nombre)}>
                                                    <Trash2 className="h-3 w-3 text-red-600" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    )
}
