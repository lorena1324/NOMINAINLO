/**
 * Datos de la quincena que se le entregan a TOLUIA (asistente IA).
 *
 * Todo sale de las mismas funciones que usan las pantallas y el Excel de
 * nómina, y siempre filtrado a lo que el perfil puede ver:
 *  - administrador: todas las operaciones (o la que elija);
 *  - coordinador / visualizador: solo su operación.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserProfile } from '@/lib/auth'
import { getOperationFilter } from '@/lib/auth'
import { hoyColombiaISO, quincenaDeFecha, type Quincena } from '@/lib/asistencia'
import {
    construirMallaAsistencia,
    detectarInconsistencias,
    resumirRetardos,
    type FilaAsistencia,
} from '@/lib/asistenciaDatos'
import { calcularHorasTodosEnPeriodo } from '@/lib/reportes'
import { rangoUTCDeDias } from '@/lib/asistencia'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any, any, any>

const h = (min: number) => Math.round((min / 60) * 10) / 10
const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`

interface Acumulado {
    colaboradores: Set<string>
    diasAsistidos: number
    inasistencias: number
    diasNovedad: number
    pendientesSinSalida: number
    cierresAutomaticos: number
    retardos: number
    minutosRetardo: number
    fueraGeocerca: number
}

function nuevoAcumulado(): Acumulado {
    return {
        colaboradores: new Set(), diasAsistidos: 0, inasistencias: 0, diasNovedad: 0,
        pendientesSinSalida: 0, cierresAutomaticos: 0, retardos: 0, minutosRetardo: 0, fueraGeocerca: 0,
    }
}

function acumular(a: Acumulado, f: FilaAsistencia) {
    a.colaboradores.add(f.colaborador.id)
    if (f.estado === 'ASISTIO') a.diasAsistidos++
    if (f.estado === 'NOVEDAD') a.diasNovedad++
    if (f.estado === 'PENDIENTE') a.pendientesSinSalida++
    if (f.estado === 'CIERRE_AUTOMATICO') a.cierresAutomaticos++
    if (f.inasistencia) a.inasistencias++
    if (f.retardoMin && f.retardoMin > 0) { a.retardos++; a.minutosRetardo += f.retardoMin }
    if (f.jornada?.fuera_geocerca) a.fueraGeocerca++
}

export interface ContextoQuincena {
    texto: string
    quincena: Quincena
    alcance: string
}

/**
 * Arma un resumen en texto de la quincena para el perfil.
 * `operacionPedida` solo la puede usar el administrador para enfocarse en una operación.
 */
