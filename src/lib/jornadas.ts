import { createClient } from '@/lib/supabase/server'
import {
    calcularPeriodosHorasOptimizado,
    obtenerFestivosParaRango,
    redondearMediaHora,
    toColombiaTime,
    type PeriodosHoras,
} from '@/lib/calculoHoras'
import {
    UMBRAL_CIERRE_AUTOMATICO_HORAS,
    horaColombia24,
    fechaColombiaISO,
} from '@/lib/asistencia'

// ==================================================
// TIPOS
// ==================================================

export type EstadoJornada = 'ABIERTO' | 'CERRADO' | 'CERRADO_MANUAL' | 'INCONSISTENTE'
export type EstadoAprobacion = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA'
export type TipoAlerta = 'INCONSISTENTE' | 'ALERTA_CRITICA' | 'EXTRAS_PENDIENTES'
export type TipoMovimiento =
    | 'ABONO_EXCEDENTE'
    | 'CARGO_DEFICIT'
    | 'NOVEDAD_COMPENSA'
    | 'AJUSTE_MANUAL'

export interface Jornada {
    id: string
    empleado_id: string
    operacion: string
    entrada: string
    salida: string | null
    estado: EstadoJornada
    minutos_normales: number
    minutos_nocturnas: number
    minutos_domingos: number
    minutos_festivos: number
    minutos_domingos_festivos_nocturnos: number
    minutos_extras_ordinarias: number
    minutos_extras_nocturnas: number
    minutos_extras_dominical_festivo: number
    minutos_extras_nocturna_dominical_festivo: number
    minutos_total: number
    minutos_almuerzo_descontados: number
    cerrada_por: 'empleado' | 'coordinador' | 'cron' | null
    hora_salida_manual: string | null
    alerta_critica: boolean
    created_at: string
    updated_at: string
}

export interface SnapshotMinutos {
    minutos_normales: number
    minutos_nocturnas: number
    minutos_domingos: number
    minutos_festivos: number
    minutos_domingos_festivos_nocturnos: number
    minutos_extras_ordinarias: number
    minutos_extras_nocturnas: number
    minutos_extras_dominical_festivo: number
    minutos_extras_nocturna_dominical_festivo: number
    minutos_total: number
    minutos_almuerzo_descontados: number
}

type Resultado<T> = { data: T | null; error: string | null }

/** Inicio del mensaje con que se guardan las correcciones (sirve para listarlas después). */
export const PREFIJO_CORRECCION = 'Corrección'

// ==================================================
// HELPERS
// ==================================================

function periodosASnapshot(p: PeriodosHoras, minutosAlmuerzoDescontados: number): SnapshotMinutos {
    const minutos_normales = redondearMediaHora(p.minutosNormales)
    const minutos_nocturnas = redondearMediaHora(p.minutosNocturnas)
    const minutos_domingos = redondearMediaHora(p.minutosDomingos)
    const minutos_festivos = redondearMediaHora(p.minutosFestivos)
    const minutos_domingos_festivos_nocturnos = redondearMediaHora(p.minutosDomingosFestivosNocturnos)
    const minutos_extras_ordinarias = redondearMediaHora(p.minutosExtrasOrdinarias)
    const minutos_extras_nocturnas = redondearMediaHora(p.minutosExtrasNocturnas)
    const minutos_extras_dominical_festivo = redondearMediaHora(p.minutosExtrasDominicalFestivo)
    const minutos_extras_nocturna_dominical_festivo = redondearMediaHora(p.minutosExtrasNocturnaDominicalFestivo)

    return {
        minutos_normales,
        minutos_nocturnas,
        minutos_domingos,
        minutos_festivos,
        minutos_domingos_festivos_nocturnos,
        minutos_extras_ordinarias,
        minutos_extras_nocturnas,
        minutos_extras_dominical_festivo,
        minutos_extras_nocturna_dominical_festivo,
        minutos_total:
            minutos_normales +
            minutos_nocturnas +
            minutos_domingos +
            minutos_festivos +
            minutos_domingos_festivos_nocturnos +
            minutos_extras_ordinarias +
            minutos_extras_nocturnas +
            minutos_extras_dominical_festivo +
            minutos_extras_nocturna_dominical_festivo,
        minutos_almuerzo_descontados: minutosAlmuerzoDescontados,
    }
}

