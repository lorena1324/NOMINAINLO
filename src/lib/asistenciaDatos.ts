/**
 * Malla de asistencia: una fila por colaborador y por día.
 *
 * Es la fuente única para la descarga de nómina, el resumen diario por
 * operación, el histórico por quincena y el reporte de inconsistencias.
 * Solo LEE datos; no modifica nada en la base de datos.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { obtenerDiasFestivos } from '@/lib/calculoHoras'
import {
    calcularRetardo,
    esDomingoISO,
    fechaColombiaISO,
    hoyColombiaISO,
    indexarNovedadesPorDia,
    listarDias,
    normalizarNombre,
    rangoUTCDeDias,
    superaLimiteAbierta,
    ETIQUETA_ESTADO_DIA,
    type EstadoDia,
    type NovedadBasica,
    type NovedadDelDia,
    type TurnoRef,
} from '@/lib/asistencia'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any, any, any>

export { ETIQUETA_ESTADO_DIA }
export type { EstadoDia }

export interface JornadaFila {
    id: string
    empleado_id: string
    operacion: string
    entrada: string
    salida: string | null
    estado: string
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
    alerta_critica: boolean
}

export interface ColaboradorFila {
    id: string
    nombre: string
    cargo: string | null
    operacion: string | null
    status: string
    turno_id: string | null
    created_at: string | null
}

export interface FilaAsistencia {
    fecha: string // YYYY-MM-DD (Colombia)
    colaborador: ColaboradorFila
    jornada: JornadaFila | null
    /** Operación donde se carga el día: la de la jornada, o la base si no marcó. */
    operacion: string
    estado: EstadoDia
    novedades: NovedadDelDia[]
    esDomingo: boolean
    esFestivo: boolean
    /** Día hábil sin marcación y sin novedad. */
    inasistencia: boolean
    /** Minutos de retardo; `null` si no hay turno contra el cual comparar. */
    retardoMin: number | null
    turnoNombre: string
    /** Marcó en una operación diferente a su operación por defecto. */
    operacionDistinta: boolean
    /** Marcó en un día que tiene novedad registrada (vacaciones, incapacidad, permiso…). */
    timbradaConNovedad: boolean
}

export interface MallaAsistencia {
    filas: FilaAsistencia[]
    colaboradores: ColaboradorFila[]
    codigoOperacion: Map<string, string>
}

const COLUMNAS_JORNADA =
    'id, empleado_id, operacion, entrada, salida, estado, minutos_total, minutos_normales, minutos_nocturnas, minutos_domingos, minutos_festivos, minutos_domingos_festivos_nocturnos, minutos_extras_ordinarias, minutos_extras_nocturnas, minutos_extras_dominical_festivo, minutos_extras_nocturna_dominical_festivo, minutos_almuerzo_descontados, alerta_critica'

/** Supabase devuelve máximo 1000 filas por consulta: traemos todas por páginas. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function traerTodo<T>(construir: () => any): Promise<T[]> {
    const TAMANO = 1000
    const todo: T[] = []
    for (let desde = 0; desde < 100000; desde += TAMANO) {
        const { data, error } = await construir().range(desde, desde + TAMANO - 1)
        if (error) throw new Error(error.message)
        todo.push(...((data ?? []) as T[]))
        if (!data || data.length < TAMANO) break
    }
    return todo
}

async function festivosISO(start: string, end: string): Promise<Set<string>> {
    const anios = new Set([Number(start.slice(0, 4)), Number(end.slice(0, 4))])
    const set = new Set<string>()
    for (const anio of anios) {
        const fechas = await obtenerDiasFestivos(anio)
        for (const f of fechas) set.add(f.toISOString().slice(0, 10))
    }
    return set
}

export interface OpcionesMalla {
    start: string
    end: string
    /** Vacío = todas las operaciones. */
    operaciones?: string[]
    /** Limitar a un colaborador. */
    cedula?: string
    /**
     * true (por defecto): genera fila para cada día sin marcación.
     * false: solo días con jornada o novedad.
     */
    incluirDiasSinMarcacion?: boolean
}

