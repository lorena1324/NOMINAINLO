import { getUserProfile } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import {
    getEmpleadoDetalle,
    getJornadasRango,
    getNovedadesEmpleado,
    getMovimientosBolsa,
    getAprobacionesEmpleado,
    getAlertasEmpleado,
    getSemanaDominicalActual,
    getTurnoOperacion,
    getMallaEmpleado,
    getCorreccionesEmpleado,
} from './actions'
import { calcularHorasUsuarioEnPeriodo } from '@/lib/reportes'
import { obtenerBolsaHoras } from '@/lib/jornadas'
import { EmpleadoDetalleClient } from './EmpleadoDetalleClient'

export default async function EmpleadoDetallePage({
    params,
    searchParams,
}: {
    params: Promise<{ cedula: string }>
    searchParams: Promise<{ mes?: string }>
}) {
    const profile = await getUserProfile()
    if (!profile) redirect('/')

    const { cedula } = await params
    const { mes } = await searchParams

    const empleado = await getEmpleadoDetalle(cedula)
    if (!empleado) notFound()

    if (profile.rol === 'coordinador' && empleado.operacion !== profile.operacion_nombre) {
        redirect('/empleados')
    }

    // Rango del mes seleccionado (searchParam ?mes=YYYY-MM) o mes actual
    const now = new Date()
    let year = now.getFullYear()
    let month = now.getMonth()

    if (mes && /^\d{4}-\d{2}$/.test(mes)) {
        const [y, m] = mes.split('-').map(Number)
        if (y >= 2020 && y <= 2100 && m >= 1 && m <= 12) {
            year = y
            month = m - 1
        }
    }

    const mesInicio = new Date(year, month, 1)
    const mesFin = new Date(year, month + 1, 0, 23, 59, 59, 999)

    // Rango del mes en días calendario (hora Colombia) para la malla día a día
    const mm = String(month + 1).padStart(2, '0')
    const diaInicio = `${year}-${mm}-01`
    const diaFin = `${year}-${mm}-${String(new Date(Date.UTC(year, month + 1, 0)).getUTCDate()).padStart(2, '0')}`

    const [
        dias,
        correcciones,
        jornadasMes,
        novedades,
        horasMes,
        bolsaSaldo,
        movimientosBolsa,
        aprobaciones,
        alertas,
        semanaDominical,
        configOperacion,
    ] = await Promise.all([
        getMallaEmpleado(cedula, diaInicio, diaFin),
        getCorreccionesEmpleado(cedula),
        getJornadasRango(cedula, mesInicio.toISOString(), mesFin.toISOString()),
        getNovedadesEmpleado(cedula),
        calcularHorasUsuarioEnPeriodo(cedula, mesInicio, mesFin).catch(() => null),
        obtenerBolsaHoras(cedula).catch(() => 0),
        getMovimientosBolsa(cedula, 15),
        getAprobacionesEmpleado(cedula, 30),
        getAlertasEmpleado(cedula),
        getSemanaDominicalActual(cedula),
        getTurnoOperacion(empleado.operacion),
    ])

    return (
        <EmpleadoDetalleClient
            empleado={empleado}
            dias={dias}
            correcciones={correcciones}
            diasRango={{ inicio: diaInicio, fin: diaFin }}
            jornadasMes={jornadasMes}
            novedades={novedades}
            horasMes={horasMes}
            bolsaSaldo={bolsaSaldo}
            movimientosBolsa={movimientosBolsa}
            aprobaciones={aprobaciones}
            alertas={alertas}
            semanaDominical={semanaDominical}
            configOperacion={configOperacion}
            mesRango={{ inicio: mesInicio.toISOString(), fin: mesFin.toISOString() }}
            rol={profile.rol}
        />
    )
}
