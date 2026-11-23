import { createClient } from '@/lib/supabase/server'
import {
    calcularValorPorMinutos,
    horasAFormato,
    minutosAHoras,
    obtenerTarifas,
} from '@/lib/calculoHoras'

// ==================================================
// REPORTES AGREGADOS DESDE `jornadas`
// ==================================================
// El snapshot de cada jornada ya tiene los 9 tipos de minutos calculados
// al momento de cerrarla. Estas funciones agregan por empleado sin recalcular.
// ==================================================

export interface DetalleMinutos {
    normales: number
    nocturnas: number
    domingos: number
    festivos: number
    domingosFestivosNocturnos: number
    extrasOrdinarias: number
    extrasNocturnas: number
    extrasDominicalFestivo: number
    extrasNocturnaDominicalFestivo: number
}

export interface ResumenEmpleadoPeriodo {
    cedula: string
    nombre: string
    operacion: string
    periodo: { inicio: string; fin: string }
    totalMinutos: number
    horasTotales: number
    horasTotalesFormato: string
    detalleMinutos: DetalleMinutos
    horasFormato: Record<keyof DetalleMinutos, string>
    detalleValores: Record<string, number>
    valorTotal: number
}

type JornadaSnapshot = {
    empleado_id: string
    operacion: string
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
    usuario_nombre?: string
}

function acumuladorVacio(): DetalleMinutos {
    return {
        normales: 0,
        nocturnas: 0,
        domingos: 0,
        festivos: 0,
        domingosFestivosNocturnos: 0,
        extrasOrdinarias: 0,
        extrasNocturnas: 0,
        extrasDominicalFestivo: 0,
        extrasNocturnaDominicalFestivo: 0,
    }
}

function sumarJornada(acum: DetalleMinutos, j: JornadaSnapshot): DetalleMinutos {
    return {
        normales:                       acum.normales + j.minutos_normales,
        nocturnas:                      acum.nocturnas + j.minutos_nocturnas,
        domingos:                       acum.domingos + j.minutos_domingos,
        festivos:                       acum.festivos + j.minutos_festivos,
        domingosFestivosNocturnos:      acum.domingosFestivosNocturnos + j.minutos_domingos_festivos_nocturnos,
        extrasOrdinarias:               acum.extrasOrdinarias + j.minutos_extras_ordinarias,
        extrasNocturnas:                acum.extrasNocturnas + j.minutos_extras_nocturnas,
        extrasDominicalFestivo:         acum.extrasDominicalFestivo + j.minutos_extras_dominical_festivo,
        extrasNocturnaDominicalFestivo: acum.extrasNocturnaDominicalFestivo + j.minutos_extras_nocturna_dominical_festivo,
    }
}

function calcularValores(detalle: DetalleMinutos, tarifas: Record<string, number>) {
    const valores = {
        normal:                          calcularValorPorMinutos(detalle.normales, tarifas.normal),
        // La tarifa `nocturno` es SOLO el recargo (35 %, concepto R.N). Las horas nocturnas
        // ordinarias se valoran como hora ordinaria + recargo.
        nocturnas:                       calcularValorPorMinutos(detalle.nocturnas, (tarifas.normal ?? 0) + (tarifas.nocturno ?? 0)),
        extrasOrdinarias:                calcularValorPorMinutos(detalle.extrasOrdinarias, tarifas.extra),
        extrasNocturnas:                 calcularValorPorMinutos(detalle.extrasNocturnas, tarifas.extraNocturno),
        domingos:                        calcularValorPorMinutos(detalle.domingos, tarifas.domingo),
        festivos:                        calcularValorPorMinutos(detalle.festivos, tarifas.festivo),
        domingosFestivosNocturnos:       calcularValorPorMinutos(detalle.domingosFestivosNocturnos, tarifas.domingoFestivoNocturno),
        extrasDominicalFestivo:          calcularValorPorMinutos(detalle.extrasDominicalFestivo, tarifas.extraDominicalFestivo),
        extrasNocturnaDominicalFestivo:  calcularValorPorMinutos(detalle.extrasNocturnaDominicalFestivo, tarifas.extraNocturnaDominicalFestivo),
    }
    const total = Object.values(valores).reduce((a, b) => a + b, 0)
    return { valores, total: Math.round(total * 100) / 100 }
}

function toFormatoHoras(detalle: DetalleMinutos): Record<keyof DetalleMinutos, string> {
    return {
        normales:                       horasAFormato(minutosAHoras(detalle.normales)),
        nocturnas:                      horasAFormato(minutosAHoras(detalle.nocturnas)),
        domingos:                       horasAFormato(minutosAHoras(detalle.domingos)),
        festivos:                       horasAFormato(minutosAHoras(detalle.festivos)),
        domingosFestivosNocturnos:      horasAFormato(minutosAHoras(detalle.domingosFestivosNocturnos)),
        extrasOrdinarias:               horasAFormato(minutosAHoras(detalle.extrasOrdinarias)),
        extrasNocturnas:                horasAFormato(minutosAHoras(detalle.extrasNocturnas)),
        extrasDominicalFestivo:         horasAFormato(minutosAHoras(detalle.extrasDominicalFestivo)),
        extrasNocturnaDominicalFestivo: horasAFormato(minutosAHoras(detalle.extrasNocturnaDominicalFestivo)),
    }
}

