/**
 * Reglas de asistencia compartidas (sin acceso a base de datos).
 *
 * Todo lo de este archivo es cálculo puro: fechas en hora Colombia, quincenas,
 * retardos y validaciones de datos. Se usa desde el quiosco, las pantallas del
 * coordinador y las descargas de Excel, para que todos muestren lo mismo.
 */

// ════════════════════════════════════════════════════════════════════
// Parámetros de negocio
// ════════════════════════════════════════════════════════════════════

/** Horas desde la entrada tras las cuales una jornada abierta se cierra sola. */
export const UMBRAL_CIERRE_AUTOMATICO_HORAS = 15

/** Dos marcaciones del mismo colaborador con menos de estos minutos se toman como una sola. */
export const MINUTOS_MARCACION_DUPLICADA = 5

/**
 * Si la entrada está a más de estos minutos del inicio del turno, se asume que
 * el colaborador está en otro turno y no se cuenta como retardo.
 */
export const MAX_MINUTOS_RETARDO = 240

const OFFSET_COLOMBIA_MS = 5 * 60 * 60 * 1000

// ════════════════════════════════════════════════════════════════════
// Fechas en hora Colombia (UTC-5 fijo)
// ════════════════════════════════════════════════════════════════════

function aColombia(fecha: Date | string): Date {
    return new Date(new Date(fecha).getTime() - OFFSET_COLOMBIA_MS)
}

/** Día calendario en Colombia, formato YYYY-MM-DD. */
export function fechaColombiaISO(fecha: Date | string): string {
    return aColombia(fecha).toISOString().slice(0, 10)
}

export function hoyColombiaISO(ahora: Date = new Date()): string {
    return fechaColombiaISO(ahora)
}

/** Minutos transcurridos desde la medianoche en Colombia (los segundos se descartan). */
export function minutosDelDiaColombia(fecha: Date | string): number {
    const col = aColombia(fecha)
    return col.getUTCHours() * 60 + col.getUTCMinutes()
}

/** Hora en formato 24h "HH:MM" (Colombia). */
export function horaColombia24(fecha: Date | string): string {
    const col = aColombia(fecha)
    return `${String(col.getUTCHours()).padStart(2, '0')}:${String(col.getUTCMinutes()).padStart(2, '0')}`
}

/** Rango UTC [inicio, fin) que cubre los días Colombia de `start` a `end` inclusive. */
export function rangoUTCDeDias(start: string, end: string): { inicioUTC: Date; finUTC: Date } {
    const inicioUTC = new Date(`${start}T05:00:00Z`)
    const finUTC = new Date(`${end}T05:00:00Z`)
    finUTC.setUTCDate(finUTC.getUTCDate() + 1)
    return { inicioUTC, finUTC }
}

/** Lista de días YYYY-MM-DD entre `start` y `end`, ambos incluidos. */
export function listarDias(start: string, end: string): string[] {
    const dias: string[] = []
    const d = new Date(`${start}T00:00:00Z`)
    const fin = new Date(`${end}T00:00:00Z`)
    while (d.getTime() <= fin.getTime() && dias.length < 400) {
        dias.push(d.toISOString().slice(0, 10))
        d.setUTCDate(d.getUTCDate() + 1)
    }
    return dias
}

export function esDomingoISO(fechaISO: string): boolean {
    return new Date(`${fechaISO}T00:00:00Z`).getUTCDay() === 0
}

