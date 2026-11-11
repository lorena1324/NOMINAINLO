'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { crearNovedad, buscarEmpleadoNombre } from './actions'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { TIPOS_AUSENTISMO, CAUSAS_AUSENTISMO } from '@/lib/constants/ausentismos'

// Tipos de novedades con metadata de comportamiento
const TIPOS_NOVEDAD = [
    // Domingos/Festivos
    { value: 'GANA_DOMINGO',      label: 'Gana Domingo',       grupo: 'Domingos/Festivos', requiereFechas: false },
    { value: 'NO_GANA_DOMINGO',   label: 'No Gana Domingo',    grupo: 'Domingos/Festivos', requiereFechas: false },
    { value: 'GANA_FESTIVO',      label: 'Gana Festivo',       grupo: 'Domingos/Festivos', requiereFechas: false },
    // Ausencias
    { value: 'AUSENTISMO',        label: 'Ausentismo',         grupo: 'Ausencias',         requiereFechas: false },
    { value: 'PERMISO',           label: 'Permiso',            grupo: 'Ausencias',         requiereFechas: false },
    { value: 'SANCION',           label: 'Sanción',            grupo: 'Ausencias',         requiereFechas: true  },
    // Incapacidades
    { value: 'INCAPACIDAD',       label: 'Incapacidad',        grupo: 'Incapacidades',     requiereFechas: true  },
    { value: 'INCAPACIDAD_ARL',   label: 'Incapacidad ARL',    grupo: 'Incapacidades',     requiereFechas: true  },
    // Licencias
    { value: 'LIC_NO_REMUNERADA', label: 'Lic. No Remunerada', grupo: 'Licencias',         requiereFechas: true  },
    { value: 'LIC_LUTO',          label: 'Lic. de Luto',       grupo: 'Licencias',         requiereFechas: true  },
    { value: 'LIC_MATERNIDAD',    label: 'Lic. Maternidad',    grupo: 'Licencias',         requiereFechas: true  },
    { value: 'LIC_REMUNERADA',    label: 'Lic. Remunerada',    grupo: 'Licencias',         requiereFechas: true  },
    // Días especiales
    { value: 'DIA_CUMPLEANOS',    label: 'Día Cumpleaños',     grupo: 'Días Especiales',   requiereFechas: false },
    { value: 'DIA_FAMILIA',       label: 'Día Familia',        grupo: 'Días Especiales',   requiereFechas: false },
    { value: 'VACACIONES',        label: 'Vacaciones',         grupo: 'Días Especiales',   requiereFechas: true  },
    // Turnos
    { value: 'FIN_TURNO_NOCHE',   label: 'Fin Turno Noche',    grupo: 'Turnos',            requiereFechas: false },
    { value: 'FIN_TURNO_DIA',     label: 'Fin Turno Día',      grupo: 'Turnos',            requiereFechas: false },
    // Tiempo
    { value: 'COMPENSA_TIEMPO',   label: 'Compensa Tiempo',    grupo: 'Tiempo',            requiereFechas: false, requiereHoras: true },
    { value: 'PAGA_TIEMPO',       label: 'Paga Tiempo',        grupo: 'Tiempo',            requiereFechas: false },
    // Auxilios
    { value: 'AUXILIO_NO_PRESTACIONAL', label: 'Auxilio No Prestacional', grupo: 'Auxilios', requiereFechas: false, requiereValor: true },
    // Movimientos
    { value: 'TRASLADO',          label: 'Traslado',           grupo: 'Movimientos',       requiereFechas: false },
    { value: 'INGRESO_NUEVO',     label: 'Ingreso Nuevo',      grupo: 'Movimientos',       requiereFechas: false },
    { value: 'RETIRO',            label: 'Retiro',             grupo: 'Movimientos',       requiereFechas: false },
] as const

const grupos = [...new Set(TIPOS_NOVEDAD.map((t) => t.grupo))]

interface NovedadesFormProps {
    rol?: string
}

