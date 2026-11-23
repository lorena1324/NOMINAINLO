import ExcelJS from 'exceljs'
import { hoyColombiaISO, normalizarNombre, validarFormatoCedula } from '@/lib/asistencia'

/**
 * Lectura del Excel de personal (ej.: "ACTIVOS 22 NOV.xlsx").
 *
 * Columnas reconocidas por su título (sin importar mayúsculas, tildes ni orden):
 *   CEDULA*, NOMBRE*, CARGO*, INGRESO / FECHA INGRESO*, SALARIO, FECHA NACIMIENTO,
 *   OPERACION / CECO (opcional). Sin ella el colaborador queda sin operación y toma la
 *   de la tablet (cuenta de la operación) donde marque por primera vez.
 * (*) obligatorias.
 */

export interface FilaExcelEmpleado {
    fila: number
    cedula: string
    nombre: string
    cargo: string
    salario: number | null
    birthdate: string | null
    fechaIngreso: string | null
    operacion: string | null
}

export interface LecturaExcel {
    filas: FilaExcelEmpleado[]
    /** Columnas obligatorias que no se encontraron. */
    faltantes: string[]
    tieneColumnaOperacion: boolean
}

type Campo = 'cedula' | 'nombre' | 'cargo' | 'salario' | 'birthdate' | 'fechaIngreso' | 'operacion'

const OBLIGATORIAS: { campo: Campo; titulo: string }[] = [
    { campo: 'cedula', titulo: 'CEDULA' },
    { campo: 'nombre', titulo: 'NOMBRE' },
    { campo: 'cargo', titulo: 'CARGO' },
    { campo: 'fechaIngreso', titulo: 'INGRESO (fecha de ingreso)' },
]

function campoDeTitulo(titulo: string): Campo | null {
    const t = normalizarNombre(titulo)
    if (!t) return null
    if (/^(CEDULA|C\.?C\.?|DOCUMENTO|NUMERO DE DOCUMENTO|IDENTIFICACION)$/.test(t)) return 'cedula'
    if (t.includes('NACIMIENTO')) return 'birthdate'
    if (t.includes('INGRESO')) return 'fechaIngreso'
    if (t.startsWith('SALARIO') || t === 'SUELDO') return 'salario'
    if (t.startsWith('CARGO')) return 'cargo'
    if (t.startsWith('OPERACION') || t === 'CECO' || t.startsWith('CENTRO DE COSTO')) return 'operacion'
    if (t.startsWith('NOMBRE') || t === 'APELLIDOS Y NOMBRES') return 'nombre'
    return null
}

/** Valor "plano" de una celda (resuelve fórmulas, texto enriquecido e hipervínculos). */
function valorCelda(v: ExcelJS.CellValue): unknown {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
        const o = v as unknown as Record<string, unknown>
        if ('result' in o) return o.result
        if ('richText' in o && Array.isArray(o.richText)) {
            return (o.richText as { text: string }[]).map((r) => r.text).join('')
        }
        if ('text' in o) return o.text
    }
    return v
}

function texto(v: unknown): string {
    if (v === null || v === undefined) return ''
    return String(v).trim().replace(/\s+/g, ' ')
}

/** Fecha de la celda como YYYY-MM-DD. Acepta fecha de Excel, número de serie o texto dd/mm/aaaa. */
export function fechaCelda(v: unknown): string | null {
    if (v instanceof Date && !isNaN(v.getTime())) {
        // Excel guarda la fecha a medianoche UTC: se toma esa fecha tal cual.
        return v.toISOString().slice(0, 10)
    }
    if (typeof v === 'number' && v > 1 && v < 100000) {
        const d = new Date(Math.round((v - 25569) * 86400000))
        return d.toISOString().slice(0, 10)
    }
    const s = texto(v)
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    return null
}

function numeroCelda(v: unknown): number | null {
    if (typeof v === 'number' && isFinite(v)) return v
    const s = texto(v).replace(/[$\s]/g, '').replace(/\./g, '').replace(',', '.')
    if (!s) return null
    const n = Number(s)
    return isFinite(n) ? n : null
}

/** La cédula puede venir como número o como texto con puntos o espacios. */
function cedulaCelda(v: unknown): string {
    if (typeof v === 'number') return String(Math.round(v))
    return texto(v).replace(/[.\s,-]/g, '')
}

export async function leerExcelEmpleados(buffer: ArrayBuffer): Promise<LecturaExcel> {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)

    // Se usa la primera hoja que tenga una fila de títulos con CEDULA y NOMBRE.
    for (const ws of wb.worksheets) {
        let filaTitulos = 0
        let columnas = new Map<Campo, number>()
        for (let r = 1; r <= Math.min(ws.rowCount, 20) && !filaTitulos; r++) {
            const mapa = new Map<Campo, number>()
            ws.getRow(r).eachCell((celda, col) => {
                const campo = campoDeTitulo(texto(valorCelda(celda.value)))
                if (campo && !mapa.has(campo)) mapa.set(campo, col)
            })
            if (mapa.has('cedula') && mapa.has('nombre')) {
                filaTitulos = r
                columnas = mapa
            }
        }
        if (!filaTitulos) continue

        const filas: FilaExcelEmpleado[] = []
        for (let r = filaTitulos + 1; r <= ws.rowCount; r++) {
            const row = ws.getRow(r)
            const val = (campo: Campo) => {
                const col = columnas.get(campo)
                return col ? valorCelda(row.getCell(col).value) : null
            }
            const cedula = cedulaCelda(val('cedula'))
            const nombre = texto(val('nombre'))
            if (!cedula && !nombre) continue // fila vacía
            filas.push({
                fila: r,
                cedula,
                nombre: nombre.toUpperCase(),
                cargo: texto(val('cargo')).toUpperCase(),
                salario: numeroCelda(val('salario')),
                birthdate: fechaCelda(val('birthdate')),
                fechaIngreso: fechaCelda(val('fechaIngreso')),
                operacion: texto(val('operacion')) || null,
            })
        }

        return {
            filas,
            faltantes: OBLIGATORIAS.filter((o) => !columnas.has(o.campo)).map((o) => o.titulo),
            tieneColumnaOperacion: columnas.has('operacion'),
        }
    }

    return { filas: [], faltantes: ['CEDULA', 'NOMBRE'], tieneColumnaOperacion: false }
}