export async function construirMallaAsistencia(
    supabase: Cliente,
    opciones: OpcionesMalla,
): Promise<MallaAsistencia> {
    const { start, end } = opciones
    const operaciones = opciones.operaciones ?? []
    const incluirVacios = opciones.incluirDiasSinMarcacion ?? true
    const { inicioUTC, finUTC } = rangoUTCDeDias(start, end)
    const hoy = hoyColombiaISO()

    // ─── Operaciones y turnos ───────────────────────────────────
    const { data: opsData } = await supabase.from('operaciones').select('id, nombre, codigo')
    const codigoOperacion = new Map<string, string>()
    const nombrePorIdOperacion = new Map<string, string>()
    for (const op of opsData ?? []) {
        codigoOperacion.set(op.nombre, op.codigo ?? '')
        nombrePorIdOperacion.set(op.id, op.nombre)
    }

    const { data: turnosData } = await supabase
        .from('turnos')
        .select('id, operacion_id, nombre, hora_inicio, hora_fin')
    const turnoPorId = new Map<string, TurnoRef>()
    const turnosPorOperacion = new Map<string, TurnoRef[]>()
    for (const t of turnosData ?? []) {
        const turno: TurnoRef = { id: t.id, nombre: t.nombre, hora_inicio: t.hora_inicio, hora_fin: t.hora_fin }
        turnoPorId.set(t.id, turno)
        const nombreOp = nombrePorIdOperacion.get(t.operacion_id)
        if (!nombreOp) continue
        if (!turnosPorOperacion.has(nombreOp)) turnosPorOperacion.set(nombreOp, [])
        turnosPorOperacion.get(nombreOp)!.push(turno)
    }

    // ─── Jornadas del rango ─────────────────────────────────────
    const jornadas = await traerTodo<JornadaFila>(() => {
        let q = supabase
            .from('jornadas')
            .select(COLUMNAS_JORNADA)
            .gte('entrada', inicioUTC.toISOString())
            .lt('entrada', finUTC.toISOString())
            .order('entrada', { ascending: true })
        if (operaciones.length > 0) q = q.in('operacion', operaciones)
        if (opciones.cedula) q = q.eq('empleado_id', opciones.cedula)
        return q
    })

    // ─── Colaboradores ──────────────────────────────────────────
    const usuariosCrudos = await traerTodo<Record<string, unknown>>(() => {
        let q = supabase.from('usuarios').select('*').order('nombre', { ascending: true })
        if (opciones.cedula) q = q.eq('id', opciones.cedula)
        return q
    })
    const todos = new Map<string, ColaboradorFila>()
    for (const u of usuariosCrudos) {
        todos.set(String(u.id), {
            id: String(u.id),
            nombre: String(u.nombre ?? ''),
            cargo: (u.cargo as string) ?? null,
            operacion: (u.operacion as string) ?? null,
            status: String(u.status ?? ''),
            turno_id: (u.turno_id as string) ?? null,
            created_at: (u.created_at as string) ?? null,
        })
    }

    const enAlcance = (c: ColaboradorFila) =>
        operaciones.length === 0 || (!!c.operacion && operaciones.includes(c.operacion))

    // ─── Novedades del rango ────────────────────────────────────
    const novedades = await traerTodo<NovedadBasica>(() => {
        let q = supabase
            .from('novedades')
            .select('usuario_id, tipo_novedad, descripcion, fecha_novedad, fecha_inicio, fecha_fin')
            .or(
                `and(fecha_novedad.gte.${start},fecha_novedad.lte.${end}),and(fecha_inicio.lte.${end},fecha_fin.gte.${start})`,
            )
            .order('id', { ascending: true })
        if (opciones.cedula) q = q.eq('usuario_id', opciones.cedula)
        return q
    })
    const novedadesPorDia = indexarNovedadesPorDia(novedades, start, end)

    const festivos = await festivosISO(start, end)

    // ─── Filas con jornada ──────────────────────────────────────
    const filas: FilaAsistencia[] = []
    const diasConJornada = new Set<string>()
    const primeraJornada = new Map<string, string>()

    for (const j of jornadas) {
        const colaborador = todos.get(j.empleado_id)
        if (!colaborador) continue
        const fecha = fechaColombiaISO(j.entrada)
        const clave = `${colaborador.id}::${fecha}`
        diasConJornada.add(clave)
        if (!primeraJornada.has(colaborador.id)) primeraJornada.set(colaborador.id, fecha)

        const novs = novedadesPorDia.get(clave) ?? []

        // Turno de referencia: el asignado al colaborador; si no tiene, los de la operación.
        const turnoAsignado = colaborador.turno_id ? turnoPorId.get(colaborador.turno_id) : undefined
        const candidatos = turnoAsignado ? [turnoAsignado] : (turnosPorOperacion.get(j.operacion) ?? [])
        const retardo = calcularRetardo(j.entrada, candidatos)

        let estado: EstadoDia = 'ASISTIO'
        if (j.estado === 'INCONSISTENTE') estado = 'CIERRE_AUTOMATICO'
        else if (j.estado === 'ABIERTO') {
            estado = superaLimiteAbierta(j.entrada) ? 'CIERRE_AUTOMATICO' : 'PENDIENTE'
        }

        filas.push({
            fecha,
            colaborador,
            jornada: j,
            operacion: j.operacion,
            estado,
            novedades: novs,
            esDomingo: esDomingoISO(fecha),
            esFestivo: festivos.has(fecha),
            inasistencia: false,
            retardoMin: retardo ? retardo.minutos : null,
            turnoNombre: retardo?.turno.nombre ?? turnoAsignado?.nombre ?? '',
            operacionDistinta: !!colaborador.operacion && colaborador.operacion !== j.operacion,
            timbradaConNovedad: novs.length > 0,
        })
    }

    // ─── Filas sin jornada (novedad o sin asistencia) ───────────
    const dias = listarDias(start, end < hoy ? end : hoy)
    const colaboradoresMalla = Array.from(todos.values()).filter(enAlcance)

    for (const colaborador of colaboradoresMalla) {
        const activo = colaborador.status === 'activo'
        // No se reportan inasistencias de días anteriores a la creación del colaborador.
        const creado = colaborador.created_at ? fechaColombiaISO(colaborador.created_at) : null
        const primera = primeraJornada.get(colaborador.id) ?? null
        const desde = creado && primera ? (creado < primera ? creado : primera) : creado

        for (const fecha of dias) {
            const clave = `${colaborador.id}::${fecha}`
            if (diasConJornada.has(clave)) continue
            const novs = novedadesPorDia.get(clave) ?? []
            const tieneNovedad = novs.length > 0

            if (!tieneNovedad) {
                if (!incluirVacios || !activo) continue
                if (desde && fecha < desde) continue
            }

            const esDomingo = esDomingoISO(fecha)
            const esFestivo = festivos.has(fecha)
            filas.push({
                fecha,
                colaborador,
                jornada: null,
                operacion: colaborador.operacion ?? '',
                estado: tieneNovedad ? 'NOVEDAD' : 'SIN_ASISTENCIA',
                novedades: novs,
                esDomingo,
                esFestivo,
                inasistencia: !tieneNovedad && !esDomingo && !esFestivo,
                retardoMin: null,
                turnoNombre: '',
                operacionDistinta: false,
                timbradaConNovedad: false,
            })
        }
    }

    filas.sort(
        (a, b) =>
            a.fecha.localeCompare(b.fecha) ||
            a.colaborador.nombre.localeCompare(b.colaborador.nombre) ||
            (a.jornada?.entrada ?? '').localeCompare(b.jornada?.entrada ?? ''),
    )

    // Colaboradores visibles: los de las operaciones filtradas + los que marcaron en ellas
    const idsConFila = new Set(filas.map((f) => f.colaborador.id))
    const colaboradores = Array.from(todos.values()).filter((c) => enAlcance(c) || idsConFila.has(c.id))

    return { filas, colaboradores, codigoOperacion }
}