/**
 * Calcula el snapshot de minutos efectivos trabajados entre entrada y salida,
 * aplicando descuento de almuerzo si corresponde. Input en UTC (Date original).
 */
async function calcularSnapshot(
    entradaUTC: Date,
    salidaUTC: Date,
    minutosAlmuerzoConfig: number,
): Promise<SnapshotMinutos> {
    const minutosBrutos = Math.floor((salidaUTC.getTime() - entradaUTC.getTime()) / 60000)

    // Descuento de almuerzo: solo si config > 0 Y jornada > 5h
    const aplicaAlmuerzo = minutosAlmuerzoConfig > 0 && minutosBrutos > 300
    const minutosAlmuerzoDescontados = aplicaAlmuerzo ? minutosAlmuerzoConfig : 0

    // Salida efectiva para el motor (se corta la "cola" correspondiente al almuerzo).
    // Con este criterio se clasifican correctamente las últimas horas del turno:
    // si el almuerzo se tomó "al final" o distribuido, el efecto neto es el mismo en total.
    const salidaEfectivaUTC = aplicaAlmuerzo
        ? new Date(salidaUTC.getTime() - minutosAlmuerzoConfig * 60000)
        : salidaUTC

    // Una sola conversión a Colombia — el motor espera fechas "Bogotá falsas"
    const entradaBog = toColombiaTime(entradaUTC)
    const salidaBog = toColombiaTime(salidaEfectivaUTC)

    const festivos = await obtenerFestivosParaRango(entradaUTC, salidaEfectivaUTC)
    const periodos = calcularPeriodosHorasOptimizado(entradaBog, salidaBog, festivos, 0)

    return periodosASnapshot(periodos, minutosAlmuerzoDescontados)
}

async function obtenerConfigOperacion(
    supabase: Awaited<ReturnType<typeof createClient>>,
    nombre: string,
): Promise<{ limite_horas: number; minutos_almuerzo: number }> {
    const { data } = await supabase
        .from('operaciones')
        .select('limite_horas, minutos_almuerzo')
        .eq('nombre', nombre)
        .maybeSingle()
    return {
        limite_horas: data?.limite_horas ?? 8,
        minutos_almuerzo: data?.minutos_almuerzo ?? 0,
    }
}

async function obtenerSaldoBolsa(
    supabase: Awaited<ReturnType<typeof createClient>>,
    empleadoId: string,
): Promise<number> {
    const { data } = await supabase
        .from('bolsa_horas')
        .select('saldo_minutos')
        .eq('empleado_id', empleadoId)
        .maybeSingle()
    return data?.saldo_minutos ?? 0
}

async function registrarMovimientoBolsa(
    supabase: Awaited<ReturnType<typeof createClient>>,
    params: {
        empleadoId: string
        minutos: number
        motivo: TipoMovimiento
        saldoAntes: number
        saldoDespues: number
        jornadaId?: string
        novedadId?: string
        nota?: string
    },
): Promise<void> {
    const ahora = new Date().toISOString()

    // upsert bolsa_horas
    const { data: bolsa } = await supabase
        .from('bolsa_horas')
        .select('empleado_id')
        .eq('empleado_id', params.empleadoId)
        .maybeSingle()

    if (bolsa) {
        await supabase
            .from('bolsa_horas')
            .update({ saldo_minutos: params.saldoDespues, updated_at: ahora })
            .eq('empleado_id', params.empleadoId)
    } else {
        await supabase
            .from('bolsa_horas')
            .insert({ empleado_id: params.empleadoId, saldo_minutos: params.saldoDespues })
    }

    await supabase.from('movimientos_bolsa').insert({
        empleado_id: params.empleadoId,
        jornada_id: params.jornadaId ?? null,
        novedad_id: params.novedadId ?? null,
        minutos: params.minutos,
        motivo: params.motivo,
        saldo_antes: params.saldoAntes,
        saldo_despues: params.saldoDespues,
        nota: params.nota ?? null,
    })
}