// ════════════════════════════════════════════════════════════════════
// Clasificación de cada fila frente a lo que ya hay en la base
// ════════════════════════════════════════════════════════════════════

export interface EmpleadoBD {
    id: string
    nombre: string
    cargo: string | null
    operacion: string | null
    status: string
    salario: number | null
    fecha_ingreso: string | null
    birthdate: string | null
}

export type EstadoFila =
    | 'nuevo'          // se crea
    | 'mismo_nombre'   // nuevo, pero ya hay alguien con el mismo nombre y otra cédula
    | 'existente'      // la cédula ya está registrada
    | 'error'          // no se puede importar

export interface FilaRevisada extends FilaExcelEmpleado {
    estado: EstadoFila
    /** Operación que se le asignará (nuevos; null = la toma al marcar) o que ya tiene (existentes). */
    operacionFinal: string | null
    motivo?: string
    /** Para existentes: qué cambiaría si se elige actualizar. */
    cambios?: string[]
    inactivo?: boolean
}

export function revisarFilas(
    filas: FilaExcelEmpleado[],
    existentes: EmpleadoBD[],
    operacionesValidas: string[],
): FilaRevisada[] {
    const porCedula = new Map(existentes.map((e) => [e.id, e]))
    const porNombre = new Map<string, EmpleadoBD[]>()
    for (const e of existentes) {
        const k = normalizarNombre(e.nombre)
        porNombre.set(k, [...(porNombre.get(k) ?? []), e])
    }
    // Las operaciones se comparan sin importar mayúsculas ni tildes
    const opNormal = new Map(operacionesValidas.map((o) => [normalizarNombre(o), o]))
    const vistas = new Map<string, number>()
    const hoy = hoyColombiaISO()

    return filas.map((f): FilaRevisada => {
        const err = (motivo: string): FilaRevisada => ({ ...f, estado: 'error', operacionFinal: null, motivo })

        const errorCedula = validarFormatoCedula(f.cedula)
        if (errorCedula) return err(errorCedula)
        if (vistas.has(f.cedula)) return err(`Cédula repetida en el archivo (también en la fila ${vistas.get(f.cedula)}).`)
        vistas.set(f.cedula, f.fila)
        if (!f.nombre) return err('Falta el nombre.')

        const actual = porCedula.get(f.cedula)
        if (actual) {
            const cambios: string[] = []
            if (f.cargo && f.cargo !== (actual.cargo ?? '').trim().toUpperCase()) cambios.push(`cargo: ${actual.cargo || '—'} → ${f.cargo}`)
            if (f.salario !== null && Number(actual.salario ?? 0) !== f.salario) {
                cambios.push(`salario: ${actual.salario ?? '—'} → ${f.salario}`)
            }
            if (f.fechaIngreso && f.fechaIngreso <= hoy && f.fechaIngreso !== (actual.fecha_ingreso ?? '').slice(0, 10)) {
                cambios.push(`ingreso: ${actual.fecha_ingreso?.slice(0, 10) ?? '—'} → ${f.fechaIngreso}`)
            }
            if (f.birthdate && !actual.birthdate) cambios.push(`nacimiento: — → ${f.birthdate}`)
            return {
                ...f,
                estado: 'existente',
                operacionFinal: actual.operacion,
                inactivo: actual.status !== 'activo',
                cambios,
                motivo: `Ya registrada: ${actual.nombre} (${actual.operacion ?? 'sin operación'}, ${actual.status}).`,
            }
        }

        if (!f.cargo) return err('Falta el cargo.')
        if (!f.fechaIngreso) return err('Falta la fecha de ingreso o no es una fecha válida.')
        if (f.fechaIngreso > hoy) return err('La fecha de ingreso es futura.')

        let operacionFinal: string | null = null
        if (f.operacion) {
            const op = opNormal.get(normalizarNombre(f.operacion))
            if (!op) return err(`La operación "${f.operacion}" no existe en el sistema.`)
            operacionFinal = op
        }

        const mismos = (porNombre.get(normalizarNombre(f.nombre)) ?? []).filter((e) => e.id !== f.cedula)
        if (mismos.length > 0) {
            return {
                ...f,
                estado: 'mismo_nombre',
                operacionFinal,
                motivo: `Mismo nombre que ${mismos.map((m) => `${m.id} (${m.operacion ?? '—'})`).join(', ')}.`,
            }
        }
        return { ...f, estado: 'nuevo', operacionFinal }
    })
}
