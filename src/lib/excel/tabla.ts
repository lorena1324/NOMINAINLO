import ExcelJS from 'exceljs'

export interface ColumnaTabla {
    titulo: string
    clave: string
    ancho: number
    /** 'texto' fuerza formato texto (cédulas); 'fecha' exporta fecha real dd/mm/aaaa. */
    tipo?: 'texto' | 'fecha' | 'numero'
}

/**
 * Genera un Excel de una sola hoja con encabezado fijo, filtros y columnas
 * de estructura estable (misma posición en cada descarga).
 */
export async function generarExcelTabla(
    nombreHoja: string,
    columnas: ColumnaTabla[],
    filas: Record<string, string | number | Date | null>[],
): Promise<Buffer> {
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Inlotrans Asistencia'
    wb.created = new Date()
    const ws = wb.addWorksheet(nombreHoja, { views: [{ state: 'frozen', ySplit: 1 }] })

    ws.columns = columnas.map((c) => ({ header: c.titulo, key: c.clave, width: c.ancho }))

    ws.getRow(1).eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
        cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
        }
    })

    for (const fila of filas) {
        const row = ws.addRow(fila)
        row.font = { name: 'Calibri', size: 10 }
        columnas.forEach((c, i) => {
            const cell = row.getCell(i + 1)
            if (c.tipo === 'texto') {
                cell.numFmt = '@'
                if (cell.value !== null && cell.value !== undefined) cell.value = String(cell.value)
            }
            if (c.tipo === 'fecha') cell.numFmt = 'dd/mm/yyyy'
        })
    }

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } }

    const buffer = await wb.xlsx.writeBuffer()
    return Buffer.from(buffer)
}
