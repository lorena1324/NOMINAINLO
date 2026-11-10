'use client'

import { useMemo, useCallback, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    ArrowLeft,
    Briefcase,
    User,
    Calendar,
    Clock,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    TrendingUp,
    TrendingDown,
    Minus,
    FileText,
    DollarSign,
    Wallet,
    ShieldAlert,
    Target,
    Sun,
    Plus,
    ArrowDownLeft,
    ArrowUpRight,
    Info,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react'
import type { ResumenEmpleadoPeriodo } from '@/lib/reportes'
import type { FilaAsistencia } from '@/lib/asistenciaDatos'
import { TablaAsistencia } from '@/components/TablaAsistencia'
import { CorregirJornada, ResolverExtras, RevisarAlerta } from '@/components/AccionesAlerta'
import { hoyColombiaISO, quincenaDeFecha } from '@/lib/asistencia'

// ═══════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════

type EstadoJornada = 'ABIERTO' | 'CERRADO' | 'CERRADO_MANUAL' | 'INCONSISTENTE'
type EstadoAprobacion = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA'
type TipoAlerta = 'INCONSISTENTE' | 'ALERTA_CRITICA' | 'EXTRAS_PENDIENTES'
type TipoMovimiento =
    | 'ABONO_EXCEDENTE'
    | 'CARGO_DEFICIT'
    | 'NOVEDAD_COMPENSA'
    | 'AJUSTE_MANUAL'

interface Jornada {
    id: string
    empleado_id: string
    operacion: string
    entrada: string
    salida: string | null
    estado: EstadoJornada
    minutos_total: number
    minutos_normales: number
    minutos_nocturnas: number
    minutos_domingos: number
    minutos_festivos: number
    minutos_domingos_festivos_nocturnos: number
    minutos_extras_ordinarias: number
    minutos_extras_nocturnas: number
    minutos_extras_dominical_festivo: number
    minutos_extras_nocturna_dominical_festivo: number
    minutos_almuerzo_descontados: number
    cerrada_por: string | null
    alerta_critica: boolean
}

interface Novedad {
    id: string
    tipo_novedad: string
    fecha_novedad: string
    fecha_inicio: string | null
    fecha_fin: string | null
    es_pagado: boolean
    codigo_causa: number | null
    valor_monetario: number | null
    descripcion: string | null
    created_at: string
}

interface Movimiento {
    id: string
    minutos: number
    motivo: TipoMovimiento
    saldo_antes: number
    saldo_despues: number
    nota: string | null
    created_at: string
    jornada_id: string | null
    novedad_id: string | null
}

interface Aprobacion {
    id: string
    jornada_id: string
    minutos_solicitados: number
    estado: EstadoAprobacion
    coordinador_id: string | null
    nota_coordinador: string | null
    created_at: string
    updated_at: string
}

interface Alerta {
    id: string
    tipo: TipoAlerta
    jornada_id: string | null
    operacion: string | null
    mensaje: string | null
    leida: boolean
    created_at: string
    /** Jornada asociada (para registrar la salida real desde la alerta). */
    jornada?: { entrada: string; estado: string } | null
    /** Solicitud de horas extra pendiente asociada. */
    aprobacionId?: string | null
}

interface Correccion {
    id: string
    mensaje: string | null
    created_at: string
}

interface SemanaDominical {
    semana_inicio: string
    semana_fin: string
    minutos_ordinarios: number
    minutos_novedades_remuneradas: number
    total_minutos_cumplimiento: number
    paga_domingo: boolean | null
    marcado_por: string
    created_at: string
}

interface Props {
    empleado: {
        id: string
        nombre: string
        cargo: string | null
        operacion: string | null
        status: 'activo' | 'inactivo'
    }
    jornadasMes: Jornada[]
    /** Asistencia día a día del mes, incluidos los días sin marcación. */
    dias: FilaAsistencia[]
    correcciones: Correccion[]
    diasRango: { inicio: string; fin: string }
    novedades: Novedad[]
    horasMes: ResumenEmpleadoPeriodo | null
    bolsaSaldo: number
    movimientosBolsa: Movimiento[]
    aprobaciones: Aprobacion[]
    alertas: Alerta[]
    semanaDominical: SemanaDominical | null
    configOperacion: {
        limite_horas: number
        minutos_almuerzo: number
        turnos: { nombre: string; hora_inicio: string; hora_fin: string }[]
    } | null
    mesRango: { inicio: string; fin: string }
    rol: 'admin' | 'coordinador'
}

// ═══════════════════════════════════════════════════════════════════════
// UTILIDADES DE FORMATO
// ═══════════════════════════════════════════════════════════════════════

function iniciales(nombre: string) {
    return nombre
        .split(' ')
        .slice(0, 2)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
}

function fmtMinutos(min: number, opts: { conSigno?: boolean } = {}): string {
    if (!min) return opts.conSigno ? '0h 00m' : '0h 00m'
    const signo = min < 0 ? '-' : opts.conSigno && min > 0 ? '+' : ''
    const abs = Math.abs(min)
    const h = Math.floor(abs / 60)
    const m = abs % 60
    return `${signo}${h}h ${String(m).padStart(2, '0')}m`
}

function fmtCOP(n: number) {
    return `$${(n ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`
}

function horaColombia(iso: string) {
    const d = new Date(iso)
    const col = new Date(d.getTime() - 5 * 60 * 60 * 1000)
    const h = col.getUTCHours()
    const m = col.getUTCMinutes()
    const ampm = h >= 12 ? 'p.m.' : 'a.m.'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`
}

function fechaCortaColombia(iso: string) {
    const d = new Date(iso)
    const col = new Date(d.getTime() - 5 * 60 * 60 * 1000)
    const dia = String(col.getUTCDate()).padStart(2, '0')
    const mes = String(col.getUTCMonth() + 1).padStart(2, '0')
    return `${dia}/${mes}/${col.getUTCFullYear()}`
}

function fechaLargaColombia(iso: string) {
    const d = new Date(iso)
    const col = new Date(d.getTime() - 5 * 60 * 60 * 1000)
    return col.toLocaleDateString('es-CO', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
    })
}

function fechaSoloFecha(iso: string) {
    // para fechas que vienen como YYYY-MM-DD (sin hora)
    const [y, m, d] = iso.split('T')[0].split('-').map(Number)
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

function nombreMes(iso: string) {
    const d = new Date(iso)
    const s = d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
    return s.charAt(0).toUpperCase() + s.slice(1)
}

// ═══════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE LABELS Y COLORES
// ═══════════════════════════════════════════════════════════════════════

const ESTADO_JORNADA_CFG: Record<EstadoJornada, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
    ABIERTO:        { label: 'En curso',        cls: 'bg-blue-100 text-blue-700 border-blue-200',       Icon: Clock },
    CERRADO:        { label: 'Cerrada',         cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
    CERRADO_MANUAL: { label: 'Cierre manual',   cls: 'bg-amber-100 text-amber-700 border-amber-200',    Icon: ShieldAlert },
    INCONSISTENTE:  { label: 'Cierre automático', cls: 'bg-red-100 text-red-700 border-red-200',        Icon: AlertTriangle },
}

const ESTADO_APROBACION_CFG: Record<EstadoAprobacion, { label: string; cls: string }> = {
    PENDIENTE: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    APROBADA:  { label: 'Aprobada',  cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    RECHAZADA: { label: 'Rechazada', cls: 'bg-red-100 text-red-700 border-red-200' },
}

const MOTIVO_CFG: Record<TipoMovimiento, { label: string; Icon: typeof Plus; tone: 'pos' | 'neg' | 'neutro' }> = {
    ABONO_EXCEDENTE:   { label: 'Abono por excedente',  Icon: ArrowUpRight,   tone: 'pos' },
    CARGO_DEFICIT:     { label: 'Cargo por déficit',    Icon: ArrowDownLeft,  tone: 'neg' },
    NOVEDAD_COMPENSA:  { label: 'Compensación usada',   Icon: ArrowDownLeft,  tone: 'neg' },
    AJUSTE_MANUAL:     { label: 'Ajuste manual',        Icon: Info,           tone: 'neutro' },
}

const ALERTA_CFG: Record<TipoAlerta, { label: string; cls: string; Icon: typeof AlertTriangle }> = {
    INCONSISTENTE:     { label: 'Jornada sin salida (cierre automático)', cls: 'bg-red-50 border-red-300 text-red-800', Icon: AlertTriangle },
    ALERTA_CRITICA:    { label: 'Jornada >12h',            cls: 'bg-orange-50 border-orange-300 text-orange-800', Icon: ShieldAlert },
    EXTRAS_PENDIENTES: { label: 'Extras por aprobar',      cls: 'bg-amber-50 border-amber-300 text-amber-800', Icon: Clock },
}

const DESGLOSE_TIPOS = [
    { key: 'normales',                       label: 'Ordinarias',          color: 'bg-slate-100 text-slate-700',     concepto: 'normal' },
    { key: 'nocturnas',                      label: 'Nocturnas',           color: 'bg-indigo-100 text-indigo-700',   concepto: 'nocturno' },
    { key: 'domingos',                       label: 'Domingo',             color: 'bg-blue-100 text-blue-700',       concepto: 'domingo' },
    { key: 'festivos',                       label: 'Festivo',             color: 'bg-amber-100 text-amber-800',     concepto: 'festivo' },
    { key: 'domingosFestivosNocturnos',      label: 'Dom/Fest Nocturno',   color: 'bg-violet-100 text-violet-700',   concepto: 'domingoFestivoNocturno' },
    { key: 'extrasOrdinarias',               label: 'Extra ordinaria',     color: 'bg-emerald-100 text-emerald-700', concepto: 'extra' },
    { key: 'extrasNocturnas',                label: 'Extra nocturna',      color: 'bg-pink-100 text-pink-700',       concepto: 'extraNocturno' },
    { key: 'extrasDominicalFestivo',         label: 'Extra dom/fest',      color: 'bg-orange-100 text-orange-700',   concepto: 'extraDominicalFestivo' },
    { key: 'extrasNocturnaDominicalFestivo', label: 'Extra nocturna d/f',  color: 'bg-red-100 text-red-700',         concepto: 'extraNocturnaDominicalFestivo' },
] as const

// ═══════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════

export function EmpleadoDetalleClient(props: Props) {
    const {
        empleado,
        jornadasMes,
        dias,
        correcciones,
        diasRango,
        novedades,
        horasMes,
        bolsaSaldo,
        movimientosBolsa,
        aprobaciones,
        alertas,
        semanaDominical,
        configOperacion,
        mesRango,
    } = props

    const router = useRouter()
    const pathname = usePathname()

    const mesActual = useMemo(() => {
        const d = new Date(mesRango.inicio)
        return { year: d.getFullYear(), month: d.getMonth() }
    }, [mesRango.inicio])

    const esHoy = useMemo(() => {
        const now = new Date()
        return mesActual.year === now.getFullYear() && mesActual.month === now.getMonth()
    }, [mesActual])

    const navegarMes = useCallback(
        (delta: number) => {
            const d = new Date(mesActual.year, mesActual.month + delta, 1)
            const param = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
            router.push(`${pathname}?mes=${param}`)
        },
        [mesActual, pathname, router],
    )

    // KPIs derivados
    const jornadasInconsistentes = jornadasMes.filter((j) => j.estado === 'INCONSISTENTE').length
    const aprobacionesPendientes = aprobaciones.filter((a) => a.estado === 'PENDIENTE').length
    const minutosExtrasPendientes = aprobaciones
        .filter((a) => a.estado === 'PENDIENTE')
        .reduce((acc, a) => acc + a.minutos_solicitados, 0)

    const saldoColor =
        bolsaSaldo > 0 ? 'text-emerald-600' : bolsaSaldo < 0 ? 'text-red-600' : 'text-slate-500'
    const SaldoIcon = bolsaSaldo > 0 ? TrendingUp : bolsaSaldo < 0 ? TrendingDown : Minus

    // Cumplimiento dominical
    const MINUTOS_PACTADOS = 44 * 60
    const cumplimiento = semanaDominical?.total_minutos_cumplimiento ?? 0
    const porcentajeCumplimiento = Math.min(100, Math.round((cumplimiento / MINUTOS_PACTADOS) * 100))

    return (
        <div className="space-y-6">
            {/* ───── Toolbar ───── */}
            <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2">
                    <ArrowLeft className="h-4 w-4" /> Volver
                </Button>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navegarMes(-1)}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium text-slate-700 min-w-[140px] text-center">
                        {nombreMes(mesRango.inicio)}
                    </span>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navegarMes(1)} disabled={esHoy}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* ───── Header del empleado ───── */}
            <HeaderEmpleado empleado={empleado} configOperacion={configOperacion} />

            {/* ───── Banner de alertas ───── */}
            {alertas.length > 0 && <BannerAlertas alertas={alertas} />}

            {/* ───── KPIs ───── */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                    titulo="Bolsa de horas"
                    valor={fmtMinutos(bolsaSaldo, { conSigno: true })}
                    subtitulo={
                        bolsaSaldo > 0
                            ? 'Saldo a favor del empleado'
                            : bolsaSaldo < 0
                                ? 'Deuda pendiente'
                                : 'Saldo en cero'
                    }
                    Icon={Wallet}
                    valorClass={saldoColor}
                    tendenciaIcon={SaldoIcon}
                />
                <KpiCard
                    titulo="Horas del mes"
                    valor={horasMes?.horasTotalesFormato ?? '0:00'}
                    subtitulo={`${horasMes?.totalMinutos ?? 0} minutos efectivos`}
                    Icon={Clock}
                />
                <KpiCard
                    titulo="Valor del mes"
                    valor={fmtCOP(horasMes?.valorTotal ?? 0)}
                    subtitulo="Bruto, sin aprobar extras"
                    Icon={DollarSign}
                    valorClass="text-emerald-600"
                />
                <KpiCard
                    titulo="Jornadas del mes"
                    valor={String(jornadasMes.length)}
                    subtitulo={
                        jornadasInconsistentes > 0
                            ? `${jornadasInconsistentes} sin salida, por validar`
                            : 'Todas correctas'
                    }
                    Icon={Calendar}
                    valorClass={jornadasInconsistentes > 0 ? 'text-red-600' : 'text-slate-800'}
                />
            </div>

            {/* ───── Cumplimiento semanal (44h) ───── */}
            {semanaDominical && (
                <CumplimientoDominical
                    semana={semanaDominical}
                    porcentaje={porcentajeCumplimiento}
                    minutosPactados={MINUTOS_PACTADOS}
                />
            )}

            {/* ───── Resumen del mes por tipo de hora ───── */}
            {horasMes && <DesgloseMensual horasMes={horasMes} />}

            {/* ───── Tabs con detalle ───── */}
            <Tabs defaultValue="jornadas" className="w-full">
                <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full">
                    <TabsTrigger value="jornadas">
                        Asistencia día a día
                    </TabsTrigger>
                    <TabsTrigger value="bolsa">
                        Bolsa ({movimientosBolsa.length})
                    </TabsTrigger>
                    <TabsTrigger value="aprobaciones">
                        Aprobaciones{aprobacionesPendientes > 0 ? ` (${aprobacionesPendientes})` : ''}
                    </TabsTrigger>
                    <TabsTrigger value="novedades">
                        Novedades ({novedades.length})
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="jornadas" className="mt-4">
                    <HistoricoQuincena dias={dias} diasRango={diasRango} correcciones={correcciones} />
                </TabsContent>

                <TabsContent value="bolsa" className="mt-4">
                    <BolsaTab movimientos={movimientosBolsa} saldoActual={bolsaSaldo} />
                </TabsContent>

                <TabsContent value="aprobaciones" className="mt-4">
                    <AprobacionesTab
                        aprobaciones={aprobaciones}
                        minutosPendientes={minutosExtrasPendientes}
                    />
                </TabsContent>

                <TabsContent value="novedades" className="mt-4">
                    <NovedadesTab novedades={novedades} />
                </TabsContent>
            </Tabs>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════════════════
// HEADER
// ═══════════════════════════════════════════════════════════════════════

function HeaderEmpleado({
    empleado,
    configOperacion,
}: {
    empleado: Props['empleado']
    configOperacion: Props['configOperacion']
}) {
    return (
        <Card>
            <CardContent className="pt-6">
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                    <Avatar className="h-20 w-20 shrink-0">
                        <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xl font-semibold">
                            {iniciales(empleado.nombre)}
                        </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                        <h1 className="text-2xl font-bold text-slate-900 truncate">{empleado.nombre}</h1>
                        <p className="text-sm text-slate-500 font-mono">CC {empleado.id}</p>
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-sm">
                            {empleado.operacion && (
                                <span className="inline-flex items-center gap-1 text-slate-700">
                                    <Briefcase className="h-3.5 w-3.5" /> {empleado.operacion}
                                </span>
                            )}
                            {empleado.cargo && (
                                <span className="inline-flex items-center gap-1 text-slate-700">
                                    <User className="h-3.5 w-3.5" /> {empleado.cargo}
                                </span>
                            )}
                            <Badge
                                className={
                                    empleado.status === 'activo'
                                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
                                        : 'bg-slate-200 text-slate-600'
                                }
                            >
                                {empleado.status}
                            </Badge>
                        </div>
                    </div>

                    {configOperacion && (
                        <div className="border-l-0 md:border-l md:pl-4 text-xs text-slate-500 space-y-1">
                            <div className="flex items-center gap-1">
                                <Target className="h-3 w-3" />
                                <span>Límite diario: <b>{configOperacion.limite_horas}h</b></span>
                            </div>
                            {configOperacion.minutos_almuerzo > 0 && (
                                <div className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    <span>Almuerzo: <b>{configOperacion.minutos_almuerzo}min</b></span>
                                </div>
                            )}
                            {configOperacion.turnos.length > 0 && (
                                <div className="flex items-center gap-1">
                                    <Sun className="h-3 w-3" />
                                    <span>{configOperacion.turnos.length} turno(s) disponibles</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}

// ═══════════════════════════════════════════════════════════════════════
// BANNER ALERTAS
// ═══════════════════════════════════════════════════════════════════════

function BannerAlertas({ alertas }: { alertas: Alerta[] }) {
    const grupos = useMemo(() => {
        const g = new Map<TipoAlerta, Alerta[]>()
        for (const a of alertas) {
            if (!g.has(a.tipo)) g.set(a.tipo, [])
            g.get(a.tipo)!.push(a)
        }
        return g
    }, [alertas])

    return (
        <div className="space-y-2.5">
            {Array.from(grupos.entries()).map(([tipo, items]) => {
                const cfg = ALERTA_CFG[tipo]
                return (
                    <div
                        key={tipo}
                        className={`border rounded-xl p-4 md:p-5 flex items-start gap-4 ${cfg.cls}`}
                    >
                        <div className="shrink-0 rounded-lg bg-white/70 p-2">
                            <cfg.Icon className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0 space-y-3">
                            <p className="font-semibold text-sm leading-tight">
                                {cfg.label}
                                <span className="ml-2 text-xs font-normal opacity-75">
                                    · {items.length} por resolver
                                </span>
                            </p>
                            {/* Cada alerta se resuelve aquí mismo, con motivo obligatorio */}
                            {items.map((a) => (
                                <AlertaAccionable key={a.id} alerta={a} />
                            ))}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

function AlertaAccionable({ alerta }: { alerta: Alerta }) {
    const [abierta, setAbierta] = useState(false)

    const fechaJornada = alerta.jornada?.entrada ? fechaCortaColombia(alerta.jornada.entrada) : null
    const puedeCorregir = alerta.tipo === 'INCONSISTENTE' && !!alerta.jornada && !!alerta.jornada_id
    const puedeResolverExtras = alerta.tipo === 'EXTRAS_PENDIENTES' && !!alerta.aprobacionId
    const textoBoton =
        alerta.tipo === 'INCONSISTENTE'
            ? 'Finalizar turno'
            : alerta.tipo === 'EXTRAS_PENDIENTES'
                ? 'Aprobar o rechazar'
                : 'Marcar revisada'

    return (
        <div className="rounded-lg bg-white/70 border border-white p-3 space-y-2 text-slate-800">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-xs leading-relaxed">
                    {fechaJornada && <b>Jornada del {fechaJornada}. </b>}
                    {alerta.mensaje ?? 'Revisar con el coordinador.'}
                </p>
                {!abierta && (
                    <Button size="sm" variant="outline" className="h-7 text-xs bg-white shrink-0" onClick={() => setAbierta(true)}>
                        {textoBoton}
                    </Button>
                )}
            </div>
            {abierta && (
                <div className="space-y-2">
                    {puedeCorregir && (
                        <CorregirJornada
                            jornadaId={alerta.jornada_id!}
                            entrada={alerta.jornada!.entrada}
                            onListo={() => setAbierta(false)}
                        />
                    )}
                    {puedeResolverExtras && (
                        <ResolverExtras aprobacionId={alerta.aprobacionId!} onListo={() => setAbierta(false)} />
                    )}
                    {!puedeCorregir && !puedeResolverExtras && (
                        <RevisarAlerta alertaId={alerta.id} onListo={() => setAbierta(false)} />
                    )}
                    <button className="text-xs text-slate-500 underline" onClick={() => setAbierta(false)}>
                        Cancelar
                    </button>
                </div>
            )}
        </div>
    )
}

// ═══════════════════════════════════════════════════════════════════════
// KPI CARD
// ═══════════════════════════════════════════════════════════════════════

function KpiCard({
    titulo,
    valor,
    subtitulo,
    Icon,
    valorClass,
    tendenciaIcon: TendenciaIcon,
}: {
    titulo: string
    valor: string
    subtitulo: string
    Icon: typeof Clock
    valorClass?: string
    tendenciaIcon?: typeof TrendingUp
}) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-slate-500 flex items-center gap-2 uppercase tracking-wide">
                    <Icon className="h-3.5 w-3.5" />
                    {titulo}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex items-baseline gap-2">
                    {TendenciaIcon && <TendenciaIcon className={`h-4 w-4 ${valorClass ?? ''}`} />}
                    <span className={`text-2xl font-bold ${valorClass ?? 'text-slate-800'}`}>
                        {valor}
                    </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">{subtitulo}</p>
            </CardContent>
        </Card>
    )
}

// ═══════════════════════════════════════════════════════════════════════
// CUMPLIMIENTO DOMINICAL (44h)
// ═══════════════════════════════════════════════════════════════════════

function CumplimientoDominical({
    semana,
    porcentaje,
    minutosPactados,
}: {
    semana: SemanaDominical
    porcentaje: number
    minutosPactados: number
}) {
    const trabajadas = semana.minutos_ordinarios
    const novedades = semana.minutos_novedades_remuneradas
    const total = semana.total_minutos_cumplimiento
    const faltantes = Math.max(0, minutosPactados - total)

    const pctTrabajadas = Math.min(100, (trabajadas / minutosPactados) * 100)
    const pctNovedades = Math.min(100 - pctTrabajadas, (novedades / minutosPactados) * 100)

    return (
        <Card className="border-l-4 border-l-blue-500">
            <CardHeader className="pb-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Target className="h-4 w-4 text-blue-600 shrink-0" />
                            Cumplimiento semanal (Ley 44h)
                        </CardTitle>
                        <p className="text-xs text-slate-500 mt-1">
                            Semana del {fechaSoloFecha(semana.semana_inicio)} al {fechaSoloFecha(semana.semana_fin)}
                        </p>
                    </div>
                    {semana.paga_domingo === true && (
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 gap-1 px-3 py-1">
                            <CheckCircle2 className="h-3 w-3" /> Paga domingo
                        </Badge>
                    )}
                    {semana.paga_domingo === false && (
                        <Badge className="bg-red-100 text-red-700 hover:bg-red-100 gap-1 px-3 py-1">
                            <XCircle className="h-3 w-3" /> No paga domingo
                        </Badge>
                    )}
                </div>
            </CardHeader>

            <CardContent className="space-y-5">
                {/* Barra de progreso segmentada con porcentaje encima */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-600">Progreso a 44h pactadas</span>
                        <span className="font-semibold text-slate-800 tabular-nums">{porcentaje}%</span>
                    </div>
                    <div className="h-3 rounded-full bg-slate-100 overflow-hidden flex">
                        <div
                            className="h-full bg-blue-500 transition-all"
                            style={{ width: `${pctTrabajadas}%` }}
                            title="Horas trabajadas"
                        />
                        <div
                            className="h-full bg-emerald-500 transition-all"
                            style={{ width: `${pctNovedades}%` }}
                            title="Novedades remuneradas"
                        />
                    </div>
                </div>

                {/* Desglose */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <Metric label="Trabajadas" valor={fmtMinutos(trabajadas)} color="bg-blue-500" />
                    <Metric label="Novedades" valor={fmtMinutos(novedades)} color="bg-emerald-500" />
                    <Metric label="Total" valor={fmtMinutos(total)} color="bg-slate-700" strong />
                    <Metric
                        label={faltantes > 0 ? 'Faltantes' : 'Excedente'}
                        valor={fmtMinutos(faltantes > 0 ? faltantes : total - minutosPactados)}
                        color={faltantes > 0 ? 'bg-red-500' : 'bg-emerald-600'}
                    />
                </div>
            </CardContent>
        </Card>
    )
}

function Metric({
    label,
    valor,
    color,
    strong,
}: {
    label: string
    valor: string
    color: string
    strong?: boolean
}) {
    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
                <span>{label}</span>
            </div>
            <p className={`font-mono tabular-nums text-sm ${strong ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
                {valor}
            </p>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════════════════
// DESGLOSE MENSUAL (9 tipos de hora)
// ═══════════════════════════════════════════════════════════════════════

function DesgloseMensual({ horasMes }: { horasMes: ResumenEmpleadoPeriodo }) {
    const rows = DESGLOSE_TIPOS.map((t) => {
        const minutos = (horasMes.detalleMinutos as any)[t.key] ?? 0
        const horas = horasMes.horasFormato[t.key as keyof typeof horasMes.horasFormato]
        const valor = (horasMes.detalleValores as Record<string, number>)[
            t.concepto === 'extra' ? 'extrasOrdinarias' :
            t.concepto === 'extraNocturno' ? 'extrasNocturnas' :
            t.concepto === 'nocturno' ? 'nocturnas' :
            t.concepto === 'domingo' ? 'domingos' :
            t.concepto === 'festivo' ? 'festivos' :
            t.concepto === 'domingoFestivoNocturno' ? 'domingosFestivosNocturnos' :
            t.concepto === 'extraDominicalFestivo' ? 'extrasDominicalFestivo' :
            t.concepto === 'extraNocturnaDominicalFestivo' ? 'extrasNocturnaDominicalFestivo' :
            'normal'
        ] ?? 0
        return { ...t, minutos, horas, valor }
    }).filter((r) => r.minutos > 0)

    if (rows.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Desglose de horas del mes</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-slate-500">Aún no hay jornadas cerradas este mes.</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base">Desglose por tipo de hora</CardTitle>
                <p className="text-xs text-slate-500">
                    Solo se muestran los tipos con horas registradas este mes.
                </p>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {rows.map((r) => (
                        <div
                            key={r.key}
                            className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-slate-50/70 hover:bg-slate-100/60 transition-colors"
                        >
                            <span className={`inline-flex items-center px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide rounded-md ${r.color} shrink-0`}>
                                {r.label}
                            </span>
                            <div className="flex items-center gap-4 shrink-0">
                                <span className="font-mono tabular-nums text-sm text-slate-800 min-w-[56px] text-right">
                                    {r.horas}
                                </span>
                                <span className="font-mono tabular-nums text-xs text-emerald-600 min-w-[95px] text-right">
                                    {fmtCOP(r.valor)}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: ASISTENCIA DÍA A DÍA (histórico por quincena)
// ═══════════════════════════════════════════════════════════════════════

type FiltroPeriodo = 'q1' | 'q2' | 'mes'

function HistoricoQuincena({
    dias,
    diasRango,
    correcciones,
}: {
    dias: FilaAsistencia[]
    diasRango: { inicio: string; fin: string }
    correcciones: Correccion[]
}) {
    // Por defecto: la quincena en curso si se está viendo el mes actual; si no, la primera.
    const hoy = hoyColombiaISO()
    const esMesActual = hoy >= diasRango.inicio && hoy <= diasRango.fin
    const [periodo, setPeriodo] = useState<FiltroPeriodo>(
        esMesActual && quincenaDeFecha(hoy).numero === 2 ? 'q2' : 'q1',
    )

    const prefijoMes = diasRango.inicio.slice(0, 8) // "YYYY-MM-"
    const corte = `${prefijoMes}15`
    const visibles = useMemo(
        () =>
            dias.filter((f) =>
                periodo === 'mes' ? true : periodo === 'q1' ? f.fecha <= corte : f.fecha > corte,
            ),
        [dias, periodo, corte],
    )

    const resumen = useMemo(() => {
        let trabajados = 0, sinAsistencia = 0, novedades = 0, retardos = 0, minutosRetardo = 0, porValidar = 0
        const fechasTrabajadas = new Set<string>()
        for (const f of visibles) {
            if (f.jornada) fechasTrabajadas.add(f.fecha)
            if (f.inasistencia) sinAsistencia++
            if (f.estado === 'NOVEDAD') novedades++
            if (f.estado === 'CIERRE_AUTOMATICO') porValidar++
            if (f.retardoMin && f.retardoMin > 0) { retardos++; minutosRetardo += f.retardoMin }
        }
        trabajados = fechasTrabajadas.size
        return { trabajados, sinAsistencia, novedades, retardos, minutosRetardo, porValidar }
    }, [visibles])

    const opciones: { valor: FiltroPeriodo; texto: string }[] = [
        { valor: 'q1', texto: '1ª quincena (1 al 15)' },
        { valor: 'q2', texto: `2ª quincena (16 al ${Number(diasRango.fin.slice(8))})` },
        { valor: 'mes', texto: 'Mes completo' },
    ]

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <CardTitle className="text-base">Asistencia día a día</CardTitle>
                        <div className="inline-flex rounded-lg border bg-slate-50 p-0.5">
                            {opciones.map((o) => (
                                <button
                                    key={o.valor}
                                    onClick={() => setPeriodo(o.valor)}
                                    className={`px-3 py-1.5 text-xs rounded-md transition ${
                                        periodo === o.valor
                                            ? 'bg-white shadow-sm font-semibold text-slate-900'
                                            : 'text-slate-600 hover:text-slate-900'
                                    }`}
                                >
                                    {o.texto}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2 text-xs">
                        <Chip texto={`${resumen.trabajados} día(s) con marcación`} cls="bg-emerald-50 text-emerald-700 border-emerald-200" />
                        <Chip texto={`${resumen.sinAsistencia} sin asistencia`} cls={resumen.sinAsistencia > 0 ? 'bg-slate-200 text-slate-800 border-slate-300' : 'bg-slate-50 text-slate-500 border-slate-200'} />
                        <Chip texto={`${resumen.novedades} día(s) con novedad`} cls="bg-purple-50 text-purple-700 border-purple-200" />
                        <Chip
                            texto={`${resumen.retardos} retardo(s) · ${resumen.minutosRetardo} min`}
                            cls={resumen.retardos > 0 ? 'bg-orange-100 text-orange-800 border-orange-300' : 'bg-slate-50 text-slate-500 border-slate-200'}
                        />
                        {resumen.porValidar > 0 && (
                            <Chip texto={`${resumen.porValidar} sin salida, por validar`} cls="bg-red-100 text-red-700 border-red-300" />
                        )}
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <TablaAsistencia filas={visibles} modo="colaborador" />
                </CardContent>
            </Card>

            {correcciones.length > 0 && (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Correcciones registradas</CardTitle>
                        <p className="text-xs text-slate-500">Quién corrigió, cuándo y por qué.</p>
                    </CardHeader>
                    <CardContent>
                        <ul className="space-y-2 text-xs text-slate-700">
                            {correcciones.map((c) => (
                                <li key={c.id} className="border-l-2 border-slate-300 pl-3">{c.mensaje}</li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}

function Chip({ texto, cls }: { texto: string; cls: string }) {
    return <span className={`inline-flex px-2.5 py-1 rounded-full border font-medium ${cls}`}>{texto}</span>
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: BOLSA DE HORAS
// ═══════════════════════════════════════════════════════════════════════

function BolsaTab({
    movimientos,
    saldoActual,
}: {
    movimientos: Movimiento[]
    saldoActual: number
}) {
    if (movimientos.length === 0) {
        return (
            <EmptyState
                icon={<Wallet className="h-10 w-10 text-slate-300" />}
                titulo="Sin movimientos en la bolsa"
                subtitulo="Los excedentes, déficits y compensaciones aparecerán acá."
            />
        )
    }

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-base">Historial de bolsa</CardTitle>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Saldo actual: <span className="font-semibold font-mono">{fmtMinutos(saldoActual, { conSigno: true })}</span>
                        </p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Motivo</TableHead>
                                <TableHead>Cambio</TableHead>
                                <TableHead>Antes</TableHead>
                                <TableHead>Después</TableHead>
                                <TableHead>Nota</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {movimientos.map((m) => {
                                const cfg = MOTIVO_CFG[m.motivo]
                                const toneClass =
                                    cfg.tone === 'pos'
                                        ? 'text-emerald-600'
                                        : cfg.tone === 'neg'
                                            ? 'text-red-600'
                                            : 'text-slate-600'
                                return (
                                    <TableRow key={m.id}>
                                        <TableCell className="text-sm">
                                            {fechaCortaColombia(m.created_at)}
                                        </TableCell>
                                        <TableCell>
                                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                                                <cfg.Icon className="h-3 w-3" />
                                                {cfg.label}
                                            </span>
                                        </TableCell>
                                        <TableCell className={`font-mono font-semibold ${toneClass}`}>
                                            {fmtMinutos(m.minutos, { conSigno: true })}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs text-slate-500">
                                            {fmtMinutos(m.saldo_antes, { conSigno: true })}
                                        </TableCell>
                                        <TableCell className="font-mono text-sm font-semibold">
                                            {fmtMinutos(m.saldo_despues, { conSigno: true })}
                                        </TableCell>
                                        <TableCell className="text-xs text-slate-500 max-w-xs truncate">
                                            {m.nota ?? '—'}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    )
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: APROBACIONES
// ═══════════════════════════════════════════════════════════════════════

function AprobacionesTab({
    aprobaciones,
    minutosPendientes,
}: {
    aprobaciones: Aprobacion[]
    minutosPendientes: number
}) {
    if (aprobaciones.length === 0) {
        return (
            <EmptyState
                icon={<CheckCircle2 className="h-10 w-10 text-slate-300" />}
                titulo="Sin aprobaciones registradas"
                subtitulo="Cuando el empleado genere horas extra se crearán solicitudes de aprobación."
            />
        )
    }

    return (
        <div className="space-y-3">
            {minutosPendientes > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
                    <Clock className="h-4 w-4" />
                    <span>
                        <b>{fmtMinutos(minutosPendientes)}</b> de horas extra pendientes de aprobación del coordinador.
                    </span>
                </div>
            )}
            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Minutos</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead>Nota coordinador</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {aprobaciones.map((a) => {
                                const cfg = ESTADO_APROBACION_CFG[a.estado]
                                return (
                                    <TableRow key={a.id}>
                                        <TableCell className="text-sm">{fechaCortaColombia(a.created_at)}</TableCell>
                                        <TableCell className="font-mono font-semibold">
                                            {fmtMinutos(a.minutos_solicitados)}
                                        </TableCell>
                                        <TableCell>
                                            <span className={`text-xs px-2 py-0.5 rounded border ${cfg.cls}`}>
                                                {cfg.label}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-xs text-slate-600 max-w-xs truncate">
                                            {a.nota_coordinador ?? '—'}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: NOVEDADES
// ═══════════════════════════════════════════════════════════════════════

function NovedadesTab({ novedades }: { novedades: Novedad[] }) {
    if (novedades.length === 0) {
        return (
            <EmptyState
                icon={<FileText className="h-10 w-10 text-slate-300" />}
                titulo="Sin novedades registradas"
                subtitulo="Acá verás incapacidades, licencias, compensaciones y demás registros del coordinador."
            />
        )
    }

    return (
        <Card>
            <CardContent className="p-0">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Rango</TableHead>
                            <TableHead>Pago</TableHead>
                            <TableHead>Valor</TableHead>
                            <TableHead>Descripción</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {novedades.map((n) => (
                            <TableRow key={n.id}>
                                <TableCell>
                                    <Badge variant="secondary" className="text-[10px] uppercase">
                                        {n.tipo_novedad.replace(/_/g, ' ')}
                                    </Badge>
                                    {n.codigo_causa && (
                                        <div className="text-[10px] text-slate-500 mt-1">EPS: {n.codigo_causa}</div>
                                    )}
                                </TableCell>
                                <TableCell className="text-sm">{fechaSoloFecha(n.fecha_novedad)}</TableCell>
                                <TableCell className="text-xs">
                                    {n.fecha_inicio && n.fecha_fin
                                        ? `${fechaSoloFecha(n.fecha_inicio)} → ${fechaSoloFecha(n.fecha_fin)}`
                                        : '—'}
                                </TableCell>
                                <TableCell>
                                    {n.es_pagado ? (
                                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 gap-1">
                                            <CheckCircle2 className="h-3 w-3" /> Sí
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline" className="text-slate-500">
                                            No
                                        </Badge>
                                    )}
                                </TableCell>
                                <TableCell className="font-mono text-xs text-emerald-700">
                                    {n.valor_monetario ? fmtCOP(Number(n.valor_monetario)) : '—'}
                                </TableCell>
                                <TableCell className="text-xs text-slate-600 max-w-xs truncate">
                                    {n.descripcion ?? '—'}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    )
}

// ═══════════════════════════════════════════════════════════════════════
// EMPTY STATE
// ═══════════════════════════════════════════════════════════════════════

function EmptyState({
    icon,
    titulo,
    subtitulo,
}: {
    icon: React.ReactNode
    titulo: string
    subtitulo: string
}) {
    return (
        <Card>
            <CardContent className="py-12 flex flex-col items-center text-center gap-2">
                {icon}
                <h3 className="font-semibold text-slate-700">{titulo}</h3>
                <p className="text-xs text-slate-500 max-w-sm">{subtitulo}</p>
            </CardContent>
        </Card>
    )
}
