import ExcelJS from 'exceljs'

// ════════════════════════════════════════════════════════════════════
// Tipos
// ════════════════════════════════════════════════════════════════════

export interface LineaNomina {
    fecha: Date                // fecha real (medianoche UTC) — Excel la muestra en formato largo
    cargo: string
    cedula: string
    nombre: string
    horaIn: number             // hora entera truncada (6, 14, 22)
    horaOut: number | null     // hora entera truncada; null = salida pendiente
    almuerzo: number           // horas enteras (0 o 1)
    horas: number              // OUT - IN (directo, entero, consistente)
    extraDiurna: number        // Math.round(minutos/60)
    extraNocturna: number
    extraFestivaDiurna: number
    extraFestivaNocturna: number
    recargoNocturno: number
    recargoFestivoNocturno: number
    recargoFestivo: number
    operacion: string
    codigoOperacion: string
    detalleOperacion: string
    novedad: string
    detalleNovedad: string
    // ─── Columnas de control (al final, no alteran el formato original) ───
    estado: string             // Asistió / Sin asistencia / Novedad / Pendiente / Cierre automático
    domingo: boolean
    festivo: boolean
    inasistencia: boolean
    retardoMin: number | null  // minutos de retardo; null = sin turno para comparar
    turno: string
    validar: string            // excepciones que el coordinador debe revisar
}

export interface RetardoResumen {
    cedula: string
    nombre: string
    operacion: string
    cantidad: number
    minutos: number
}

/** Formato "fecha larga" de Excel en español: lunes, 3 de noviembre de 2026 */
export const FORMATO_FECHA_LARGA = '[$-240A]dddd, d" de "mmmm" de "yyyy'

export interface TarifaConCodigo {
    tipo_hora: string
    precio_por_hora: number
    codigo_nomina: string | null
}

// Mapeo de columnas especiales → posición en el array (para totales)
const COLS_ESPECIALES = [
    { key: 'extraDiurna' as const,           label: 'H.E',    concepto: 'H.E' },
    { key: 'extraNocturna' as const,         label: 'H.E.N',  concepto: 'H.E.N' },
    { key: 'extraFestivaDiurna' as const,    label: 'E.F.D',  concepto: 'E.F.D' },
    { key: 'extraFestivaNocturna' as const,  label: 'E.F.N',  concepto: 'E.F.N' },
    { key: 'recargoNocturno' as const,       label: 'R.N',    concepto: 'R.N' },
    { key: 'recargoFestivoNocturno' as const,label: 'R.F.N',  concepto: 'R.F.N' },
    { key: 'recargoFestivo' as const,        label: 'R.F',    concepto: 'R.F' },
]

// Mapeo tipo_hora → key en LineaNomina (para buscar la tarifa de cada columna)
const TIPO_HORA_A_COL: Record<string, (typeof COLS_ESPECIALES)[number]['key']> = {
    extra: 'extraDiurna',
    extraNocturno: 'extraNocturna',
    extraDominicalFestivo: 'extraFestivaDiurna',
    extraNocturnaDominicalFestivo: 'extraFestivaNocturna',
    nocturno: 'recargoNocturno',
    domingoFestivoNocturno: 'recargoFestivoNocturno',
    festivo: 'recargoFestivo',
    domingo: 'recargoFestivo',
}

const HORAS_LEGALES_MES = 220

// ════════════════════════════════════════════════════════════════════
// Estilos
// ════════════════════════════════════════════════════════════════════

const FONT_DEFAULT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10 }
const FONT_HEADER: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
const FONT_BOLD: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10, bold: true }

const FILL_RED: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } }
const FILL_GREEN: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF008000' } }
const FILL_YELLOW: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
const FILL_LIGHT_YELLOW: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFCC' } }

const BORDER_THIN: Partial<ExcelJS.Borders> = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
}

const ALIGN_CENTER: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' }

// ════════════════════════════════════════════════════════════════════
// Generador
// ════════════════════════════════════════════════════════════════════

