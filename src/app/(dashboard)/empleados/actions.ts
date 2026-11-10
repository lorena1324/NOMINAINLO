'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getUserProfile, requireAdmin, requireAdminOrCoordinador } from '@/lib/auth'
import { normalizarNombre, validarFormatoCedula } from '@/lib/asistencia'

export interface EmpleadoExistente {
    id: string
    nombre: string
    operacion: string | null
    status: string
}

type ResultadoEmpleado = {
    success: boolean
    error?: string
    /** La cédula ya está registrada: se devuelve el registro para mostrarlo. */
    existente?: EmpleadoExistente
    /** Mismo nombre con otra cédula: hay que confirmar antes de guardar. */
    posiblesDuplicados?: EmpleadoExistente[]
}

/** Colaboradores con el mismo nombre (sin importar tildes, mayúsculas o espacios). */
async function buscarMismoNombre(
    supabase: Awaited<ReturnType<typeof createClient>>,
    nombre: string,
    excluirCedula?: string,
): Promise<EmpleadoExistente[]> {
    const objetivo = normalizarNombre(nombre)
    const primeraPalabra = objetivo.split(' ')[0]
    if (!primeraPalabra) return []

    // Prefiltro en BD por la primera palabra (las vocales y la ñ van como comodín
    // para que "José" encuentre a "Jose"); la comparación exacta se hace acá.
    const patron = primeraPalabra.replace(/[AEIOUN]/g, '_')
    const { data } = await supabase
        .from('usuarios')
        .select('id, nombre, operacion, status')
        .ilike('nombre', `%${patron}%`)
        .limit(1000)

    return (data ?? []).filter(
        (u) => u.id !== excluirCedula && normalizarNombre(u.nombre) === objetivo,
    ) as EmpleadoExistente[]
}

export async function crearEmpleado(formData: FormData): Promise<ResultadoEmpleado> {
    const profile = await getUserProfile()
    requireAdminOrCoordinador(profile)

    const supabase = await createClient()

    const cedula = ((formData.get('cedula') as string) ?? '').trim()
    const nombre = ((formData.get('nombre') as string) ?? '').trim().replace(/\s+/g, ' ')
    const cargo = ((formData.get('cargo') as string) ?? '').trim()
    const operacion = formData.get('operacion') as string
    const birthdate = formData.get('birthdate') as string
    const confirmarDuplicado = formData.get('confirmar_duplicado') === '1'

    if (!cedula || !nombre || !cargo || !operacion) {
        return { success: false, error: 'Todos los campos marcados con * son obligatorios' }
    }

    const errorCedula = validarFormatoCedula(cedula)
    if (errorCedula) return { success: false, error: errorCedula }

    if (profile.rol === 'coordinador' && operacion !== profile.operacion_nombre) {
        return { success: false, error: 'Solo puedes crear empleados en tu operación' }
    }

    // Cédula única (activa o inactiva): se muestra el registro que ya existe.
    const { data: existente } = await supabase
        .from('usuarios')
        .select('id, nombre, operacion, status')
        .eq('id', cedula)
        .maybeSingle()
    if (existente) {
        return {
            success: false,
            error: `La cédula ${cedula} ya está registrada a nombre de ${existente.nombre} (${existente.status}).`,
            existente: existente as EmpleadoExistente,
        }
    }

    // Posible duplicado: mismo nombre con otra cédula → pedir confirmación.
    if (!confirmarDuplicado) {
        const mismos = await buscarMismoNombre(supabase, nombre)
        if (mismos.length > 0) {
            return {
                success: false,
                error: 'Ya existe un colaborador con el mismo nombre y otra cédula.',
                posiblesDuplicados: mismos,
            }
        }
    }

    const turno_id = formData.get('turno_id') as string | null
    const salarioStr = formData.get('salario') as string | null

    const { error } = await supabase
        .from('usuarios')
        .insert([
            {
                id: cedula,
                nombre,
                cargo,
                operacion,
                birthdate: birthdate ? new Date(birthdate).toISOString() : null,
                status: 'activo',
                turno_id: turno_id || null,
                salario: salarioStr ? parseFloat(salarioStr) : null
            }
        ])

    if (error) {
        if (error.code === '23505') {
            return { success: false, error: 'Ya existe un empleado registrado con esa cédula' }
        }
        console.error('Error insertando empleado:', error)
        return { success: false, error: 'Error interno al registrar empleado' }
    }

    revalidatePath('/empleados')
    return { success: true }
}

