'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import type { EmpleadoExistente } from './actions'
import { hoyColombiaISO } from '@/lib/asistencia'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { crearEmpleado } from './actions'
import { getTurnosPorNombreOperacion } from '../admin/operaciones-actions'
import type { Turno } from '../admin/operaciones-actions'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

export function EmpleadoForm({
    operaciones,
    rol,
    operacionFija
}: {
    operaciones: { id: string, nombre: string }[]
    rol: string
    operacionFija: string | null
}) {
    const router = useRouter()
    const [isLoading, setIsLoading] = useState(false)

    const isCoordinador = rol === 'coordinador' && !!operacionFija

    const [birthdate, setBirthdate] = useState('')
    const [operacion, setOperacion] = useState(isCoordinador ? operacionFija : '')
    const [turnoId, setTurnoId] = useState('')
    const [turnos, setTurnos] = useState<Turno[]>([])
    const [turnosLoading, setTurnosLoading] = useState(false)
    const formRef = useRef<HTMLFormElement>(null)
    const [aviso, setAviso] = useState<{
        tipo: 'existente' | 'duplicado'
        registros: EmpleadoExistente[]
    } | null>(null)

    // Límites razonables para la fecha de nacimiento: entre hace 100 años y hace 16 (edad mínima laboral CO)
    const hoyISO = hoyColombiaISO()
    const hoy = new Date()
    const maxDate = new Date(hoy.getFullYear() - 16, hoy.getMonth(), hoy.getDate()).toISOString().slice(0, 10)
    const minDate = new Date(hoy.getFullYear() - 100, hoy.getMonth(), hoy.getDate()).toISOString().slice(0, 10)

    // Cargar turnos cuando cambia la operacion
    useEffect(() => {
        if (!operacion) {
            setTurnos([])
            setTurnoId('')
            return
        }

        setTurnosLoading(true)
        getTurnosPorNombreOperacion(operacion).then(res => {
            if (res.success && res.data) {
                setTurnos(res.data)
            } else {
                setTurnos([])
            }
            setTurnoId('')
            setTurnosLoading(false)
        })
    }, [operacion])

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        await guardar(event.currentTarget as HTMLFormElement, false)
    }

    async function guardar(form: HTMLFormElement, confirmarDuplicado: boolean) {
        if (!birthdate) {
            toast.error('Ingresa la fecha de nacimiento.')
            return
        }
        if (!operacion) {
            toast.error('Selecciona una operación.')
            return
        }

        setIsLoading(true)
        const formData = new FormData(form)
        formData.append('birthdate', birthdate)
        formData.append('operacion', operacion)
        if (turnoId) formData.append('turno_id', turnoId)
        if (confirmarDuplicado) formData.append('confirmar_duplicado', '1')

        const result = await crearEmpleado(formData)

        setIsLoading(false)
        setAviso(null)

        if (!result.success) {
            if (result.existente) {
                // Cédula ya registrada: se muestra el registro existente en lugar de crear otro
                setAviso({ tipo: 'existente', registros: [result.existente] })
            } else if (result.posiblesDuplicados?.length) {
                setAviso({ tipo: 'duplicado', registros: result.posiblesDuplicados })
            } else {
                toast.error(result.error)
            }
        } else {
            toast.success('Empleado registrado exitosamente.')
            form.reset()
            setBirthdate('')
            setOperacion(isCoordinador ? operacionFija : '')
            setTurnoId('')
            router.refresh()
        }
    }

    return (
        <Card className="shadow-sm">
            <CardHeader>
                <CardTitle className="text-xl">Agregar Nuevo Empleado</CardTitle>
            </CardHeader>
            <CardContent>
                <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="cedula">Cédula *</Label>
                        <Input
                            id="cedula"
                            name="cedula"
                            required
                            placeholder="Solo números, sin puntos"
                            inputMode="numeric"
                            minLength={6}
                            maxLength={10}
                            onInput={(e) => {
                                // Solo números: se quitan puntos, espacios y letras al escribir o pegar
                                e.currentTarget.value = e.currentTarget.value.replace(/\D/g, '')
                                if (aviso) setAviso(null)
                            }}
                        />
                        <p className="text-xs text-slate-500">Entre 6 y 10 dígitos, sin puntos ni espacios.</p>
                    </div>

                    {aviso && (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
                            <p className="font-semibold flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 shrink-0" />
                                {aviso.tipo === 'existente'
                                    ? 'Esta cédula ya está registrada'
                                    : 'Posible duplicado: mismo nombre con otra cédula'}
                            </p>
                            <ul className="space-y-1">
                                {aviso.registros.map((r) => (
                                    <li key={r.id}>
                                        <Link href={`/empleados/${r.id}`} className="underline font-medium">
                                            {r.nombre}
                                        </Link>{' '}
                                        · CC {r.id} · {r.operacion ?? 'sin operación'} · {r.status}
                                    </li>
                                ))}
                            </ul>
                            {aviso.tipo === 'existente' ? (
                                <p className="text-xs">
                                    No se creó un registro nuevo. Abre el colaborador existente para revisarlo o reactivarlo.
                                </p>
                            ) : (
                                <div className="flex flex-wrap gap-2 pt-1">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setAviso(null)}
                                    >
                                        Cancelar y revisar
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="bg-amber-600 hover:bg-amber-700"
                                        disabled={isLoading}
                                        onClick={() => formRef.current && guardar(formRef.current, true)}
                                    >
                                        Es otra persona, crear de todas formas
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="nombre">Nombre Completo *</Label>
                        <Input id="nombre" name="nombre" required placeholder="Ingrese el nombre completo" />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="cargo">Cargo *</Label>
                        <Input id="cargo" name="cargo" required placeholder="Ej. Operario" />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="birthdate">Fecha de Nacimiento *</Label>
                        <Input
                            id="birthdate"
                            type="date"
                            value={birthdate}
                            onChange={(e) => setBirthdate(e.target.value)}
                            min={minDate}
                            max={maxDate}
                            required
                        />
                        <p className="text-xs text-slate-500">Edad mínima: 16 años.</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="fecha_ingreso">Fecha de Ingreso *</Label>
                        <Input
                            id="fecha_ingreso"
                            name="fecha_ingreso"
                            type="date"
                            defaultValue={hoyISO}
                            max={hoyISO}
                            required
                        />
                        <p className="text-xs text-slate-500">Desde este día se cuenta su asistencia.</p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="operacion">Operación *</Label>
                        <Select value={operacion} onValueChange={setOperacion} disabled={isCoordinador}>
                            <SelectTrigger>
                                <SelectValue placeholder="Seleccione una operación..." />
                            </SelectTrigger>
                            <SelectContent>
                                {operaciones.map(op => (
                                    <SelectItem key={op.id} value={op.nombre}>{op.nombre}</SelectItem>
                                ))}
                                {operaciones.length === 0 && <SelectItem value="default" disabled>No hay operaciones activas</SelectItem>}
                            </SelectContent>
                        </Select>
                    </div>

                    {operacion && (
                        <div className="space-y-2">
                            <Label htmlFor="turno">Turno Asignado</Label>
                            {turnosLoading ? (
                                <p className="text-sm text-muted-foreground">Cargando turnos...</p>
                            ) : turnos.length > 0 ? (
                                <Select value={turnoId} onValueChange={setTurnoId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccione un turno..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {turnos.map(t => (
                                            <SelectItem key={t.id} value={t.id}>
                                                {t.nombre} ({t.hora_inicio.slice(0, 5)} — {t.hora_fin.slice(0, 5)})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <p className="text-sm text-muted-foreground">No hay turnos configurados para esta operación</p>
                            )}
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="salario">Salario Mensual</Label>
                        <Input
                            id="salario"
                            name="salario"
                            type="number"
                            placeholder="Ej. 1300000"
                            min="0"
                        />
                    </div>

                    <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={isLoading}>
                        {isLoading ? 'Guardando...' : 'Agregar Usuario'}
                    </Button>
                </form>
            </CardContent>
        </Card>
    )
}
