import { NextRequest, NextResponse } from 'next/server'
import { fechaColombiaISO, fechaISOaDateUTC } from '@/lib/asistencia'
import { construirMallaAsistencia, detectarInconsistencias } from '@/lib/asistenciaDatos'
import { generarExcelTabla, type ColumnaTabla } from '@/lib/excel/tabla'
import { contextoReporte, esFechaISO, respuestaExcel } from '@/lib/reportesAuth'

export const dynamic = 'force-dynamic'

const COLUMNAS: ColumnaTabla[] = [
    { titulo: 'TIPO DE INCONSISTENCIA', clave: 'tipo', ancho: 32 },
    { titulo: 'FECHA', clave: 'fecha', ancho: 13, tipo: 'fecha' },
    { titulo: 'CEDULA', clave: 'cedula', ancho: 16, tipo: 'texto' },
    { titulo: 'NOMBRE', clave: 'nombre', ancho: 38 },
    { titulo: 'OPERACIÓN', clave: 'operacion', ancho: 26 },
    { titulo: 'DETALLE', clave: 'detalle', ancho: 70 },
    { titulo: 'QUÉ HACER', clave: 'accion', ancho: 60 },
]

/**
 * GET /api/reportes/inconsistencias?start=YYYY-MM-DD&end=YYYY-MM-DD&op=OP1,OP2
 * Todo lo que conviene revisar antes de cerrar la quincena.
 */
export async function GET(request: NextRequest) {
    try {
        const ctx = await contextoReporte(request)
        if (!ctx.ok) return ctx.response
        const { supabase, operaciones } = ctx

        const { searchParams } = new URL(request.url)
        const start = searchParams.get('start')
        const end = searchParams.get('end')
        if (!esFechaISO(start) || !esFechaISO(end)) {
            return NextResponse.json({ error: 'Faltan parámetros start y end (AAAA-MM-DD).' }, { status: 400 })
        }

        const malla = await construirMallaAsistencia(supabase, { start, end, operaciones })

        // Horas extra aún sin aprobar de las jornadas del período
        const jornadaPorId = new Map(
            malla.filas.filter((f) => f.jornada).map((f) => [f.jornada!.id, f.jornada!]),
        )
        const { data: pendientes } = await supabase
            .from('aprobaciones_extras')
            .select('empleado_id, jornada_id, minutos_solicitados')
            .eq('estado', 'PENDIENTE')
        const extrasPendientes = (pendientes ?? [])
            .filter((p) => jornadaPorId.has(p.jornada_id))
            .map((p) => {
                const j = jornadaPorId.get(p.jornada_id)!
                return {
                    empleado_id: p.empleado_id as string,
                    fecha: fechaColombiaISO(j.entrada),
                    minutos: p.minutos_solicitados as number,
                    operacion: j.operacion,
                }
            })

        const lista = detectarInconsistencias(malla.filas, malla.colaboradores, extrasPendientes)
        const filas = lista.map((i) => ({
            ...i,
            fecha: i.fecha ? fechaISOaDateUTC(i.fecha) : null,
        }))

        const buffer = await generarExcelTabla('Inconsistencias', COLUMNAS, filas)
        return respuestaExcel(buffer, `inconsistencias_${start}_${end}.xlsx`)
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error interno'
        console.error('[API /reportes/inconsistencias]', err)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
