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
    validarMomentoOffline,
    type Ubicacion,
} from '@/lib/asistencia'
import { aplicarCambiosOperacionPendientes } from '@/lib/cambiosOperacion'
import { fotosHabilitadas, guardarFotoCifrada } from '@/lib/fotos'

export async function validarCedula(cedula: string) {
    if (!cedula) return { success: false, error: 'Cédula vacía' }

    // El formato estricto de cédula se exige al CREAR colaboradores, no aquí:
    // así ningún colaborador ya registrado queda bloqueado para marcar.
    const supabase = await createClient()

    // Si tiene un cambio de operación programado que ya entra en vigencia, se aplica ahora.
    try {
        await aplicarCambiosOperacionPendientes(supabase, cedula)
    } catch (err) {
        console.error('[validarCedula] cambios de operación:', err)
    }

    const { data: usuario, error } = await supabase
        .from('usuarios')
        .select('id, nombre, status, operacion, autorizacion_datos_en')
        .eq('id', cedula)
        .maybeSingle()

    if (error && error.code !== 'PGRST116') {
        console.error('Error validando cédula:', error)
    }
    if (!usuario) return { success: false, error: 'Cédula no registrada. Consulta con tu coordinador.' }
    if (usuario.status === 'inactivo') {
        return { success: false, error: 'Usuario inactivo. No puede registrar asistencias.' }
    }
    return {
        success: true,
        data: {
            id: usuario.id as string,
            nombre: usuario.nombre as string,
            status: usuario.status as string,
            operacion: (usuario.operacion as string | null) ?? null,
            // ¿Ya autorizó el tratamiento de sus datos personales y biométricos?
            autorizoDatos: !!usuario.autorizacion_datos_en,
            // ¿El sistema está guardando fotos? (si no, la foto se descarta como antes)
            fotosActivas: fotosHabilitadas(),
        },
    }
}

/**
 * Registra que el colaborador autorizó el tratamiento de sus datos personales
 * y biométricos (Ley 1581 de 2012). Queda con fecha y hora.
 */
export async function registrarAutorizacionDatos(cedula: string) {
    if (!cedula) return { success: false, error: 'Cédula vacía' }
    const supabase = await createClient()
    const { error } = await supabase
        .from('usuarios')
        .update({ autorizacion_datos_en: new Date().toISOString() })
        .eq('id', cedula)
        .is('autorizacion_datos_en', null)
    if (error) return { success: false, error: 'No se pudo guardar la autorización.' }
    return { success: true }
}

/**
 * Jornada activa del empleado. Si lleva abierta más del tiempo límite (15 h),
 * se cierra de forma automática aquí mismo — sin esperar al proceso nocturno —
 * para que el colaborador pueda marcar su nueva ENTRADA y el coordinador reciba
 * la novedad por validar. `ahora` es el momento de la marcación que se evalúa.
 */