function totalMinutos(d: DetalleMinutos): number {
    return (
        d.normales + d.nocturnas + d.domingos + d.festivos + d.domingosFestivosNocturnos +
        d.extrasOrdinarias + d.extrasNocturnas + d.extrasDominicalFestivo + d.extrasNocturnaDominicalFestivo
    )
}

/**
 * Resumen por empleado de un período — agrega sus jornadas CERRADO y CERRADO_MANUAL.
 */
export async function calcularHorasUsuarioEnPeriodo(
    cedula: string,
    fechaInicio: Date,
    fechaFin: Date,
): Promise<ResumenEmpleadoPeriodo | null> {
    const supabase = await createClient()

    const [{ data: usuario }, { data: jornadas }] = await Promise.all([
        supabase.from('usuarios').select('id, nombre, operacion').eq('id', cedula).maybeSingle(),
        supabase
            .from('jornadas')
            .select(
                'empleado_id, operacion, minutos_normales, minutos_nocturnas, minutos_domingos, minutos_festivos, minutos_domingos_festivos_nocturnos, minutos_extras_ordinarias, minutos_extras_nocturnas, minutos_extras_dominical_festivo, minutos_extras_nocturna_dominical_festivo, minutos_total',
            )
            .eq('empleado_id', cedula)
            .in('estado', ['CERRADO', 'CERRADO_MANUAL'])
            .gte('entrada', fechaInicio.toISOString())
            .lte('entrada', fechaFin.toISOString()),
    ])

    if (!usuario) return null

    const detalle = (jornadas ?? []).reduce<DetalleMinutos>(
        (acc, j) => sumarJornada(acc, j as JornadaSnapshot),
        acumuladorVacio(),
    )
    const total = totalMinutos(detalle)
    const tarifas = await obtenerTarifas()
    const { valores, total: valorTotal } = calcularValores(detalle, tarifas)

    return {
        cedula: usuario.id,
        nombre: usuario.nombre,
        operacion: usuario.operacion ?? '',
        periodo: { inicio: fechaInicio.toISOString(), fin: fechaFin.toISOString() },
        totalMinutos: total,
        horasTotales: minutosAHoras(total),
        horasTotalesFormato: horasAFormato(minutosAHoras(total)),
        detalleMinutos: detalle,
        horasFormato: toFormatoHoras(detalle),
        detalleValores: valores,
        valorTotal,
    }
}

/**
 * Resumen agregado de todos los empleados con jornadas cerradas en el período.
 * Filtra por array de operaciones si se provee.
 */
export async function calcularHorasTodosEnPeriodo(
    fechaInicio: Date,
    fechaFin: Date,
    operaciones: string[] = [],
): Promise<ResumenEmpleadoPeriodo[]> {
    const supabase = await createClient()

    let query = supabase
        .from('jornadas')
        .select(
            'empleado_id, operacion, minutos_normales, minutos_nocturnas, minutos_domingos, minutos_festivos, minutos_domingos_festivos_nocturnos, minutos_extras_ordinarias, minutos_extras_nocturnas, minutos_extras_dominical_festivo, minutos_extras_nocturna_dominical_festivo, minutos_total, usuarios!inner(id, nombre)',
        )
        .in('estado', ['CERRADO', 'CERRADO_MANUAL'])
        .gte('entrada', fechaInicio.toISOString())
        .lte('entrada', fechaFin.toISOString())

    if (operaciones.length > 0) query = query.in('operacion', operaciones)

    const { data, error } = await query
    if (error) {
        console.error('Error en calcularHorasTodosEnPeriodo:', error)
        return []
    }

    // Agrupar por empleado_id
    const acumuladorPorEmpleado = new Map<
        string,
        { detalle: DetalleMinutos; nombre: string; operacion: string }
    >()
    for (const row of data ?? []) {
        const r = row as JornadaSnapshot & { usuarios?: { nombre?: string } | { nombre?: string }[] }
        const usuarioObj = Array.isArray(r.usuarios) ? r.usuarios[0] : r.usuarios
        const ref = acumuladorPorEmpleado.get(r.empleado_id)
        if (ref) {
            ref.detalle = sumarJornada(ref.detalle, r)
        } else {
            acumuladorPorEmpleado.set(r.empleado_id, {
                detalle: sumarJornada(acumuladorVacio(), r),
                nombre: usuarioObj?.nombre ?? '',
                operacion: r.operacion,
            })
        }
    }

    const tarifas = await obtenerTarifas()
    const resultados: ResumenEmpleadoPeriodo[] = []

    for (const [cedula, { detalle, nombre, operacion }] of acumuladorPorEmpleado) {
        const total = totalMinutos(detalle)
        const { valores, total: valorTotal } = calcularValores(detalle, tarifas)
        resultados.push({
            cedula,
            nombre,
            operacion,
            periodo: { inicio: fechaInicio.toISOString(), fin: fechaFin.toISOString() },
            totalMinutos: total,
            horasTotales: minutosAHoras(total),
            horasTotalesFormato: horasAFormato(minutosAHoras(total)),
            detalleMinutos: detalle,
            horasFormato: toFormatoHoras(detalle),
            detalleValores: valores,
            valorTotal,
        })
    }

    return resultados
}
