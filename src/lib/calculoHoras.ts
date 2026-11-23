import { createClient } from '@/lib/supabase/server'

// ==================================================
// CACHÉ DE DÍAS FESTIVOS (24h TTL por año)
// ==================================================
interface CacheFestivo {
    fechas: Date[]
    timestamp: number
}
const cacheDiasFestivos: Record<number, CacheFestivo> = {}
const CACHE_FESTIVOS_DURACION = 24 * 60 * 60 * 1000

// ==================================================
// CACHÉ DE TARIFAS (5 min TTL)
// ==================================================
let cacheTarifas: Record<string, number> | null = null
let cacheTarifasTimestamp: number | null = null
const CACHE_TARIFAS_DURACION = 5 * 60 * 1000

// ==================================================
// TIPOS PÚBLICOS
// ==================================================
export type TipoMinuto =
    | 'normal'
    | 'nocturno'
    | 'extra'
    | 'extraNocturno'
    | 'domingo'
    | 'festivo'
    | 'domingoFestivoNocturno'
    | 'extraDominicalFestivo'
    | 'extraNocturnaDominicalFestivo'

export interface PeriodosHoras {
    totalMinutos: number
    minutosNormales: number
    minutosNocturnas: number
    minutosDomingos: number
    minutosFestivos: number
    minutosDomingosFestivosNocturnos: number
    minutosExtrasOrdinarias: number
    minutosExtrasNocturnas: number
    minutosExtrasDominicalFestivo: number
    minutosExtrasNocturnaDominicalFestivo: number
}

// ==================================================
// UTILIDADES DE PRECISIÓN
// ==================================================
export function minutosAHoras(minutos: number): number {
    if (!minutos || minutos === 0) return 0
    return Math.round((minutos / 60) * 10000) / 10000
}

export function calcularValorPorMinutos(minutos: number, tarifaPorHora: number): number {
    if (!minutos || minutos === 0 || !tarifaPorHora) return 0
    return Math.round((minutos / 60) * tarifaPorHora * 100) / 100
}

export function horasAFormato(horas: number): string {
    if (!horas || horas === 0) return "0:00"
    const horasEnteras = Math.floor(horas)
    const minutos = Math.round((horas - horasEnteras) * 60)
    return `${horasEnteras}:${minutos.toString().padStart(2, '0')}`
}

export function redondearMediaHora(minutos: number): number {
    if (minutos <= 0) return 0
    return Math.floor(minutos / 30) * 30
}

// ==================================================
// ZONA HORARIA — Colombia UTC-5 fijo (sin DST)
// ==================================================
/**
 * Convierte una fecha UTC a un Date "falso" donde los métodos getUTC*
 * devuelven la hora local de Bogotá. Útil para clasificar minutos por franja.
 */
export function toColombiaTime(fechaUTC: Date | string): Date {
    const d = new Date(fechaUTC)
    return new Date(d.getTime() + (-5 * 60 * 60 * 1000))
}

export function esHorarioNocturno(fechaBogota: Date): boolean {
    const hora = fechaBogota.getUTCHours()
    return hora >= 19 || hora < 6
}

export function esDomingoOFestivo(
    fechaBogota: Date,
    diasFestivos: Date[],
): { isDomingo: boolean; isFestivo: boolean } {
    const isDomingo = fechaBogota.getUTCDay() === 0
    const fechaNormalizada = new Date(
        Date.UTC(fechaBogota.getUTCFullYear(), fechaBogota.getUTCMonth(), fechaBogota.getUTCDate()),
    )
    const isFestivo = diasFestivos.some((festivo) => festivo.getTime() === fechaNormalizada.getTime())
    return { isDomingo, isFestivo }
}