async function jornadaActivaVigente(cedula: string, ahora: Date = new Date()) {
    const jornada = await obtenerJornadaActiva(cedula)
    if (!jornada) return { jornada: null, cierreAutomatico: false }
    if (superaLimiteAbierta(jornada.entrada, ahora)) {
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

export interface RegistrarAsistenciaInput {
    id: string
    usuario_nombre: string
    operacion: string
    tipo: 'ENTRADA' | 'SALIDA'
    // La foto es obligatoria en el cliente. Solo se guarda (cifrada) si el
    // colaborador autorizó el tratamiento de sus datos; si no, se descarta.
    foto_base64: string | null
    /** Ubicación del dispositivo al marcar (para la geocerca). */
    ubicacion?: Partial<Ubicacion> | null
    /** Solo en marcaciones guardadas sin conexión: momento real en que se marcó (ISO). */
    momento?: string | null
}

export type ResultadoAsistencia =
    | { success: true; fueraGeocerca?: boolean }
    /** `definitivo`: el error no se arregla reintentando (no reenviar desde la cola sin conexión). */
    | { success: false; error: string; definitivo?: boolean }

export async function registrarAsistenciaAPI(input: RegistrarAsistenciaInput): Promise<ResultadoAsistencia> {
    try {
        if (!input.foto_base64) {
            return { success: false, error: 'Es obligatorio registrar una foto.', definitivo: true }
        }

        // ─── Momento de la marcación (ahora, o el guardado sin conexión) ─
        const offline = !!input.momento
        const momento = offline ? new Date(input.momento!) : new Date()
        if (offline) {
            const errorMomento = validarMomentoOffline(momento)
            if (errorMomento) return { success: false, error: errorMomento, definitivo: true }
        }

        // El servidor vuelve a validar al colaborador: activo y con operación asignada.
        const validacion = await validarCedula(input.id)
        if (!validacion.success || !validacion.data) {
            return { success: false, error: validacion.error ?? 'Cédula no válida.', definitivo: true }
        }
        const usuario = validacion.data
        // La operación sale de la ficha del colaborador (operación por defecto).
        // Solo si no tiene ninguna asignada se acepta la que eligió en pantalla.
        const operacion = usuario.operacion || input.operacion
        if (!operacion) {
            return {
                success: false,
                definitivo: true,
                error: 'No tienes una operación asignada. Pide a tu coordinador que la asigne antes de marcar.',
            }
        }

        const { jornada: activa, cierreAutomatico } = await jornadaActivaVigente(input.id, momento)
        const limiteDuplicadaMs = MINUTOS_MARCACION_DUPLICADA * 60000
        const datos = { momento, ubicacion: input.ubicacion ?? null, offline }

        // La foto solo se conserva con autorización del colaborador
        const guardarFoto = async (jornadaId: string, tipo: 'entrada' | 'salida') => {
            if (!usuario.autorizoDatos || !input.foto_base64) return
            const ruta = await guardarFotoCifrada({
                fotoBase64: input.foto_base64,
                cedula: input.id,
                jornadaId,
                tipo,
            })
            if (!ruta) return
            const supabase = await createClient()
            await supabase
                .from('jornadas')
                .update(tipo === 'entrada' ? { foto_entrada: ruta } : { foto_salida: ruta })
                .eq('id', jornadaId)
        }

        if (input.tipo === 'ENTRADA') {
            if (activa) {
                return {
                    success: false,
                    definitivo: true,
                    error: 'Ya tienes una jornada activa. Registra la salida primero.',
                }
            }

            // Marcación duplicada: una entrada pegada a la salida que acaba de registrar
            const ultimaSalida = await obtenerUltimaSalida(input.id)
            if (ultimaSalida) {
                const diferencia = momento.getTime() - ultimaSalida.getTime()
                if (diferencia < 0) {
                    return {
                        success: false,
                        definitivo: true,
                        error: 'Ya hay una salida registrada después de esa hora. Debe revisarlo el coordinador.',
                    }
                }
                if (diferencia < limiteDuplicadaMs) {
                    return {
                        success: false,
                        definitivo: true,
                        error: `Tu salida quedó registrada hace menos de ${MINUTOS_MARCACION_DUPLICADA} minutos. No es necesario marcar de nuevo.`,
                    }
                }
            }

            const { data: jornada, error } = await abrirJornada(input.id, operacion, datos)
            if (error || !jornada) return { success: false, error: error ?? 'No se pudo registrar la entrada.' }
            await guardarFoto(jornada.id, 'entrada')
            return { success: true, fueraGeocerca: !!jornada.fuera_geocerca }
        }

        if (input.tipo === 'SALIDA') {
            if (!activa) {
                return {
                    success: false,
                    definitivo: true,
                    error: cierreAutomatico
                        ? `Tu jornada anterior llevaba más de ${UMBRAL_CIERRE_AUTOMATICO_HORAS} horas abierta y se cerró automáticamente. Avisa a tu coordinador para que registre la salida real, y marca ENTRADA si vas a iniciar turno.`
                        : 'No tienes una jornada activa. Registra la entrada primero.',
                }
            }

            // Marcación duplicada: una salida pegada a la entrada que acaba de registrar
            if (momento.getTime() - new Date(activa.entrada).getTime() < limiteDuplicadaMs) {
                return {
                    success: false,
                    definitivo: true,
                    error: `Tu entrada quedó registrada hace menos de ${MINUTOS_MARCACION_DUPLICADA} minutos. Si fue un error, avisa a tu coordinador.`,
                }
            }

            const { data: jornada, error } = await cerrarJornada(input.id, momento, datos)
            if (error || !jornada) return { success: false, error: error ?? 'No se pudo registrar la salida.' }
            await guardarFoto(jornada.id, 'salida')
            return { success: true, fueraGeocerca: !!jornada.fuera_geocerca }
        }

        return { success: false, error: 'Tipo de registro no válido.', definitivo: true }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error del servidor'
        console.error('[registrarAsistenciaAPI]', err)
        return { success: false, error: msg }
    }
}