export async function generarExcelNomina(
    lineas: LineaNomina[],
    tarifas: TarifaConCodigo[],
    retardos: RetardoResumen[] = [],
): Promise<Buffer> {
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Inlotrans Asistencia'
    wb.created = new Date()
    const ws = wb.addWorksheet('Nómina', { views: [{ state: 'frozen', ySplit: 4 }] })

    // ─── Columnas ───────────────────────────────────────────────
    // A=fecha, B=cargo, C=cedula, D=nombre, E=IN, F=OUT, G=ALMU, H=HORAS,
    // I=H.E.D, J=H.E.N, K=E.F.D, L=E.F.N, M=R.N, N=R.F.N, O=R.F,
    // P=OPERACION, Q=CENTRO COSTO, R=DETALLE OP, S=NOVEDAD, T=DETALLE NOV
    ws.columns = [
        { key: 'fecha',                width: 34 },
        { key: 'cargo',                width: 18 },
        { key: 'cedula',               width: 16 },
        { key: 'nombre',               width: 35 },
        { key: 'horaIn',               width: 6 },
        { key: 'horaOut',              width: 6 },
        { key: 'almuerzo',             width: 6 },
        { key: 'horas',               width: 8 },
        { key: 'extraDiurna',          width: 10 },
        { key: 'extraNocturna',        width: 10 },
        { key: 'extraFestivaDiurna',   width: 10 },
        { key: 'extraFestivaNocturna', width: 10 },
        { key: 'recargoNocturno',      width: 10 },
        { key: 'recargoFestivoNocturno', width: 10 },
        { key: 'recargoFestivo',       width: 10 },
        { key: 'operacion',            width: 22 },
        { key: 'codigoOperacion',      width: 14 },
        { key: 'detalleOperacion',     width: 20 },
        { key: 'novedad',              width: 22 },
        { key: 'detalleNovedad',       width: 30 },
        { key: 'estado',               width: 30 },
        { key: 'domingo',              width: 11 },
        { key: 'festivo',              width: 11 },
        { key: 'inasistencia',         width: 14 },
        { key: 'retardoMin',           width: 15 },
        { key: 'turno',                width: 18 },
        { key: 'validar',              width: 55 },
    ]

    // ─── Fila 1: Grupo headers ──────────────────────────────────
    const row1 = ws.getRow(1)
    // "HORARIO MILITAR" sobre E-F
    ws.mergeCells('E1:F1')
    row1.getCell('E').value = 'HORARIO MILITAR'
    row1.getCell('E').fill = FILL_GREEN
    row1.getCell('E').font = FONT_HEADER
    row1.getCell('E').alignment = ALIGN_CENTER

    // "NO MODIFICAR EL FORMATO" sobre G-H
    ws.mergeCells('G1:H1')
    row1.getCell('G').value = 'NO MODIFICAR EL FORMATO'
    row1.getCell('G').fill = FILL_RED
    row1.getCell('G').font = FONT_HEADER
    row1.getCell('G').alignment = ALIGN_CENTER

    // Tipos de hora sobre I-O (individual cada uno)
    const tipoHeaders = ['H.E.D', 'H.E.N', 'E.F.D', 'E.F.N', 'R.N', 'R.F.N', 'R.F']
    const tipoCols = ['I', 'J', 'K', 'L', 'M', 'N', 'O']
    tipoCols.forEach((col, i) => {
        const cell = row1.getCell(col)
        cell.value = tipoHeaders[i]
        cell.fill = FILL_RED
        cell.font = FONT_HEADER
        cell.alignment = ALIGN_CENTER
    })

    // "COLOCAR DONDE SE COBRARÁ" sobre P-Q
    ws.mergeCells('P1:Q1')
    row1.getCell('P').value = 'COLOCAR DONDE SE COBRARÁ A LA PERSONA'
    row1.getCell('P').fill = FILL_GREEN
    row1.getCell('P').font = FONT_HEADER
    row1.getCell('P').alignment = ALIGN_CENTER

    // ─── Fila 2: Headers principales ────────────────────────────
    const row2 = ws.getRow(2)
    const headers2 = [
        '', '', 'CEDULAS SIN PUNTO Y CORRECTAS',
        'DEBE ESTAR POR APELLIDO Y NOMBRE (COMPLETOS)', '', '', '', '',
    ]
    headers2.forEach((h, i) => {
        if (h) {
            const cell = row2.getCell(i + 1)
            cell.value = h
            cell.font = FONT_BOLD
            cell.alignment = { ...ALIGN_CENTER, wrapText: true }
        }
    })

    // ─── Fila 3: Sub-headers de columna ─────────────────────────
    const row3 = ws.getRow(3)
    const subHeaders = [
        'FECHA', 'CARGO', 'CEDULA', 'NOMBRE',
        'IN', 'OUT', 'ALMU', 'HORAS',
        ...tipoHeaders,
        'OPERACIÓN', 'CENTRO DE COSTO', 'DETALLE DE LA OPERACIÓN',
        'NOVEDAD', 'DETALLE DE LA NOVEDAD',
        'ESTADO', 'DOMINGO', 'FESTIVO', 'INASISTENCIA', 'RETARDO (MIN)', 'TURNO', 'POR VALIDAR',
    ]
    subHeaders.forEach((h, i) => {
        const cell = row3.getCell(i + 1)
        cell.value = h
        cell.font = FONT_BOLD
        cell.fill = i < 8 ? FILL_RED : i < 15 ? FILL_RED : i < 18 ? FILL_YELLOW : FILL_YELLOW
        cell.font = i < 15 ? FONT_HEADER : FONT_BOLD
        cell.alignment = ALIGN_CENTER
        cell.border = BORDER_THIN
    })

    // ─── Fila 4: Códigos de nómina debajo de cada tipo de hora ──
    const row4 = ws.getRow(4)
    const tarifaMap = new Map(tarifas.map((t) => [t.tipo_hora, t]))
    const codigosOrden = ['extra', 'extraNocturno', 'extraDominicalFestivo', 'extraNocturnaDominicalFestivo', 'nocturno', 'domingoFestivoNocturno', 'festivo']
    codigosOrden.forEach((tipo, i) => {
        const cell = row4.getCell(9 + i) // columnas I-O
        const tarifa = tarifaMap.get(tipo)
        cell.value = tarifa?.codigo_nomina ? Number(tarifa.codigo_nomina) : ''
        cell.font = FONT_BOLD
        cell.alignment = ALIGN_CENTER
        cell.border = BORDER_THIN
    })

    // ─── Datos ──────────────────────────────────────────────────
    let dataStartRow = 5
    const totales = {
        horaIn: 0, horaOut: 0, almuerzo: 0, horas: 0,
        extraDiurna: 0, extraNocturna: 0, extraFestivaDiurna: 0,
        extraFestivaNocturna: 0, recargoNocturno: 0,
        recargoFestivoNocturno: 0, recargoFestivo: 0,
    }

    for (const linea of lineas) {
        const row = ws.addRow([
            linea.fecha,
            linea.cargo,
            linea.cedula,
            linea.nombre,
            linea.horaIn,
            linea.horaOut,
            linea.almuerzo,
            linea.horas,
            linea.extraDiurna,
            linea.extraNocturna,
            linea.extraFestivaDiurna,
            linea.extraFestivaNocturna,
            linea.recargoNocturno,
            linea.recargoFestivoNocturno,
            linea.recargoFestivo,
            linea.operacion,
            linea.codigoOperacion,
            linea.detalleOperacion,
            linea.novedad,
            linea.detalleNovedad,
            linea.estado,
            linea.domingo ? 'SI' : 'NO',
            linea.festivo ? 'SI' : 'NO',
            linea.inasistencia ? 'SI' : 'NO',
            linea.retardoMin,
            linea.turno,
            linea.validar,
        ])
        // Fecha real de Excel (permite ordenar y filtrar por fecha) y cédula como texto
        row.getCell(1).numFmt = FORMATO_FECHA_LARGA
        row.getCell(3).numFmt = '@'

        row.font = FONT_DEFAULT
        row.alignment = { vertical: 'middle' }
        for (let c = 5; c <= 15; c++) {
            row.getCell(c).alignment = ALIGN_CENTER
        }
        for (let c = 22; c <= 25; c++) {
            row.getCell(c).alignment = ALIGN_CENTER
        }
        if (linea.inasistencia) row.getCell(21).font = { ...FONT_DEFAULT, bold: true, color: { argb: 'FFC00000' } }
        if (linea.validar) row.getCell(27).font = { ...FONT_DEFAULT, color: { argb: 'FFC00000' } }

        // Acumular totales
        totales.horaIn += linea.horaIn
        totales.horaOut += linea.horaOut ?? 0
        totales.almuerzo += linea.almuerzo
        totales.horas += linea.horas
        totales.extraDiurna += linea.extraDiurna
        totales.extraNocturna += linea.extraNocturna
        totales.extraFestivaDiurna += linea.extraFestivaDiurna
        totales.extraFestivaNocturna += linea.extraFestivaNocturna
        totales.recargoNocturno += linea.recargoNocturno
        totales.recargoFestivoNocturno += linea.recargoFestivoNocturno
        totales.recargoFestivo += linea.recargoFestivo
    }

    // ─── Tabla de totales ───────────────────────────────────────
    ws.addRow([]) // fila vacía
    ws.addRow([]) // fila vacía

    // Fila SUBTOTALES
    const rowSubtotales = ws.addRow([])
    rowSubtotales.getCell(5).value = totales.horaIn
    rowSubtotales.getCell(6).value = totales.horaOut
    rowSubtotales.getCell(7).value = totales.almuerzo
    rowSubtotales.getCell(8).value = totales.horas
    rowSubtotales.getCell(9).value = totales.extraDiurna
    rowSubtotales.getCell(10).value = totales.extraNocturna
    rowSubtotales.getCell(11).value = totales.extraFestivaDiurna
    rowSubtotales.getCell(12).value = totales.extraFestivaNocturna
    rowSubtotales.getCell(13).value = totales.recargoNocturno
    rowSubtotales.getCell(14).value = totales.recargoFestivoNocturno
    rowSubtotales.getCell(15).value = totales.recargoFestivo
    for (let c = 5; c <= 15; c++) {
        rowSubtotales.getCell(c).font = FONT_BOLD
        rowSubtotales.getCell(c).alignment = ALIGN_CENTER
        rowSubtotales.getCell(c).border = BORDER_THIN
    }

    // Fila CONCEPTO
    const rowConcepto = ws.addRow([])
    const conceptos = ['', '', '', '', '', '', '', '', 'H.E', 'H.E.N', 'E.F.D', 'E.F.N', 'R.N', 'R.F.N', 'R.F']
    conceptos.forEach((c, i) => {
        if (c) {
            const cell = rowConcepto.getCell(i + 1)
            cell.value = c
            cell.font = FONT_BOLD
            cell.alignment = ALIGN_CENTER
            cell.fill = FILL_LIGHT_YELLOW
            cell.border = BORDER_THIN
        }
    })

    // Fila CÓDIGO NOMINA
    const rowCodigos = ws.addRow([])
    rowCodigos.getCell(4).value = 'CÓDIGO NOMINA'
    rowCodigos.getCell(4).font = FONT_BOLD
    codigosOrden.forEach((tipo, i) => {
        const tarifa = tarifaMap.get(tipo)
        const cell = rowCodigos.getCell(9 + i)
        cell.value = tarifa?.codigo_nomina ? Number(tarifa.codigo_nomina) : ''
        cell.font = FONT_BOLD
        cell.alignment = ALIGN_CENTER
        cell.fill = FILL_LIGHT_YELLOW
        cell.border = BORDER_THIN
    })

    // Fila VALOR por hora
    const rowValor = ws.addRow([])
    rowValor.getCell(4).value = 'VALOR'
    rowValor.getCell(4).font = FONT_BOLD
    codigosOrden.forEach((tipo, i) => {
        const tarifa = tarifaMap.get(tipo)
        const cell = rowValor.getCell(9 + i)
        cell.value = tarifa?.precio_por_hora ?? 0
        cell.numFmt = '#,##0'
        cell.font = FONT_BOLD
        cell.alignment = ALIGN_CENTER
        cell.fill = FILL_YELLOW
        cell.border = BORDER_THIN
    })

    // Fila TOTAL (horas × valor)
    const rowTotal = ws.addRow([])
    rowTotal.getCell(4).value = 'TOTAL'
    rowTotal.getCell(4).font = FONT_BOLD
    const totalesEspeciales = [
        totales.extraDiurna, totales.extraNocturna, totales.extraFestivaDiurna,
        totales.extraFestivaNocturna, totales.recargoNocturno,
        totales.recargoFestivoNocturno, totales.recargoFestivo,
    ]
    codigosOrden.forEach((tipo, i) => {
        const tarifa = tarifaMap.get(tipo)
        const valor = (tarifa?.precio_por_hora ?? 0) * totalesEspeciales[i]
        const cell = rowTotal.getCell(9 + i)
        cell.value = valor
        cell.numFmt = '$#,##0'
        cell.font = FONT_BOLD
        cell.alignment = ALIGN_CENTER
        cell.border = BORDER_THIN
    })

    // Fila vacía
    ws.addRow([])

    // Fila PORCENTAJE
    const tarifaNormal = tarifaMap.get('normal')?.precio_por_hora ?? 7959
    const rowPorcentaje = ws.addRow([])
    rowPorcentaje.getCell(4).value = 'PORCENTAJE'
    rowPorcentaje.getCell(4).font = FONT_BOLD
    codigosOrden.forEach((tipo, i) => {
        const tarifa = tarifaMap.get(tipo)
        const pct = tarifa ? Math.round(((tarifa.precio_por_hora / tarifaNormal) - 1) * 100) : 0
        const cell = rowPorcentaje.getCell(9 + i)
        cell.value = `${pct}%`
        cell.font = FONT_BOLD
        cell.alignment = ALIGN_CENTER
        cell.fill = FILL_YELLOW
        cell.border = BORDER_THIN
    })

    // Fila salario base y valor hora
    const salarioBase = Math.round(tarifaNormal * HORAS_LEGALES_MES)
    const rowSalario = ws.addRow([])
    rowSalario.getCell(5).value = salarioBase
    rowSalario.getCell(5).numFmt = '#,##0'
    rowSalario.getCell(5).font = FONT_BOLD
    rowSalario.getCell(6).value = tarifaNormal
    rowSalario.getCell(6).numFmt = '#,##0'
    rowSalario.getCell(6).font = FONT_BOLD

    codigosOrden.forEach((tipo, i) => {
        const tarifa = tarifaMap.get(tipo)
        const cell = rowSalario.getCell(9 + i)
        cell.value = tarifa?.precio_por_hora ?? 0
        cell.numFmt = '#,##0'
        cell.alignment = ALIGN_CENTER
    })

    // ─── Auto-filter en headers ─────────────────────────────────
    ws.autoFilter = {
        from: { row: 3, column: 1 },
        to: { row: 3, column: 27 },
    }

    // ─── Hoja 2: Retardos por colaborador ───────────────────────
    const wsRet = wb.addWorksheet('Retardos', { views: [{ state: 'frozen', ySplit: 1 }] })
    wsRet.columns = [
        { header: 'CEDULA', key: 'cedula', width: 16 },
        { header: 'NOMBRE', key: 'nombre', width: 38 },
        { header: 'OPERACIÓN', key: 'operacion', width: 26 },
        { header: 'N° DE RETARDOS', key: 'cantidad', width: 18 },
        { header: 'TOTAL MINUTOS', key: 'minutos', width: 16 },
    ]
    wsRet.getRow(1).eachCell((cell) => {
        cell.font = FONT_HEADER
        cell.fill = FILL_RED
        cell.alignment = ALIGN_CENTER
        cell.border = BORDER_THIN
    })
    for (const r of retardos) {
        const row = wsRet.addRow(r)
        row.font = FONT_DEFAULT
        row.getCell(1).numFmt = '@'
    }
    if (retardos.length === 0) {
        wsRet.addRow({ nombre: 'Sin retardos en el período (o sin turnos configurados para comparar).' })
    }
    wsRet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } }

    const buffer = await wb.xlsx.writeBuffer()
    return Buffer.from(buffer)
}