/**
 * ¿Existe una novedad remunerada que cubra la fecha de la jornada?
 * fechaJornada en formato YYYY-MM-DD (hora Colombia).
 */
async function hayNovedadRemuneradaParaFecha(
    supabase: Awaited<ReturnType<typeof createClient>>,
    empleadoId: string,
    fechaJornada: string,
): Promise<boolean> {
    const { data: puntual } = await supabase
        .from('novedades')
        .select('id')
        .eq('usuario_id', empleadoId)
        .eq('es_pagado', true)
        .eq('fecha_novedad', fechaJornada)
        .maybeSingle()
    if (puntual) return true

    const { data: rango } = await supabase
        .from('novedades')
        .select('id')
        .eq('usuario_id', empleadoId)
        .eq('es_pagado', true)
        .lte('fecha_inicio', fechaJornada)
        .gte('fecha_fin', fechaJornada)
        .maybeSingle()
    return !!rango
}

function fechaColombiaYYYYMMDD(fechaUTC: Date): string {
    const col = toColombiaTime(fechaUTC)
    return `${col.getUTCFullYear()}-${String(col.getUTCMonth() + 1).padStart(2, '0')}-${String(col.getUTCDate()).padStart(2, '0')}`
}

// ==================================================
// API PÚBLICA
// ==================================================

/**
 * Crea una nueva jornada en estado ABIERTO. Falla si el empleado ya tiene
 * una jornada abierta (garantizado también por unique index parcial en DB).
 */
export async function abrirJornada(
    cedula: string,
    operacion: string,
): Promise<Resultado<Jornada>> {
    const supabase = await createClient()

    const { data: activa } = await supabase
        .from('jornadas')
        .select('id')
        .eq('empleado_id', cedula)
        .eq('estado', 'ABIERTO')
        .maybeSingle()
    if (activa) return { data: null, error: 'Ya existe una jornada activa para este empleado.' }

    const { data, error } = await supabase
        .from('jornadas')
        .insert({
            empleado_id: cedula,
            operacion,
            entrada: new Date().toISOString(),
            estado: 'ABIERTO',
        })
        .select('*')
        .single()

    if (error) return { data: null, error: error.message }
    return { data: data as Jornada, error: null }
}

/**
 * Cierra la jornada ABIERTO del empleado, ejecuta el motor de liquidación,
 * actualiza bolsa y genera aprobaciones/alertas si corresponde.
 */
export async function cerrarJornada(
    cedula: string,
    salidaTimestamp?: Date,
): Promise<Resultado<Jornada>> {
    const supabase = await createClient()
    const salida = salidaTimestamp ?? new Date()

    const { data: jornada, error: errBuscar } = await supabase
        .from('jornadas')
        .select('*')
        .eq('empleado_id', cedula)
        .eq('estado', 'ABIERTO')
        .maybeSingle()
    if (errBuscar) return { data: null, error: errBuscar.message }
    if (!jornada) return { data: null, error: 'No existe jornada activa para este empleado.' }

    const config = await obtenerConfigOperacion(supabase, jornada.operacion)
    const entrada = new Date(jornada.entrada)
    const snapshot = await calcularSnapshot(entrada, salida, config.minutos_almuerzo)

    const jornadaActualizada = await liquidarJornada(supabase, {
        jornada,
        snapshot,
        salida,
        limiteHoras: config.limite_horas,
        cerradaPor: 'empleado',
        estadoFinal: 'CERRADO',
    })

    return { data: jornadaActualizada, error: null }
}