// ════════════════════════════════════════════════════════════════════
// Resumen de retardos
// ════════════════════════════════════════════════════════════════════

export interface ResumenRetardos {
    cedula: string
    nombre: string
    operacion: string
    cantidad: number
    minutos: number
}

/** Número de retardos y total de minutos por colaborador. */
export function resumirRetardos(filas: FilaAsistencia[]): ResumenRetardos[] {
    const mapa = new Map<string, ResumenRetardos>()
    for (const f of filas) {
        if (!f.retardoMin || f.retardoMin <= 0) continue
        const id = f.colaborador.id
        if (!mapa.has(id)) {
            mapa.set(id, {
                cedula: id,
                nombre: f.colaborador.nombre,
                operacion: f.colaborador.operacion ?? f.operacion,
                cantidad: 0,
                minutos: 0,
            })
        }
        const r = mapa.get(id)!
        r.cantidad += 1
        r.minutos += f.retardoMin
    }
    return Array.from(mapa.values()).sort((a, b) => b.minutos - a.minutos || a.nombre.localeCompare(b.nombre))
}

// ════════════════════════════════════════════════════════════════════
// Inconsistencias
// ════════════════════════════════════════════════════════════════════

export interface Inconsistencia {
    tipo: string
    fecha: string | null
    cedula: string
    nombre: string
    operacion: string
    detalle: string
    accion: string
}

