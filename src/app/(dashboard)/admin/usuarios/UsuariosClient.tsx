'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Plus, Edit2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import {
    crearUsuarioAuth,
    editarPerfil,
    toggleBanUsuario,
    type PerfilConEmail
} from '../usuarios-actions'

type RolPanel = 'admin' | 'coordinador' | 'visualizador'

export function UsuariosClient({
    usuarios,
    operaciones
}: {
    usuarios: PerfilConEmail[]
    operaciones: { id: string; nombre: string }[]
}) {
    const router = useRouter()
    const [showCreateDialog, setShowCreateDialog] = useState(false)
    const [editingUser, setEditingUser] = useState<PerfilConEmail | null>(null)
    const [isLoading, setIsLoading] = useState(false)

    // Create form state
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [rol, setRol] = useState<RolPanel>('coordinador')
    const [operacion, setOperacion] = useState('')

    // Edit form state
    const [editRol, setEditRol] = useState<RolPanel>('coordinador')
    const [editOperacion, setEditOperacion] = useState('')

    const resetCreateForm = () => {
        setEmail('')
        setPassword('')
        setRol('coordinador')
        setOperacion('')
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)

        const result = await crearUsuarioAuth({
            email,
            password,
            rol,
            operacion_nombre: rol === 'admin' ? null : (operacion || null)
        })

        setIsLoading(false)

        if (!result.success) {
            toast.error(result.error)
        } else {
            toast.success('Usuario creado exitosamente')
            resetCreateForm()
            setShowCreateDialog(false)
            router.refresh()
        }
    }

    const openEditDialog = (user: PerfilConEmail) => {
        setEditingUser(user)
        setEditRol(user.rol as RolPanel)
        setEditOperacion(user.operacion_nombre || '')
    }

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingUser) return

        setIsLoading(true)

        const result = await editarPerfil({
            id: editingUser.id,
            rol: editRol,
            operacion_nombre: editRol === 'admin' ? null : (editOperacion || null)
        })

        setIsLoading(false)

        if (!result.success) {
            toast.error(result.error)
        } else {
            toast.success('Perfil actualizado')
            setEditingUser(null)
            router.refresh()
        }
    }

    const handleToggleBan = async (user: PerfilConEmail) => {
        const action = user.banned ? 'reactivar' : 'desactivar'
        if (!confirm(`¿Seguro que deseas ${action} la cuenta de ${user.email}?`)) return

        const result = await toggleBanUsuario(user.id)

        if (!result.success) {
            toast.error(result.error)
        } else {
            toast.success(`Cuenta ${user.banned ? 'reactivada' : 'desactivada'}`)
            router.refresh()
        }
    }

    return (
        <>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Usuarios Registrados ({usuarios.length})</CardTitle>
                    <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
                        <Plus className="h-4 w-4" />
                        Nuevo Usuario
                    </Button>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Rol</TableHead>
                                    <TableHead>Operación</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {usuarios.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                            No hay usuarios registrados.
                                        </TableCell>
                                    </TableRow>
                                )}
                                {usuarios.map(user => (
                                    <TableRow key={user.id}>
                                        <TableCell className="font-medium">{user.email}</TableCell>
                                        <TableCell>
                                            <Badge variant={user.rol === 'admin' ? 'default' : 'secondary'}>
                                                {user.rol}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            {user.operacion_nombre || <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell>
                                            {user.banned ? (
                                                <Badge variant="destructive">Desactivado</Badge>
                                            ) : (
                                                <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">Activo</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                                    onClick={() => openEditDialog(user)}
                                                    title="Editar perfil"
                                                >
                                                    <Edit2 className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className={user.banned
                                                        ? "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                                        : "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                                    }
                                                    onClick={() => handleToggleBan(user)}
                                                    title={user.banned ? 'Reactivar cuenta' : 'Desactivar cuenta'}
                                                >
                                                    {user.banned
                                                        ? <ShieldCheck className="h-4 w-4" />
                                                        : <ShieldAlert className="h-4 w-4" />
                                                    }
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* Dialog: Crear usuario */}
            <Dialog open={showCreateDialog} onOpenChange={(open) => { if (!open) { resetCreateForm(); setShowCreateDialog(false) } }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Crear Nuevo Usuario</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleCreate} className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="create-email">Email *</Label>
                            <Input
                                id="create-email"
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                                placeholder="correo@ejemplo.com"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="create-password">Contraseña *</Label>
                            <Input
                                id="create-password"
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                minLength={6}
                                placeholder="Mínimo 6 caracteres"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Rol *</Label>
                            <Select value={rol} onValueChange={(v) => setRol(v as RolPanel)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="coordinador">Coordinador</SelectItem>
                                    <SelectItem value="visualizador">Visualizador (solo consulta)</SelectItem>
                                    <SelectItem value="admin">Administrador</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {rol !== 'admin' && (
                            <div className="space-y-2">
                                <Label>{rol === 'coordinador' ? 'Operación Asignada *' : 'Operación (vacío = consulta todas)'}</Label>
                                <Select value={operacion} onValueChange={setOperacion}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccione operación..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {operaciones.map(op => (
                                            <SelectItem key={op.id} value={op.nombre}>{op.nombre}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        <div className="pt-4 flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => { resetCreateForm(); setShowCreateDialog(false) }}>
                                Cancelar
                            </Button>
                            <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isLoading}>
                                {isLoading ? 'Creando...' : 'Crear Usuario'}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Dialog: Editar perfil */}
            <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Editar Perfil</DialogTitle>
                    </DialogHeader>
                    {editingUser && (
                        <form onSubmit={handleEdit} className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input value={editingUser.email} readOnly disabled className="bg-slate-50" />
                            </div>

                            <div className="space-y-2">
                                <Label>Rol *</Label>
                                <Select value={editRol} onValueChange={(v) => setEditRol(v as RolPanel)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="coordinador">Coordinador</SelectItem>
                                        <SelectItem value="visualizador">Visualizador (solo consulta)</SelectItem>
                                    <SelectItem value="admin">Administrador</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {editRol !== 'admin' && (
                                <div className="space-y-2">
                                    <Label>{editRol === 'coordinador' ? 'Operación Asignada *' : 'Operación (vacío = consulta todas)'}</Label>
                                    <Select value={editOperacion} onValueChange={setEditOperacion}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Seleccione operación..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {operaciones.map(op => (
                                                <SelectItem key={op.id} value={op.nombre}>{op.nombre}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            <div className="pt-4 flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
                                    Cancelar
                                </Button>
                                <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={isLoading}>
                                    {isLoading ? 'Guardando...' : 'Guardar Cambios'}
                                </Button>
                            </div>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </>
    )
}
