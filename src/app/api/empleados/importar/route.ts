import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/auth'
import { registrarAuditoria } from '@/lib/auditoria'
import { leerExcelEmpleados, revisarFilas, type EmpleadoBD, type FilaRevisada } from '@/lib/importarEmpleados'

export const dynamic = 'force-dynamic'

const TAMANO_MAXIMO = 5 * 1024 * 1024 // 5 MB

export interface ResultadoImportacion {
    filas: FilaRevisada[]
    tieneColumnaOperacion: boolean
    /** Solo cuando accion = importar */
    importado?: { creados: number; actualizados: number; reactivados: number; errores: string[] }
}

/**
 * POST /api/empleados/importar (solo administrador)
 * FormData:
 *   archivo                 .xlsx
 *   accion                  'revisar' (vista previa, no guarda nada) | 'importar'
 *   incluir_mismo_nombre    '1' = crear también los que tienen el mismo nombre que otro colaborador
 *   actualizar_existentes   '1' = actualizar cargo, salario, fecha de ingreso y nacimiento de los ya registrados
 *   reactivar_inactivos     '1' = pasar a activo a los ya registrados que estén inactivos
 * La operación no se elige aquí: si el archivo no trae columna OPERACION, el colaborador
 * toma la de la tablet (cuenta de la operación) donde marque por primera vez.
 * La operación de los ya registrados NO se cambia aquí (se usa "Cambiar operación").
 */
export async function POST(request: NextRequest) {
    const profile = await getUserProfile()
    if (!profile || profile.rol !== 'admin') {
        return NextResponse.json({ error: 'Solo el administrador puede importar personal.' }, { status: 403 })
    }

    const form = await request.formData()
    const archivo = form.get('archivo')
    if (!(archivo instanceof File) || archivo.size === 0) {
        return NextResponse.json({ error: 'Adjunta el archivo de Excel.' }, { status: 400 })
    }
    if (archivo.size > TAMANO_MAXIMO) {
        return NextResponse.json({ error: 'El archivo supera 5 MB.' }, { status: 400 })
    }
    if (!/\.xlsx$/i.test(archivo.name)) {
        return NextResponse.json({ error: 'El archivo debe ser .xlsx (Excel). Si es .xls, guárdalo como .xlsx.' }, { status: 400 })
    }

    const accion = form.get('accion') === 'importar' ? 'importar' : 'revisar'
    const incluirMismoNombre = form.get('incluir_mismo_nombre') === '1'
    const actualizarExistentes = form.get('actualizar_existentes') === '1'
    const reactivarInactivos = form.get('reactivar_inactivos') === '1'

    let lectura
    try {
        lectura = await leerExcelEmpleados(await archivo.arrayBuffer())
    } catch {
        return NextResponse.json({ error: 'No se pudo leer el archivo. Verifica que sea un Excel válido.' }, { status: 400 })
    }
    if (lectura.faltantes.length > 0) {
        return NextResponse.json(
            { error: `Al archivo le faltan las columnas: ${lectura.faltantes.join(', ')}.` },
            { status: 400 },
        )
    }
    if (lectura.filas.length === 0) {
        return NextResponse.json({ error: 'El archivo no tiene filas con colaboradores.' }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: ops } = await supabase.from('operaciones').select('nombre')
    const operaciones = (ops ?? []).map((o) => o.nombre as string)

    const existentes: EmpleadoBD[] = []
    for (let desde = 0; desde < 100000; desde += 1000) {
        const { data, error } = await supabase
            .from('usuarios')
            .select('id, nombre, cargo, operacion, status, salario, fecha_ingreso, birthdate')
            .range(desde, desde + 999)
        if (error) return NextResponse.json({ error: 'No se pudo consultar el personal actual.' }, { status: 500 })
        existentes.push(...((data ?? []) as EmpleadoBD[]))
        if (!data || data.length < 1000) break
    }

    const filas = revisarFilas(lectura.filas, existentes, operaciones)

    if (accion === 'revisar') {
        return NextResponse.json({ filas, tieneColumnaOperacion: lectura.tieneColumnaOperacion } satisfies ResultadoImportacion)
    }

    // ─── Importar ──────────────────────────────────────────────────────
    const errores: string[] = []
    const aCrear = filas.filter((f) => f.estado === 'nuevo' || (incluirMismoNombre && f.estado === 'mismo_nombre'))

    let creados = 0
    for (let i = 0; i < aCrear.length; i += 200) {
        const lote = aCrear.slice(i, i + 200).map((f) => ({
            id: f.cedula,
            nombre: f.nombre,
            cargo: f.cargo,
            operacion: f.operacionFinal,
            birthdate: f.birthdate,
            fecha_ingreso: f.fechaIngreso,
            salario: f.salario,
            status: 'activo',
        }))
        const { error } = await supabase.from('usuarios').insert(lote)
        if (!error) {
            creados += lote.length
            continue
        }
        // Si falla el lote, se intenta uno por uno para saber cuál falló
        for (const fila of lote) {
            const { error: e } = await supabase.from('usuarios').insert(fila)
            if (e) errores.push(`${fila.id} ${fila.nombre}: ${e.code === '23505' ? 'la cédula ya existe' : e.message}`)
            else creados++
        }
    }

    let actualizados = 0
    let reactivados = 0
    const yaRegistrados = filas.filter((f) => f.estado === 'existente')
    for (const f of yaRegistrados) {
        const datos: Record<string, unknown> = {}
        if (actualizarExistentes && f.cambios && f.cambios.length > 0) {
            if (f.cargo) datos.cargo = f.cargo
            if (f.salario !== null) datos.salario = f.salario
            if (f.cambios.some((c) => c.startsWith('ingreso'))) datos.fecha_ingreso = f.fechaIngreso
            if (f.cambios.some((c) => c.startsWith('nacimiento'))) datos.birthdate = f.birthdate
        }
        if (reactivarInactivos && f.inactivo) datos.status = 'activo'
        if (Object.keys(datos).length === 0) continue
        const { error } = await supabase.from('usuarios').update(datos).eq('id', f.cedula)
        if (error) {
            errores.push(`${f.cedula} ${f.nombre}: no se pudo actualizar`)
            continue
        }
        if (datos.status) reactivados++
        if (Object.keys(datos).some((k) => k !== 'status')) actualizados++
    }

    await registrarAuditoria(supabase, {
        accion: 'IMPORTAR_COLABORADORES',
        entidad: 'colaborador',
        autor: profile.email,
        motivo: `Importación desde Excel: ${archivo.name}`,
        detalle: {
            archivo: archivo.name,
            filas: filas.length,
            creados,
            actualizados,
            reactivados,
            errores: errores.length,
            cedulas_creadas: aCrear.map((f) => f.cedula).slice(0, 1000),
        },
    })

    revalidatePath('/empleados')
    return NextResponse.json({
        filas,
        tieneColumnaOperacion: lectura.tieneColumnaOperacion,
        importado: { creados, actualizados, reactivados, errores },
    } satisfies ResultadoImportacion)
}