/**
 * Lista todo lo que conviene revisar antes de cerrar la quincena.
 * `colaboradores` debe ser el universo visible para quien consulta.
 */
export function detectarInconsistencias(
    filas: FilaAsistencia[],
    colaboradores: ColaboradorFila[],
    extrasPendientes: { empleado_id: string; fecha: string; minutos: number; operacion: string }[] = [],
): Inconsistencia[] {
    const lista: Inconsistencia[] = []
    const base = (f: FilaAsistencia) => ({
        fecha: f.fecha,
        cedula: f.colaborador.id,
        nombre: f.colaborador.nombre,
        operacion: f.operacion,
    })

    for (const f of filas) {
        if (f.estado === 'CIERRE_AUTOMATICO') {
            lista.push({
                ...base(f),
                tipo: 'Cierre automático',
                detalle: 'Entrada sin salida registrada. Las horas no se pagan hasta validar.',
                accion: 'Registrar la hora real de salida y el motivo.',
            })
        }
        if (f.jornada?.alerta_critica) {
            lista.push({
                ...base(f),
                tipo: 'Jornada mayor a 12 h',
                detalle: `Jornada de ${(f.jornada.minutos_total / 60).toFixed(1)} h pagables.`,
                accion: 'Confirmar que el turno fue real o corregir la marcación.',
            })
        }
        if (f.timbradaConNovedad) {
            lista.push({
                ...base(f),
                tipo: 'Marcación en día con novedad',
                detalle: `Marcó asistencia y tiene novedad: ${f.novedades.map((n) => n.tipo.replace(/_/g, ' ')).join(', ')}.`,
                accion: 'Validar cuál de los dos registros es correcto.',
            })
        }
        if (f.operacionDistinta) {
            lista.push({
                ...base(f),
                tipo: 'Operación distinta a la asignada',
                detalle: `Marcó en "${f.operacion}" y su operación por defecto es "${f.colaborador.operacion}".`,
                accion: 'Confirmar el centro de costo al que se carga el día.',
            })
        }
        if (f.inasistencia) {
            lista.push({
                ...base(f),
                tipo: 'Sin asistencia',
                detalle: 'Día hábil sin marcación y sin novedad registrada.',
                accion: 'Registrar la novedad (permiso, incapacidad, ausentismo…) si aplica.',
            })
        }
    }

    for (const e of extrasPendientes) {
        const c = colaboradores.find((x) => x.id === e.empleado_id)
        lista.push({
            tipo: 'Horas extra sin aprobar',
            fecha: e.fecha,
            cedula: e.empleado_id,
            nombre: c?.nombre ?? '',
            operacion: e.operacion,
            detalle: `${(e.minutos / 60).toFixed(1)} h extra pendientes de aprobación.`,
            accion: 'Aprobar o rechazar desde el Panel de Control.',
        })
    }

    // Colaboradores activos sin operación por defecto
    for (const c of colaboradores) {
        if (c.status === 'activo' && !c.operacion) {
            lista.push({
                tipo: 'Colaborador sin operación',
                fecha: null,
                cedula: c.id,
                nombre: c.nombre,
                operacion: '',
                detalle: 'No tiene operación (CECO) por defecto asignada.',
                accion: 'Asignar la operación desde Empleados.',
            })
        }
    }

    // Posibles duplicados: mismo nombre con cédulas distintas
    const porNombre = new Map<string, ColaboradorFila[]>()
    for (const c of colaboradores) {
        const n = normalizarNombre(c.nombre)
        if (!n) continue
        if (!porNombre.has(n)) porNombre.set(n, [])
        porNombre.get(n)!.push(c)
    }
    for (const grupo of porNombre.values()) {
        if (grupo.length < 2) continue
        for (const c of grupo) {
            const otras = grupo.filter((x) => x.id !== c.id).map((x) => `${x.id} (${x.status})`).join(', ')
            lista.push({
                tipo: 'Posible colaborador duplicado',
                fecha: null,
                cedula: c.id,
                nombre: c.nombre,
                operacion: c.operacion ?? '',
                detalle: `Mismo nombre registrado con otra cédula: ${otras}.`,
                accion: 'Conservar la cédula correcta y eliminar o inactivar la otra.',
            })
        }
    }

    return lista
}