// ==================================================
// FESTIVOS (API Colombia + fallback caché)
// ==================================================
export async function obtenerDiasFestivos(año: number): Promise<Date[]> {
    const cached = cacheDiasFestivos[año]
    if (cached && Date.now() - cached.timestamp < CACHE_FESTIVOS_DURACION) {
        return cached.fechas
    }

    try {
        const res = await fetch(`https://api-colombia.com/api/v1/Holiday/year/${año}`)
        if (!res.ok) throw new Error(`API festivos: ${res.status}`)
        const data = await res.json()
        const fechas = data.map((f: { date: string }) => {
            const d = new Date(f.date)
            return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
        })
        cacheDiasFestivos[año] = { fechas, timestamp: Date.now() }
        return fechas
    } catch (error) {
        console.error(`Error al obtener festivos para ${año}:`, error)
        return cacheDiasFestivos[año]?.fechas ?? []
    }
}

/**
 * Retorna los festivos que cubren el rango [entrada, salida]. Si el rango
 * cruza de año, concatena los festivos de ambos.
 */
export async function obtenerFestivosParaRango(entrada: Date, salida: Date): Promise<Date[]> {
    const añoInicio = entrada.getUTCFullYear()
    const añoFin = salida.getUTCFullYear()
    const festivos = await obtenerDiasFestivos(añoInicio)
    if (añoFin !== añoInicio) {
        const festivosFin = await obtenerDiasFestivos(añoFin)
        return [...festivos, ...festivosFin]
    }
    return festivos
}

// ==================================================
// TARIFAS (tabla `tarifas` + caché + fallback hardcodeado 2026)
// ==================================================
export async function obtenerTarifas(): Promise<Record<string, number>> {
    if (cacheTarifas && cacheTarifasTimestamp) {
        const elapsed = Date.now() - cacheTarifasTimestamp
        if (elapsed < CACHE_TARIFAS_DURACION) return cacheTarifas
    }

    try {
        const supabase = await createClient()
        const { data, error } = await supabase
            .from('tarifas')
            .select('tipo_hora, precio_por_hora')
            .eq('activo', true)

        if (error) throw error

        const tarifas: Record<string, number> = {}
        data.forEach((row) => {
            tarifas[row.tipo_hora] = parseFloat(row.precio_por_hora)
        })

        cacheTarifas = tarifas
        cacheTarifasTimestamp = Date.now()
        return tarifas
    } catch (error) {
        console.error('Error al obtener tarifas, usando fallback:', error)
        return {
            // 2026 desde el 15 de julio: SMMLV 1.750.905 / 210 h (semana de 42 h),
            // recargo dominical/festivo 90 % (Ley 2466 de 2025). `nocturno` = solo el recargo (35 %).
            normal: 8337.642857,
            nocturno: 2918,
            extra: 10422,
            extraNocturno: 14591,
            domingo: 15842,
            festivo: 15842,
            domingoFestivoNocturno: 18760,
            extraDominicalFestivo: 17926,
            extraNocturnaDominicalFestivo: 22095,
        }
    }
}

// ==================================================
// MOTOR POR TRAMOS (chunk-based)
// ==================================================
/**
 * Calcula los 9 tipos de minutos entre `entradaBogota` y `salidaBogota`.
 *
 * Input: fechas ya convertidas a Bogotá (hora falsa donde getUTC* retorna hora local).
 * El motor avanza por chunks hasta el próximo "punto de corte" (19:00, 06:00, medianoche
 * o el umbral de 480 min). Cada chunk se clasifica por franja nocturna, día domingo/festivo
 * y si ya superó las 8h acumuladas.
 *
 * Casos especiales preservados:
 * - Cruce de medianoche → el chunk se corta en 00:00 y se recalcula tipo.
 * - Domingo 22:00 → Lunes festivo: todo sigue siendo `domingoFestivoNocturno`.
 * - Turno que cruza domingo→lunes ordinario: los minutos del lunes pasan a normal/nocturno.
 * - Festivo en medio de semana: cada tramo se evalúa contra la lista de festivos.
 */