/**
 * Marca una jornada abierta como cierre automático (estado INCONSISTENTE en BD)
 * y genera la alerta para el coordinador. La entrada no se modifica y las horas
 * no se liquidan hasta que alguien autorizado registre la salida real.
 */
export async function marcarCierreAutomatico(
    jornada: Pick<Jornada, 'id' | 'empleado_id' | 'operacion'>,
): Promise<void> {
    const supabase = await createClient()
    const { data: actualizada } = await supabase
        .from('jornadas')
        .update({ estado: 'INCONSISTENTE' })
        .eq('id', jornada.id)
        .eq('estado', 'ABIERTO')
        .select('id')
    // Si otro proceso ya la marcó, no duplicamos la alerta
    if (!actualizada || actualizada.length === 0) return

    await supabase.from('alertas').insert({
        tipo: 'INCONSISTENTE',
        empleado_id: jornada.empleado_id,
        jornada_id: jornada.id,
        operacion: jornada.operacion,
        mensaje: `Cierre automático: jornada abierta por más de ${UMBRAL_CIERRE_AUTOMATICO_HORAS}h sin salida registrada.`,
    })
}

/** Última salida registrada del empleado (para detectar marcaciones repetidas). */
export async function obtenerUltimaSalida(cedula: string): Promise<Date | null> {
    const supabase = await createClient()
    const { data } = await supabase
        .from('jornadas')
        .select('salida')
        .eq('empleado_id', cedula)
        .not('salida', 'is', null)
        .order('salida', { ascending: false })
        .limit(1)
        .maybeSingle()
    return data?.salida ? new Date(data.salida) : null
}

/**
 * Corrección de una jornada sin salida (cierre automático o todavía abierta).
 * Quien corrige ingresa la hora de salida real y el motivo; el motor recalcula
 * y liquida como si hubiera cerrado normal. La entrada nunca se modifica.
 *
 * `traza` deja el registro de quién, cuándo y por qué en la tabla de alertas.
 */
export async function corregirJornadaInconsistente(
    jornadaId: string,
    horaSalidaReal: Date,
    traza?: { autor: string; motivo: string },
): Promise<Resultado<Jornada>> {
    const supabase = await createClient()

    const { data: jornada, error: errBuscar } = await supabase
        .from('jornadas')
        .select('*')
        .eq('id', jornadaId)
        .in('estado', ['INCONSISTENTE', 'ABIERTO'])
        .maybeSingle()
    if (errBuscar) return { data: null, error: errBuscar.message }
    if (!jornada) return { data: null, error: 'La jornada no existe o ya fue cerrada.' }

    const config = await obtenerConfigOperacion(supabase, jornada.operacion)
    const entrada = new Date(jornada.entrada)

    // Secuencia de horas: la salida debe ser posterior a la entrada y razonable
    const duracionMin = Math.floor((horaSalidaReal.getTime() - entrada.getTime()) / 60000)
    if (Number.isNaN(duracionMin) || duracionMin <= 0) {
        return { data: null, error: 'La salida debe ser posterior a la entrada.' }
    }
    if (duracionMin > 24 * 60) {
        return { data: null, error: 'La jornada no puede durar más de 24 horas. Revisa la hora de salida.' }
    }
    if (horaSalidaReal.getTime() > Date.now() + 60000) {
        return { data: null, error: 'La hora de salida no puede estar en el futuro.' }
    }
    const snapshot = await calcularSnapshot(entrada, horaSalidaReal, config.minutos_almuerzo)

    const jornadaActualizada = await liquidarJornada(supabase, {
        jornada,
        snapshot,
        salida: horaSalidaReal,
        limiteHoras: config.limite_horas,
        cerradaPor: 'coordinador',
        estadoFinal: 'CERRADO_MANUAL',
        horaSalidaManual: horaSalidaReal,
    })

    // Marcar alertas INCONSISTENTE de esta jornada como leídas
    await supabase
        .from('alertas')
        .update({ leida: true })
        .eq('jornada_id', jornadaId)
        .eq('tipo', 'INCONSISTENTE')

    // Trazabilidad: quién corrigió, cuándo, qué salida registró y por qué
    if (traza) {
        const ahora = new Date()
        await supabase.from('alertas').insert({
            tipo: 'INCONSISTENTE',
            empleado_id: jornada.empleado_id,
            jornada_id: jornadaId,
            operacion: jornada.operacion,
            leida: true,
            mensaje:
                `${PREFIJO_CORRECCION} por ${traza.autor} el ${fechaColombiaISO(ahora)} ${horaColombia24(ahora)}. ` +
                `Salida real registrada: ${fechaColombiaISO(horaSalidaReal)} ${horaColombia24(horaSalidaReal)}. ` +
                `Motivo: ${traza.motivo}`,
        })
    }

    return { data: jornadaActualizada, error: null }
}