export async function editarEmpleado(formData: FormData): Promise<ResultadoEmpleado> {
    const profile = await getUserProfile()
    requireAdminOrCoordinador(profile)

    const supabase = await createClient()

    const cedula = formData.get('cedula') as string
    const nombre = ((formData.get('nombre') as string) ?? '').trim().replace(/\s+/g, ' ')
    const cargo = ((formData.get('cargo') as string) ?? '').trim()
    const operacion = formData.get('operacion') as string
    const status = formData.get('status') as string

    if (!cedula || !nombre || !cargo || !operacion || !status) {
        return { success: false, error: 'Todos los campos son obligatorios (incluida la operación).' }
    }

    if (profile.rol === 'coordinador') {
        const { data: empleado } = await supabase
            .from('usuarios')
            .select('operacion')
            .eq('id', cedula)
            .single()

        if (!empleado || empleado.operacion !== profile.operacion_nombre) {
            return { success: false, error: 'Solo puedes editar empleados de tu operación' }
        }
        // Cambio de operación (CECO): solo el administrador puede mover a otra operación.
        if (operacion !== profile.operacion_nombre) {
            return {
                success: false,
                error: 'Solo un administrador puede cambiar la operación (CECO) de un colaborador.',
            }
        }
    }

    const salarioStr = formData.get('salario') as string | null
    const nuevaCedula = ((formData.get('nueva_cedula') as string | null) ?? '').trim()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
        nombre,
        cargo,
        operacion,
        status,
        salario: salarioStr ? parseFloat(salarioStr) : null
    }

    // El turno solo se toca si el formulario lo envía (antes se borraba en cada edición).
    if (formData.has('turno_id')) {
        updateData.turno_id = (formData.get('turno_id') as string) || null
    }

    // Si se cambio la cedula, actualizar el ID (PK)
    if (nuevaCedula && nuevaCedula !== cedula) {
        const errorCedula = validarFormatoCedula(nuevaCedula)
        if (errorCedula) return { success: false, error: errorCedula }

        const { data: existente } = await supabase
            .from('usuarios')
            .select('id, nombre, operacion, status')
            .eq('id', nuevaCedula)
            .maybeSingle()
        if (existente) {
            return {
                success: false,
                error: `La cédula ${nuevaCedula} ya está registrada a nombre de ${existente.nombre} (${existente.status}).`,
                existente: existente as EmpleadoExistente,
            }
        }
        updateData.id = nuevaCedula
    }

    const { error } = await supabase
        .from('usuarios')
        .update(updateData)
        .eq('id', cedula)

    if (error) {
        console.error('Error actualizando empleado:', error)
        return { success: false, error: 'Error interno al actualizar empleado' }
    }

    revalidatePath('/empleados')
    return { success: true }
}

export async function cambiarEstadoEmpleado(cedula: string, status: string) {
    const profile = await getUserProfile()
    requireAdminOrCoordinador(profile)

    const supabase = await createClient()

    if (profile.rol === 'coordinador') {
        const { data: empleado } = await supabase
            .from('usuarios')
            .select('operacion')
            .eq('id', cedula)
            .single()

        if (!empleado || empleado.operacion !== profile.operacion_nombre) {
            return { success: false, error: 'Solo puedes cambiar el estado de empleados de tu operación' }
        }
    }

    const { error } = await supabase
        .from('usuarios')
        .update({ status })
        .eq('id', cedula)

    if (error) {
        return { success: false, error: 'Error cambiando el estado del empleado' }
    }

    revalidatePath('/empleados')
    return { success: true }
}

/**
 * Eliminar un colaborador creado por error (solo administrador).
 *
 * - Sin marcaciones ni registros asociados → se elimina definitivamente.
 * - Con marcaciones (jornadas) u otros registros → NO se elimina: se inactiva,
 *   para conservar la trazabilidad de sus timbradas.
 */
export async function eliminarEmpleado(
    cedula: string,
): Promise<{ success: boolean; error?: string; accion?: 'eliminado' | 'inactivado'; mensaje?: string }> {
    const profile = await getUserProfile()
    requireAdmin(profile)

    const supabase = await createClient()

    const { data: empleado } = await supabase
        .from('usuarios')
        .select('id, nombre')
        .eq('id', cedula)
        .maybeSingle()
    if (!empleado) return { success: false, error: 'El colaborador no existe.' }

    const { count, error: errCount } = await supabase
        .from('jornadas')
        .select('id', { count: 'exact', head: true })
        .eq('empleado_id', cedula)
    if (errCount) return { success: false, error: 'No se pudo verificar si el colaborador tiene marcaciones.' }

    const inactivar = async (razon: string) => {
        const { error } = await supabase.from('usuarios').update({ status: 'inactivo' }).eq('id', cedula)
        if (error) return { success: false, error: 'No se pudo inactivar al colaborador.' }
        console.log(`[empleados] ${profile.email} INACTIVÓ ${cedula} (${empleado.nombre}): ${razon}`)
        revalidatePath('/empleados')
        return { success: true, accion: 'inactivado' as const, mensaje: razon }
    }

    if ((count ?? 0) > 0) {
        return inactivar(`Tiene ${count} marcación(es) registradas, por eso no se elimina: quedó inactivo.`)
    }

    // Tampoco se elimina si tiene novedades: se perdería ese historial.
    const { count: novedades } = await supabase
        .from('novedades')
        .select('id', { count: 'exact', head: true })
        .eq('usuario_id', cedula)
    if ((novedades ?? 0) > 0) {
        return inactivar(`Tiene ${novedades} novedad(es) registradas, por eso no se elimina: quedó inactivo.`)
    }

    const { error: errDelete } = await supabase.from('usuarios').delete().eq('id', cedula)
    if (errDelete) {
        // Tiene novedades, bolsa u otros registros asociados → se conserva inactivo
        return inactivar('Tiene novedades u otros registros asociados, por eso no se elimina: quedó inactivo.')
    }

    console.log(`[empleados] ${profile.email} ELIMINÓ ${cedula} (${empleado.nombre}): sin marcaciones.`)
    revalidatePath('/empleados')
    return { success: true, accion: 'eliminado', mensaje: 'Colaborador eliminado (no tenía marcaciones).' }
}