export function calcularPeriodosHorasOptimizado(
    entradaBogota: Date,
    salidaBogota: Date,
    diasFestivos: Date[],
    minutosAcumuladosOffset = 0,
): PeriodosHoras {
    const resultado: PeriodosHoras = {
        totalMinutos: 0,
        minutosNormales: 0,
        minutosNocturnas: 0,
        minutosDomingos: 0,
        minutosFestivos: 0,
        minutosDomingosFestivosNocturnos: 0,
        minutosExtrasOrdinarias: 0,
        minutosExtrasNocturnas: 0,
        minutosExtrasDominicalFestivo: 0,
        minutosExtrasNocturnaDominicalFestivo: 0,
    }

    const diffMs = salidaBogota.getTime() - entradaBogota.getTime()
    const totalMinutos = Math.floor(diffMs / (1000 * 60))
    resultado.totalMinutos = totalMinutos
    if (totalMinutos <= 0) return resultado

    let minutosAcumulados = minutosAcumuladosOffset
    let momentoActualMs = entradaBogota.getTime()

    while (momentoActualMs < salidaBogota.getTime()) {
        const momentoActual = new Date(momentoActualMs)
        const horaUTC = momentoActual.getUTCHours()

        let minutosHastaCambioHorario = 0
        if (horaUTC >= 6 && horaUTC < 19) {
            const next19 = new Date(momentoActual)
            next19.setUTCHours(19, 0, 0, 0)
            minutosHastaCambioHorario = Math.floor((next19.getTime() - momentoActual.getTime()) / 60000)
        } else if (horaUTC >= 19) {
            const nextMidnight = new Date(momentoActual)
            nextMidnight.setUTCHours(24, 0, 0, 0)
            minutosHastaCambioHorario = Math.floor((nextMidnight.getTime() - momentoActual.getTime()) / 60000)
        } else {
            const next6 = new Date(momentoActual)
            next6.setUTCHours(6, 0, 0, 0)
            minutosHastaCambioHorario = Math.floor((next6.getTime() - momentoActual.getTime()) / 60000)
        }

        const minutosHastaExtra = minutosAcumulados < 480 ? 480 - minutosAcumulados : Infinity
        const minutosRestantes = Math.floor((salidaBogota.getTime() - momentoActualMs) / 60000)

        let chunkMinutos = Math.min(
            minutosHastaCambioHorario > 0 ? minutosHastaCambioHorario : 1,
            minutosHastaExtra,
            minutosRestantes,
        )
        if (chunkMinutos <= 0) chunkMinutos = 1

        const esNocturno = esHorarioNocturno(momentoActual)
        const inicioDia = new Date(momentoActual)
        inicioDia.setUTCHours(0, 0, 0, 0)
        const { isDomingo, isFestivo } = esDomingoOFestivo(inicioDia, diasFestivos)
        const esExtra = minutosAcumulados >= 480

        let tipo: TipoMinuto
        if (isDomingo || isFestivo) {
            if (esExtra) {
                tipo = esNocturno ? 'extraNocturnaDominicalFestivo' : 'extraDominicalFestivo'
            } else if (esNocturno) {
                tipo = 'domingoFestivoNocturno'
            } else {
                tipo = isDomingo ? 'domingo' : 'festivo'
            }
        } else if (esExtra) {
            tipo = esNocturno ? 'extraNocturno' : 'extra'
        } else {
            tipo = esNocturno ? 'nocturno' : 'normal'
        }

        switch (tipo) {
            case 'normal':                         resultado.minutosNormales += chunkMinutos; break
            case 'nocturno':                       resultado.minutosNocturnas += chunkMinutos; break
            case 'extra':                          resultado.minutosExtrasOrdinarias += chunkMinutos; break
            case 'extraNocturno':                  resultado.minutosExtrasNocturnas += chunkMinutos; break
            case 'domingo':                        resultado.minutosDomingos += chunkMinutos; break
            case 'festivo':                        resultado.minutosFestivos += chunkMinutos; break
            case 'domingoFestivoNocturno':         resultado.minutosDomingosFestivosNocturnos += chunkMinutos; break
            case 'extraDominicalFestivo':          resultado.minutosExtrasDominicalFestivo += chunkMinutos; break
            case 'extraNocturnaDominicalFestivo':  resultado.minutosExtrasNocturnaDominicalFestivo += chunkMinutos; break
        }

        minutosAcumulados += chunkMinutos
        momentoActualMs += chunkMinutos * 60000
    }

    return resultado
}