// ==================================================
// MOTOR DE LIQUIDACIÓN (interno)
// ==================================================

interface LiquidarArgs {
    jornada: Jornada
    snapshot: SnapshotMinutos
    salida: Date
    limiteHoras: number
    cerradaPor: 'empleado' | 'coordinador' | 'cron'
    estadoFinal: EstadoJornada
    horaSalidaManual?: Date
}

async function liquidarJornada(
    supabase: Awaited<ReturnType<typeof createClient>>,
    args: LiquidarArgs,
): Promise<Jornada> {
    const limiteMinutos = args.limiteHoras * 60
    const minutosEfectivos = args.snapshot.minutos_total
    const excedente = Math.max(0, minutosEfectivos - limiteMinutos)
    const alertaCritica = minutosEfectivos > 12 * 60

    // 1. Actualizar la jornada con el snapshot
    const updatePayload: Record<string, unknown> = {
        ...args.snapshot,
        estado: args.estadoFinal,
        salida: args.salida.toISOString(),
        cerrada_por: args.cerradaPor,
        alerta_critica: alertaCritica,
    }
    if (args.horaSalidaManual) {
        updatePayload.hora_salida_manual = args.horaSalidaManual.toISOString()
    }

    const { data: jornadaActualizada, error: errUpdate } = await supabase
        .from('jornadas')
        .update(updatePayload)
        .eq('id', args.jornada.id)
        .select('*')
        .single()

    if (errUpdate) throw new Error(errUpdate.message)

    // 2. Alerta crítica si >12h
    if (alertaCritica) {
        await supabase.from('alertas').insert({
            tipo: 'ALERTA_CRITICA',
            empleado_id: args.jornada.empleado_id,
            jornada_id: args.jornada.id,
            operacion: args.jornada.operacion,
            mensaje: `La jornada superó 12h (${(minutosEfectivos / 60).toFixed(1)}h efectivas).`,
        })
    }

    // 3. Excedente → bolsa primero, resto a aprobación
    if (excedente > 0) {
        const saldoAntes = await obtenerSaldoBolsa(supabase, args.jornada.empleado_id)
        let extrasPendientes = excedente

        if (saldoAntes < 0) {
            const abono = Math.min(excedente, Math.abs(saldoAntes))
            const saldoDespues = saldoAntes + abono
            extrasPendientes = excedente - abono

            await registrarMovimientoBolsa(supabase, {
                empleadoId: args.jornada.empleado_id,
                minutos: abono,
                motivo: 'ABONO_EXCEDENTE',
                saldoAntes,
                saldoDespues,
                jornadaId: args.jornada.id,
                nota: 'Excedente de jornada abona deuda en bolsa.',
            })
        }

        if (extrasPendientes > 0) {
            await supabase.from('aprobaciones_extras').insert({
                jornada_id: args.jornada.id,
                empleado_id: args.jornada.empleado_id,
                minutos_solicitados: extrasPendientes,
                estado: 'PENDIENTE',
            })
            await supabase.from('alertas').insert({
                tipo: 'EXTRAS_PENDIENTES',
                empleado_id: args.jornada.empleado_id,
                jornada_id: args.jornada.id,
                operacion: args.jornada.operacion,
                mensaje: `${(extrasPendientes / 60).toFixed(1)}h extra pendientes de aprobación.`,
            })
        }
    } else if (minutosEfectivos < limiteMinutos) {
        // 4. Déficit — si no hay novedad remunerada que cubra, descuenta bolsa
        const fechaJornada = fechaColombiaYYYYMMDD(new Date(args.jornada.entrada))
        const cubierta = await hayNovedadRemuneradaParaFecha(
            supabase,
            args.jornada.empleado_id,
            fechaJornada,
        )

        if (!cubierta) {
            const deficit = limiteMinutos - minutosEfectivos
            const saldoAntes = await obtenerSaldoBolsa(supabase, args.jornada.empleado_id)
            const saldoDespues = saldoAntes - deficit

            await registrarMovimientoBolsa(supabase, {
                empleadoId: args.jornada.empleado_id,
                minutos: -deficit,
                motivo: 'CARGO_DEFICIT',
                saldoAntes,
                saldoDespues,
                jornadaId: args.jornada.id,
                nota: `Déficit de ${(deficit / 60).toFixed(1)}h sin novedad remunerada.`,
            })
        }
    }

    return jornadaActualizada as Jornada
}

