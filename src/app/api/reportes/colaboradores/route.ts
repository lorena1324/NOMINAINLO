import { NextRequest, NextResponse } from 'next/server'
import { fechaColombiaISO, fechaISOaDateUTC, hoyColombiaISO } from '@/lib/asistencia'
import { generarExcelTabla, type ColumnaTabla } from '@/lib/excel/tabla'
import { contextoReporte, respuestaExcel } from '@/lib/reportesAuth'

export const dynamic = 'force-dynamic'

// Estructura fija: no cambiar el orden para que el cruce con RRHH por cédula siga funcionando.
const COLUMNAS: ColumnaTabla[] = [
    { titulo: 'CEDULA', clave: 'cedula', ancho: 16, tipo: 'texto' },
    { titulo: 'NOMBRE COMPLETO', clave: 'nombre', ancho: 40 },
    { titulo: 'CARGO / PERFIL', clave: 'cargo', ancho: 24 },
    { titulo: 'OPERACIÓN (CECO) POR DEFECTO', clave: 'operacion', ancho: 30 },
    { titulo: 'CENTRO DE COSTO', clave: 'ceco', ancho: 16 },
    { titulo: 'TURNO ASIGNADO', clave: 'turno', ancho: 26 },
    { titulo: 'FECHA DE CREACIÓN EN LA APP', clave: 'creado', ancho: 20, tipo: 'fecha' },
    { titulo: 'ESTADO', clave: 'estado', ancho: 12 },
    // Columnas nuevas siempre al final, para no mover las anteriores
    { titulo: 'FECHA DE INGRESO', clave: 'ingreso', ancho: 18, tipo: 'fecha' },
    { titulo: 'AUTORIZÓ TRATAMIENTO DE DATOS', clave: 'autorizo', ancho: 22 },
]

/**
 * GET /api/reportes/colaboradores
 * Plantilla con TODOS los colaboradores (activos e inactivos) para cruce con RRHH.
 * El coordinador solo recibe los de su operación.
 */
export async function GET(request: NextRequest) {
    try {
        const ctx = await contextoReporte(request)
        if (!ctx.ok) return ctx.response
        const { supabase, operaciones } = ctx

        const usuarios: Record<string, unknown>[] = []
        for (let desde = 0; desde < 100000; desde += 1000) {
            let q = supabase.from('usuarios').select('*').order('nombre', { ascending: true })
            if (operaciones.length > 0) q = q.in('operacion', operaciones)
            const { data, error } = await q.range(desde, desde + 999)
            if (error) return NextResponse.json({ error: error.message }, { status: 500 })
            usuarios.push(...(data ?? []))
            if (!data || data.length < 1000) break
        }

        const { data: ops } = await supabase.from('operaciones').select('nombre, codigo')
        const codigo = new Map<string, string>()
        for (const op of ops ?? []) codigo.set(op.nombre, op.codigo ?? '')

        const { data: turnos } = await supabase.from('turnos').select('id, nombre, hora_inicio, hora_fin')
        const turno = new Map<string, string>()
        for (const t of turnos ?? []) {
            turno.set(t.id, `${t.nombre} (${String(t.hora_inicio).slice(0, 5)}-${String(t.hora_fin).slice(0, 5)})`)
        }

        const filas = usuarios.map((u) => {
            const operacion = (u.operacion as string) ?? ''
            return {
                cedula: String(u.id),
                nombre: String(u.nombre ?? ''),
                cargo: (u.cargo as string) ?? '',
                operacion: operacion || 'SIN OPERACIÓN',
                ceco: codigo.get(operacion) ?? '',
                turno: u.turno_id ? (turno.get(u.turno_id as string) ?? '') : '',
                creado: u.created_at ? fechaISOaDateUTC(fechaColombiaISO(u.created_at as string)) : null,
                estado: u.status === 'activo' ? 'ACTIVO' : 'INACTIVO',
                ingreso: u.fecha_ingreso ? fechaISOaDateUTC(String(u.fecha_ingreso).slice(0, 10)) : null,
                autorizo: u.autorizacion_datos_en ? 'SI' : 'NO',
            }
        })

        const buffer = await generarExcelTabla('Colaboradores', COLUMNAS, filas)
        return respuestaExcel(buffer, `colaboradores_${hoyColombiaISO()}.xlsx`)
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error interno'
        console.error('[API /reportes/colaboradores]', err)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