export async function construirContextoQuincena(
    supabase: Cliente,
    profile: UserProfile,
    q: Quincena = quincenaDeFecha(hoyColombiaISO()),
    operacionPedida?: string | null,
): Promise<ContextoQuincena> {
    const filtroPerfil = getOperationFilter(profile)
    const operaciones = filtroPerfil.length > 0 ? filtroPerfil : operacionPedida ? [operacionPedida] : []
    const alcance = operaciones.length > 0 ? operaciones.join(', ') : 'Todas las operaciones'
    const hoy = hoyColombiaISO()
    const finEfectivo = q.end < hoy ? q.end : hoy

    const [malla, resumenHoras, extras, documentos] = await Promise.all([
        construirMallaAsistencia(supabase, { start: q.start, end: q.end, operaciones }),
        (async () => {
            const { inicioUTC, finUTC } = rangoUTCDeDias(q.start, q.end)
            return calcularHorasTodosEnPeriodo(inicioUTC, finUTC, operaciones)
        })(),
        (async () => {
            const { inicioUTC, finUTC } = rangoUTCDeDias(q.start, q.end)
            let qq = supabase
                .from('aprobaciones_extras')
                .select('empleado_id, minutos_solicitados, estado, jornadas!inner(entrada, operacion)')
                .gte('jornadas.entrada', inicioUTC.toISOString())
                .lte('jornadas.entrada', finUTC.toISOString())
            if (operaciones.length > 0) qq = qq.in('jornadas.operacion', operaciones)
            const { data } = await qq
            return (data ?? []) as unknown as {
                empleado_id: string; minutos_solicitados: number; estado: string
                jornadas: { entrada: string; operacion: string }
            }[]
        })(),
        (async () => {
            try {
                let qd = supabase
                    .from('documentos')
                    .select('estado, usuarios!inner(operacion)')
                    .eq('estado', 'PENDIENTE')
                if (operaciones.length > 0) qd = qd.in('usuarios.operacion', operaciones)
                const { data } = await qd
                return (data ?? []) as unknown as { usuarios: { operacion: string | null } }[]
            } catch {
                return []
            }
        })(),
    ])

    // ─── Totales por operación ───────────────────────────────────────
    const porOp = new Map<string, Acumulado>()
    const total = nuevoAcumulado()
    for (const f of malla.filas) {
        if (!porOp.has(f.operacion)) porOp.set(f.operacion, nuevoAcumulado())
        acumular(porOp.get(f.operacion)!, f)
        acumular(total, f)
    }

    const horasPorOp = new Map<string, { min: number; extrasMin: number; nocturnasMin: number; festivosMin: number; valor: number }>()
    for (const r of resumenHoras) {
        const d = r.detalleMinutos
        const x = horasPorOp.get(r.operacion) ?? { min: 0, extrasMin: 0, nocturnasMin: 0, festivosMin: 0, valor: 0 }
        x.min += r.totalMinutos
        x.extrasMin += d.extrasOrdinarias + d.extrasNocturnas + d.extrasDominicalFestivo + d.extrasNocturnaDominicalFestivo
        x.nocturnasMin += d.nocturnas
        x.festivosMin += d.domingos + d.festivos + d.domingosFestivosNocturnos
        x.valor += r.valorTotal
        horasPorOp.set(r.operacion, x)
    }

    const extrasPorOp = new Map<string, { pendMin: number; aprobMin: number; rechMin: number }>()
    for (const e of extras) {
        const op = e.jornadas?.operacion ?? '—'
        const x = extrasPorOp.get(op) ?? { pendMin: 0, aprobMin: 0, rechMin: 0 }
        if (e.estado === 'PENDIENTE') x.pendMin += e.minutos_solicitados
        else if (e.estado === 'APROBADA') x.aprobMin += e.minutos_solicitados
        else x.rechMin += e.minutos_solicitados
        extrasPorOp.set(op, x)
    }

    const docsPorOp = new Map<string, number>()
    for (const d of documentos) {
        const op = d.usuarios?.operacion ?? 'Sin operación'
        docsPorOp.set(op, (docsPorOp.get(op) ?? 0) + 1)
    }

    const ops = Array.from(new Set([...porOp.keys(), ...horasPorOp.keys()])).sort()

    const lineas: string[] = []
    lineas.push(`QUINCENA: ${q.start} a ${q.end} (${q.etiqueta}). Hoy: ${hoy}. Datos hasta: ${finEfectivo}.`)
    lineas.push(`ALCANCE DE QUIEN PREGUNTA: ${alcance} (rol: ${profile.rol}).`)
    lineas.push('')
    lineas.push('== RESUMEN POR OPERACIÓN ==')
    lineas.push('operacion | colaboradores | dias_asistidos | inasistencias | dias_novedad | sin_salida | cierres_automaticos | retardos(cant/min) | fuera_geocerca | horas_liquidadas | horas_extra | horas_nocturnas | horas_dom_fest | extras_pendientes_h | extras_aprobadas_h | extras_rechazadas_h | valor_bruto | documentos_pendientes')
    const fila = (op: string, a: Acumulado) => {
        const hh = horasPorOp.get(op) ?? { min: 0, extrasMin: 0, nocturnasMin: 0, festivosMin: 0, valor: 0 }
        const ex = extrasPorOp.get(op) ?? { pendMin: 0, aprobMin: 0, rechMin: 0 }
        return [
            op, a.colaboradores.size, a.diasAsistidos, a.inasistencias, a.diasNovedad, a.pendientesSinSalida,
            a.cierresAutomaticos, `${a.retardos}/${a.minutosRetardo}`, a.fueraGeocerca, h(hh.min), h(hh.extrasMin),
            h(hh.nocturnasMin), h(hh.festivosMin), h(ex.pendMin), h(ex.aprobMin), h(ex.rechMin), pesos(hh.valor),
            docsPorOp.get(op) ?? 0,
        ].join(' | ')
    }
    for (const op of ops) lineas.push(fila(op, porOp.get(op) ?? nuevoAcumulado()))
    if (ops.length > 1) {
        const tot = { min: 0, extrasMin: 0, nocturnasMin: 0, festivosMin: 0, valor: 0 }
        for (const v of horasPorOp.values()) {
            tot.min += v.min; tot.extrasMin += v.extrasMin; tot.nocturnasMin += v.nocturnasMin; tot.festivosMin += v.festivosMin; tot.valor += v.valor
        }
        const ex = { pendMin: 0, aprobMin: 0, rechMin: 0 }
        for (const v of extrasPorOp.values()) { ex.pendMin += v.pendMin; ex.aprobMin += v.aprobMin; ex.rechMin += v.rechMin }
        const docs = Array.from(docsPorOp.values()).reduce((a, b) => a + b, 0)
        lineas.push([
            'TOTAL', total.colaboradores.size, total.diasAsistidos, total.inasistencias, total.diasNovedad,
            total.pendientesSinSalida, total.cierresAutomaticos, `${total.retardos}/${total.minutosRetardo}`, total.fueraGeocerca,
            h(tot.min), h(tot.extrasMin), h(tot.nocturnasMin), h(tot.festivosMin), h(ex.pendMin), h(ex.aprobMin), h(ex.rechMin),
            pesos(tot.valor), docs,
        ].join(' | '))
    }

    // ─── Detalle por colaborador ─────────────────────────────────────
    const porColab = new Map<string, { nombre: string; op: string; asist: number; inas: number; nov: number; sinSalida: number; ret: number; retMin: number }>()
    for (const f of malla.filas) {
        const k = f.colaborador.id
        const x = porColab.get(k) ?? { nombre: f.colaborador.nombre, op: f.colaborador.operacion ?? f.operacion, asist: 0, inas: 0, nov: 0, sinSalida: 0, ret: 0, retMin: 0 }
        if (f.estado === 'ASISTIO') x.asist++
        if (f.estado === 'NOVEDAD') x.nov++
        if (f.estado === 'PENDIENTE' || f.estado === 'CIERRE_AUTOMATICO') x.sinSalida++
        if (f.inasistencia) x.inas++
        if (f.retardoMin && f.retardoMin > 0) { x.ret++; x.retMin += f.retardoMin }
        porColab.set(k, x)
    }
    const horasColab = new Map(resumenHoras.map((r) => [r.cedula, r]))
    const extrasColab = new Map<string, number>()
    for (const e of extras) if (e.estado === 'PENDIENTE') extrasColab.set(e.empleado_id, (extrasColab.get(e.empleado_id) ?? 0) + e.minutos_solicitados)

    lineas.push('')
    lineas.push('== DETALLE POR COLABORADOR ==')
    lineas.push('cedula | nombre | operacion | dias_asistidos | inasistencias | dias_novedad | sin_salida | retardos(cant/min) | horas_liquidadas | horas_extra | extras_pendientes_h | valor_bruto')
    const colabs = Array.from(porColab.entries()).sort((a, b) => a[1].op.localeCompare(b[1].op) || a[1].nombre.localeCompare(b[1].nombre))
    for (const [ced, x] of colabs) {
        const r = horasColab.get(ced)
        const d = r?.detalleMinutos
        const extrasMin = d ? d.extrasOrdinarias + d.extrasNocturnas + d.extrasDominicalFestivo + d.extrasNocturnaDominicalFestivo : 0
        lineas.push([
            ced, x.nombre, x.op, x.asist, x.inas, x.nov, x.sinSalida, `${x.ret}/${x.retMin}`,
            h(r?.totalMinutos ?? 0), h(extrasMin), h(extrasColab.get(ced) ?? 0), pesos(r?.valorTotal ?? 0),
        ].join(' | '))
    }

    // ─── Retardos e inconsistencias ──────────────────────────────────
    const retardos = resumirRetardos(malla.filas).slice(0, 30)
    if (retardos.length > 0) {
        lineas.push('')
        lineas.push('== MÁS RETARDOS (top 30) ==')
        for (const r of retardos) lineas.push(`${r.cedula} | ${r.nombre} | ${r.operacion} | ${r.cantidad} retardos | ${r.minutos} min`)
    }

    const pendientes = extras
        .filter((e) => e.estado === 'PENDIENTE')
        .map((e) => ({ empleado_id: e.empleado_id, fecha: e.jornadas.entrada.slice(0, 10), minutos: e.minutos_solicitados, operacion: e.jornadas.operacion }))
    const inconsistencias = detectarInconsistencias(malla.filas, malla.colaboradores, pendientes)
    const conteoTipo = new Map<string, number>()
    for (const i of inconsistencias) conteoTipo.set(i.tipo, (conteoTipo.get(i.tipo) ?? 0) + 1)
    lineas.push('')
    lineas.push(`== PENDIENTES POR REVISAR (${inconsistencias.length}) ==`)
    for (const [tipo, n] of conteoTipo) lineas.push(`${tipo}: ${n}`)
    const muestra = inconsistencias.filter((i) => i.tipo !== 'Sin asistencia').slice(0, 80)
    if (muestra.length > 0) {
        lineas.push('Detalle (sin contar "Sin asistencia", máx. 80):')
        for (const i of muestra) lineas.push(`${i.fecha ?? '—'} | ${i.cedula} | ${i.nombre} | ${i.operacion} | ${i.tipo} | ${i.detalle}`)
    }

    return { texto: lineas.join('\n'), quincena: q, alcance }
}