// ==================================================
// CONSULTAS DE APOYO
// ==================================================

export async function obtenerJornadaActiva(cedula: string): Promise<Jornada | null> {
    const supabase = await createClient()
    const { data } = await supabase
        .from('jornadas')
        .select('*')
        .eq('empleado_id', cedula)
        .eq('estado', 'ABIERTO')
        .maybeSingle()
    return (data as Jornada) ?? null
}

export async function obtenerBolsaHoras(cedula: string): Promise<number> {
    const supabase = await createClient()
    const { data } = await supabase
        .from('bolsa_horas')
        .select('saldo_minutos')
        .eq('empleado_id', cedula)
        .maybeSingle()
    return data?.saldo_minutos ?? 0
}

export async function tieneJornadasInconsistentes(cedula: string): Promise<boolean> {
    const supabase = await createClient()
    const { count } = await supabase
        .from('jornadas')
        .select('id', { count: 'exact', head: true })
        .eq('empleado_id', cedula)
        .eq('estado', 'INCONSISTENTE')
    return (count ?? 0) > 0
}

export async function obtenerJornadasInconsistentes(operacion?: string): Promise<Jornada[]> {
    const supabase = await createClient()
    let query = supabase
        .from('jornadas')
        .select('*')
        .eq('estado', 'INCONSISTENTE')
        .order('entrada', { ascending: false })

    if (operacion) query = query.eq('operacion', operacion)
    const { data } = await query
    return (data ?? []) as Jornada[]
}

// ==================================================
// BOLSA POR NOVEDAD COMPENSA_TIEMPO
// ==================================================

/**
 * Descuenta minutos de la bolsa por una novedad COMPENSA_TIEMPO que el
 * coordinador registró. Usado desde el action de crear novedad.
 */
export async function registrarCompensaTiempo(args: {
    empleadoId: string
    minutos: number
    novedadId: string
    nota?: string
}): Promise<Resultado<{ saldo_minutos: number }>> {
    if (args.minutos <= 0) {
        return { data: null, error: 'Los minutos a compensar deben ser positivos.' }
    }
    const supabase = await createClient()
    const saldoAntes = await obtenerSaldoBolsa(supabase, args.empleadoId)
    const saldoDespues = saldoAntes - args.minutos

    await registrarMovimientoBolsa(supabase, {
        empleadoId: args.empleadoId,
        minutos: -args.minutos,
        motivo: 'NOVEDAD_COMPENSA',
        saldoAntes,
        saldoDespues,
        novedadId: args.novedadId,
        nota: args.nota ?? 'Compensación de tiempo registrada por coordinador.',
    })

    return { data: { saldo_minutos: saldoDespues }, error: null }
}