/** Convierte YYYY-MM-DD en un Date a medianoche UTC (lo que Excel necesita para una fecha real). */
export function fechaISOaDateUTC(fechaISO: string): Date {
    const [y, m, d] = fechaISO.slice(0, 10).split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d))
}

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/** "lun 03/11" — para tablas compactas. */
export function fechaCortaConDia(fechaISO: string): string {
    const d = fechaISOaDateUTC(fechaISO)
    return `${DIAS_CORTOS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// ════════════════════════════════════════════════════════════════════
// Quincenas
// ════════════════════════════════════════════════════════════════════

export interface Quincena {
    numero: 1 | 2
    start: string
    end: string
    etiqueta: string
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Quincena (1ª: 1–15, 2ª: 16–fin de mes) de un año/mes dados. `mes` va de 1 a 12. */
export function quincena(anio: number, mes: number, numero: 1 | 2): Quincena {
    const mm = String(mes).padStart(2, '0')
    const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
    const start = numero === 1 ? `${anio}-${mm}-01` : `${anio}-${mm}-16`
    const end = numero === 1 ? `${anio}-${mm}-15` : `${anio}-${mm}-${String(ultimoDia).padStart(2, '0')}`
    const dias = numero === 1 ? '1 al 15' : `16 al ${ultimoDia}`
    return { numero, start, end, etiqueta: `${numero}ª quincena · ${dias} de ${MESES[mes - 1]} ${anio}` }
}

/** Quincena a la que pertenece una fecha YYYY-MM-DD. */
export function quincenaDeFecha(fechaISO: string): Quincena {
    const [y, m, d] = fechaISO.split('-').map(Number)
    return quincena(y, m, d <= 15 ? 1 : 2)
}

/** Quincena anterior (-1) o siguiente (+1). */
export function moverQuincena(q: Quincena, delta: -1 | 1): Quincena {
    const [y, m] = q.start.split('-').map(Number)
    if (delta === 1) {
        if (q.numero === 1) return quincena(y, m, 2)
        return m === 12 ? quincena(y + 1, 1, 1) : quincena(y, m + 1, 1)
    }
    if (q.numero === 2) return quincena(y, m, 1)
    return m === 1 ? quincena(y - 1, 12, 2) : quincena(y, m - 1, 2)
}

// ════════════════════════════════════════════════════════════════════
// Retardos
// ════════════════════════════════════════════════════════════════════

export interface TurnoRef {
    id?: string
    nombre?: string
    hora_inicio: string // 'HH:MM' o 'HH:MM:SS'
    hora_fin?: string
}

export interface ResultadoRetardo {
    /** Minutos de retraso respecto al inicio del turno. 0 = llegó a tiempo. */
    minutos: number
    turno: TurnoRef
}

function minutosDeHora(hora: string): number {
    const [h, m] = hora.split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
}

/**
 * Calcula el retardo de una entrada, minuto a minuto y sin redondeos:
 * turno 06:00 y entrada 06:01 → 1 minuto.
 *
 * Se compara contra el turno más cercano a la hora de entrada (útil para
 * personal rotativo). Retorna `null` cuando no hay turnos configurados o la
 * entrada está tan lejos de todos los turnos que no se puede asegurar a cuál
 * corresponde.
 */
export function calcularRetardo(
    entrada: Date | string,
    turnos: TurnoRef[],
): ResultadoRetardo | null {
    if (!turnos || turnos.length === 0) return null
    const minutosEntrada = minutosDelDiaColombia(entrada)

    let mejor: { diff: number; turno: TurnoRef } | null = null
    for (const turno of turnos) {
        if (!turno.hora_inicio) continue
        // Diferencia normalizada a (-720, 720] para soportar turnos que rondan la medianoche
        let diff = minutosEntrada - minutosDeHora(turno.hora_inicio)
        if (diff > 720) diff -= 1440
        if (diff <= -720) diff += 1440
        if (!mejor || Math.abs(diff) < Math.abs(mejor.diff)) mejor = { diff, turno }
    }

    if (!mejor) return null
    if (mejor.diff <= 0) return { minutos: 0, turno: mejor.turno }
    if (mejor.diff > MAX_MINUTOS_RETARDO) return null
    return { minutos: mejor.diff, turno: mejor.turno }
}

// ════════════════════════════════════════════════════════════════════
// Cierre automático de jornadas abiertas
// ════════════════════════════════════════════════════════════════════

/** ¿La jornada abierta ya superó el tiempo límite y debe cerrarse sola? */
export function superaLimiteAbierta(entrada: Date | string, ahora: Date = new Date()): boolean {
    const transcurridoMs = ahora.getTime() - new Date(entrada).getTime()
    return transcurridoMs >= UMBRAL_CIERRE_AUTOMATICO_HORAS * 60 * 60 * 1000
}

/** Salida que se muestra para una jornada con cierre automático: entrada + 15:00 h. */
export function salidaAutomatica(entrada: Date | string): Date {
    return new Date(new Date(entrada).getTime() + UMBRAL_CIERRE_AUTOMATICO_HORAS * 60 * 60 * 1000)
}

// ════════════════════════════════════════════════════════════════════
// Estados de jornada (nombre que ve el usuario)
// ════════════════════════════════════════════════════════════════════

export const ETIQUETA_ESTADO_JORNADA: Record<string, string> = {
    ABIERTO: 'Salida pendiente',
    CERRADO: 'Cerrada',
    CERRADO_MANUAL: 'Corregida por coordinador',
    // En base de datos el estado se sigue llamando INCONSISTENTE.
    INCONSISTENTE: 'Cierre automático (por validar)',
}

/** Qué pasó con un colaborador en un día concreto. */
export type EstadoDia =
    | 'ASISTIO'            // jornada cerrada
    | 'PENDIENTE'          // entrada registrada, salida pendiente
    | 'CIERRE_AUTOMATICO'  // abierta más del tiempo límite, por validar
    | 'NOVEDAD'            // sin marcación, con novedad registrada
    | 'SIN_ASISTENCIA'     // sin marcación ni novedad

export const ETIQUETA_ESTADO_DIA: Record<EstadoDia, string> = {
    ASISTIO: 'Asistió',
    PENDIENTE: 'Pendiente (sin salida)',
    CIERRE_AUTOMATICO: 'Cierre automático (por validar)',
    NOVEDAD: 'Novedad',
    SIN_ASISTENCIA: 'Sin asistencia',
}

// ════════════════════════════════════════════════════════════════════
// Validaciones de colaboradores
// ════════════════════════════════════════════════════════════════════

/** Deja solo los dígitos de una cédula (quita puntos, espacios y letras). */
export function limpiarCedula(valor: string): string {
    return (valor ?? '').replace(/\D/g, '')
}

/** Retorna el mensaje de error, o `null` si la cédula es válida. */
export function validarFormatoCedula(valor: string): string | null {
    const v = (valor ?? '').trim()
    if (!v) return 'La cédula es obligatoria.'
    if (!/^\d+$/.test(v)) return 'La cédula solo puede tener números, sin puntos, espacios ni letras.'
    if (v.length < 6 || v.length > 10) return 'La cédula debe tener entre 6 y 10 dígitos.'
    return null
}

/** Nombre en mayúsculas, sin tildes ni espacios dobles — para detectar posibles duplicados. */
export function normalizarNombre(nombre: string): string {
    return (nombre ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim()
}

// ════════════════════════════════════════════════════════════════════
// Novedades por día
// ════════════════════════════════════════════════════════════════════

export interface NovedadBasica {
    usuario_id: string
    tipo_novedad: string
    descripcion?: string | null
    fecha_novedad?: string | null
    fecha_inicio?: string | null
    fecha_fin?: string | null
}

export interface NovedadDelDia {
    tipo: string
    detalle: string
}

/** Texto legible del tipo de novedad: "LIC_NO_REMUNERADA" → "LIC NO REMUNERADA". */
export function etiquetaNovedad(tipo: string): string {
    return (tipo ?? '').replace(/_/g, ' ')
}

/**
 * Indexa las novedades por colaborador y día: clave `cedula::YYYY-MM-DD`.
 * Una novedad por rango se reparte en cada día que cubre dentro de [start, end].
 */
export function indexarNovedadesPorDia(
    novedades: NovedadBasica[],
    start: string,
    end: string,
): Map<string, NovedadDelDia[]> {
    const indice = new Map<string, NovedadDelDia[]>()
    const agregar = (usuario: string, fecha: string, n: NovedadBasica) => {
        if (fecha < start || fecha > end) return
        const clave = `${usuario}::${fecha}`
        if (!indice.has(clave)) indice.set(clave, [])
        indice.get(clave)!.push({ tipo: n.tipo_novedad, detalle: n.descripcion ?? '' })
    }

    for (const n of novedades) {
        if (n.fecha_inicio && n.fecha_fin) {
            const ini = n.fecha_inicio.slice(0, 10)
            const fin = n.fecha_fin.slice(0, 10)
            const desde = ini > start ? ini : start
            const hasta = fin < end ? fin : end
            if (desde <= hasta) {
                for (const dia of listarDias(desde, hasta)) agregar(n.usuario_id, dia, n)
            }
        } else if (n.fecha_novedad) {
            agregar(n.usuario_id, n.fecha_novedad.slice(0, 10), n)
        }
    }
    return indice
}