export function NovedadesForm({}: NovedadesFormProps) {
    const router = useRouter()
    const [isLoading, setIsLoading] = useState(false)
    const [cedula, setCedula] = useState('')
    const [nombre, setNombre] = useState('')
    const [tipoNovedad, setTipoNovedad] = useState('')
    const [esPagado, setEsPagado] = useState('false')
    const [codigoCausa, setCodigoCausa] = useState('')
    const [tipoAusentismo, setTipoAusentismo] = useState('')
    const [horasCompensa, setHorasCompensa] = useState('')

    const tipoConfig = TIPOS_NOVEDAD.find((t) => t.value === tipoNovedad) as
        | (typeof TIPOS_NOVEDAD)[number] & { requiereHoras?: boolean; requiereValor?: boolean }
        | undefined
    const necesitaRangoFechas = tipoConfig?.requiereFechas ?? false
    const necesitaHoras = tipoConfig?.requiereHoras ?? false
    const necesitaValor = tipoConfig?.requiereValor ?? false

    useEffect(() => {
        const fetchNombre = async () => {
            if (cedula.length >= 6) {
                const nombreEncontrado = await buscarEmpleadoNombre(cedula)
                setNombre(nombreEncontrado || '')
            } else {
                setNombre('')
            }
        }
        const t = setTimeout(fetchNombre, 500)
        return () => clearTimeout(t)
    }, [cedula])

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()

        if (!tipoNovedad) {
            toast.error('Seleccione el tipo de novedad.')
            return
        }
        if (necesitaRangoFechas) {
            const form = event.currentTarget as HTMLFormElement
            const fd = new FormData(form)
            if (!fd.get('fecha_inicio') || !fd.get('fecha_fin')) {
                toast.error('Complete el rango de fechas.')
                return
            }
        }
        if (necesitaHoras) {
            const h = parseFloat(horasCompensa)
            if (!Number.isFinite(h) || h <= 0) {
                toast.error('Ingrese una cantidad de horas válida para compensar.')
                return
            }
        }

        setIsLoading(true)
        const form = event.currentTarget as HTMLFormElement
        const formData = new FormData(form)
        formData.append('usuario_id', cedula)
        formData.append('tipo_novedad', tipoNovedad)
        formData.append('es_pagado', esPagado)
        if (codigoCausa) formData.append('codigo_causa', codigoCausa)
        if (tipoAusentismo) formData.append('tipo_ausentismo', tipoAusentismo)
        if (necesitaHoras) formData.append('horas_compensa', horasCompensa)

        const result = await crearNovedad(formData)

        setIsLoading(false)

        if (!result.success) {
            toast.error(result.error ?? 'Error al registrar la novedad.')
            return
        }

        toast.success('Novedad registrada exitosamente.')
        form.reset()
        setCedula('')
        setNombre('')
        setTipoNovedad('')
        setEsPagado('false')
        setCodigoCausa('')
        setTipoAusentismo('')
        setHorasCompensa('')
        router.refresh()
    }

    return (
        <Card className="shadow-sm">
            <CardHeader>
                <CardTitle className="text-xl">Nueva Novedad</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="cedula">Cédula del Empleado *</Label>
                        <Input
                            id="cedula"
                            name="cedula"
                            value={cedula}
                            onChange={(e) => setCedula(e.target.value)}
                            required
                            placeholder="Ingrese la cédula"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="nombre">Nombre del Empleado</Label>
                        <Input
                            id="nombre"
                            name="nombre"
                            value={nombre}
                            readOnly
                            className="bg-slate-50 cursor-not-allowed"
                            placeholder="Se autocompletará"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="tipoNovedad">Tipo de Novedad *</Label>
                        <Select value={tipoNovedad} onValueChange={setTipoNovedad}>
                            <SelectTrigger>
                                <SelectValue placeholder="Seleccione un tipo..." />
                            </SelectTrigger>
                            <SelectContent>
                                {grupos.map((grupo) => (
                                    <div key={grupo}>
                                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{grupo}</div>
                                        {TIPOS_NOVEDAD.filter((t) => t.grupo === grupo).map((t) => (
                                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                        ))}
                                    </div>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Fecha única */}
                    {tipoNovedad && !necesitaRangoFechas && (
                        <div className="space-y-2">
                            <Label htmlFor="fecha_novedad">Fecha de la Novedad *</Label>
                            <Input type="date" id="fecha_novedad" name="fecha_novedad" required />
                        </div>
                    )}

                    {/* Rango de fechas */}
                    {necesitaRangoFechas && (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="fecha_inicio">Fecha Inicio *</Label>
                                <Input type="date" id="fecha_inicio" name="fecha_inicio" required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="fecha_fin">Fecha Fin *</Label>
                                <Input type="date" id="fecha_fin" name="fecha_fin" required />
                            </div>
                        </div>
                    )}

                    {/* Horas para COMPENSA_TIEMPO */}
                    {necesitaHoras && (
                        <div className="space-y-2">
                            <Label htmlFor="horas_compensa">Horas a Compensar *</Label>
                            <Input
                                type="number"
                                id="horas_compensa"
                                step="0.5"
                                min="0.5"
                                value={horasCompensa}
                                onChange={(e) => setHorasCompensa(e.target.value)}
                                placeholder="Ej: 4 (se descontarán de la bolsa)"
                                required
                            />
                            <p className="text-xs text-slate-500">
                                Se restarán del saldo a favor del empleado y cuentan como justificadas para las 44h.
                            </p>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="descripcion">Observaciones</Label>
                        <Textarea
                            id="descripcion"
                            name="descripcion"
                            placeholder="Describa la razón o justificación..."
                            rows={2}
                        />
                    </div>

                    {tipoNovedad && (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="tipo_ausentismo">Tipo de Ausentismo</Label>
                                <Select value={tipoAusentismo} onValueChange={setTipoAusentismo}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccione tipo..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(TIPOS_AUSENTISMO).map(([code, label]) => (
                                            <SelectItem key={code} value={code}>{code} - {label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="codigo_causa">Causa de Ausentismo</Label>
                                <Select value={codigoCausa} onValueChange={setCodigoCausa}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccione causa..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(CAUSAS_AUSENTISMO).map(([code, label]) => (
                                            <SelectItem key={code} value={code}>{code} - {label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label htmlFor="valor_monetario">Valor Monetario (COP){necesitaValor ? ' *' : ''}</Label>
                        <Input
                            type="number"
                            id="valor_monetario"
                            name="valor_monetario"
                            placeholder={necesitaValor ? 'Ingrese el valor del auxilio' : 'Opcional'}
                            min="0"
                            required={necesitaValor}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>¿Es remunerada?</Label>
                        <Select value={esPagado} onValueChange={setEsPagado}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="true">Sí — cuenta para las 44h</SelectItem>
                                <SelectItem value="false">No</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <Button
                        type="submit"
                        className="w-full bg-blue-600 hover:bg-blue-700"
                        disabled={isLoading || !nombre}
                    >
                        {isLoading ? 'Guardando...' : 'Registrar Novedad'}
                    </Button>
                </form>
            </CardContent>
        </Card>
    )
}
