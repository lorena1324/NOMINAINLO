'use server'

import { createClient } from '@/lib/supabase/server'
import {
    abrirJornada,
    cerrarJornada,
    marcarCierreAutomatico,
    obtenerJornadaActiva,
    obtenerUltimaSalida,
    tieneJornadasInconsistentes,
} from '@/lib/jornadas'
import {
    MINUTOS_MARCACION_DUPLICADA,
    UMBRAL_CIERRE_AUTOMATICO_HORAS,
    superaLimiteAbierta,
} from '@/lib/asistencia'

export async function validarCedula(cedula: string) {
    if (!cedula) return { success: false, error: 'Cédula vacía' }

    // El formato estricto de cédula se exige al CREAR colaboradores, no aquí:
    // así ningún colaborador ya registrado queda bloqueado para marcar.
    const supabase = await createClient()
    const { data: usuario, error } = await supabase
        .from('usuarios')
        .select('id, nombre, status, operacion')
        .eq('id', cedula)
        .maybeSingle()

    if (error && error.code !== 'PGRST116') {
        console.error('Error validando cédula:', error)
    }
    if (!usuario) return { success: false, error: 'Cédula no registrada. Consulta con tu coordinador.' }
    if (usuario.status === 'inactivo') {
        return { success: false, error: 'Usuario inactivo. No puede registrar asistencias.' }
    }
    return { success: true, data: usuario }
}

/**
 * Jornada activa del empleado. Si lleva abierta más del tiempo límite (15 h),
 * se cierra de forma automática aquí mismo — sin esperar al proceso nocturno —
 * para que el colaborador pueda marcar su nueva ENTRADA y el coordinador reciba
 * la novedad por validar.
 */
async function jornadaActivaVigente(cedula: string) {
    const jornada = await obtenerJornadaActiva(cedula)
    if (!jornada) return { jornada: null, cierreAutomatico: false }
    if (superaLimiteAbierta(jornada.entrada)) {
        await marcarCierreAutomatico(jornada)
        return { jornada: null, cierreAutomatico: true }
    }
    return { jornada, cierreAutomatico: false }
}

export async function getEstadoJornada(cedula: string) {
    const { jornada } = await jornadaActivaVigente(cedula)
    const tieneInconsistentes = await tieneJornadasInconsistentes(cedula)

    if (!jornada) {
        return {
            success: true,
            data: { estado: 'sin_turno' as const, tieneInconsistentes, jornada: null },
        }
    }

    const fechaEntrada = new Date(jornada.entrada)
    const hora = fechaEntrada.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })

    return {
        success: true,
        data: {
            estado: 'trabajando' as const,
            tieneInconsistentes,
            jornada,
            info: `En turno desde ${hora}`,
        },
    }
}

interface RegistrarAsistenciaInput {
    id: string
    usuario_nombre: string
    operacion: string
    tipo: 'ENTRADA' | 'SALIDA'
    // La foto es obligatoria en el cliente pero NO se almacena. Se recibe
    // como marcador de que el empleado pasó el ritual del kiosco.
    foto_base64: string | null
}

export async function registrarAsistenciaAPI(input: RegistrarAsistenciaInput) {
    try {
        if (!input.foto_base64) {
            return { success: false, error: 'Es obligatorio registrar una foto.' }
        }
        // Nota: la foto se recibe pero se descarta — no se persiste en ningún lado.

        // El servidor vuelve a validar al colaborador: activo y con operación asignada.
        const validacion = await validarCedula(input.id)
        if (!validacion.success || !validacion.data) {
            return { success: false, error: validacion.error ?? 'Cédula no válida.' }
        }
        // La operación sale de la ficha del colaborador (operación por defecto).
        // Solo si no tiene ninguna asignada se acepta la que eligió en pantalla.
        const operacion = validacion.data.operacion || input.operacion
        if (!operacion) {
            return {
                success: false,
                error: 'No tienes una operación asignada. Pide a tu coordinador que la asigne antes de marcar.',
            }
        }

        const { jornada: activa, cierreAutomatico } = await jornadaActivaVigente(input.id)
        const ahora = Date.now()
        const limiteDuplicadaMs = MINUTOS_MARCACION_DUPLICADA * 60000

        if (input.tipo === 'ENTRADA') {
            if (activa) {
                return {
                    success: false,
                    error: 'Ya tienes una jornada activa. Registra la salida primero.',
                }
            }

            // Marcación duplicada: una entrada pegada a la salida que acaba de registrar
            const ultimaSalida = await obtenerUltimaSalida(input.id)
            if (ultimaSalida && ahora - ultimaSalida.getTime() < limiteDuplicadaMs) {
                return {
                    success: false,
                    error: `Tu salida quedó registrada hace menos de ${MINUTOS_MARCACION_DUPLICADA} minutos. No es necesario marcar de nuevo.`,
                }
            }

            const { error } = await abrirJornada(input.id, operacion)
            if (error) return { success: false, error }
            return { success: true }
        }

        if (input.tipo === 'SALIDA') {
            if (!activa) {
                return {
                    success: false,
                    error: cierreAutomatico
                        ? `Tu jornada anterior llevaba más de ${UMBRAL_CIERRE_AUTOMATICO_HORAS} horas abierta y se cerró automáticamente. Avisa a tu coordinador para que registre la salida real, y marca ENTRADA si vas a iniciar turno.`
                        : 'No tienes una jornada activa. Registra la entrada primero.',
                }
            }

            // Marcación duplicada: una salida pegada a la entrada que acaba de registrar
            if (ahora - new Date(activa.entrada).getTime() < limiteDuplicadaMs) {
                return {
                    success: false,
                    error: `Tu entrada quedó registrada hace menos de ${MINUTOS_MARCACION_DUPLICADA} minutos. Si fue un error, avisa a tu coordinador.`,
                }
            }

            const { error } = await cerrarJornada(input.id)
            if (error) return { success: false, error }
            return { success: true }
        }

        return { success: false, error: 'Tipo de registro no válido.' }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error del servidor'
        console.error('[registrarAsistenciaAPI]', err)
        return { success: false, error: msg }
    }
}
