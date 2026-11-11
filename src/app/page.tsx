'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  validarCedula,
  getEstadoJornada,
  registrarAsistenciaAPI,
  registrarAutorizacionDatos,
} from './actions'
import { getOperacionesActivas } from './(dashboard)/admin/operaciones-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Camera, AlertTriangle, WifiOff, CloudUpload } from 'lucide-react'
import {
  colaDisponible,
  contarPendientes,
  encolarMarcacion,
  leerRechazadas,
  limpiarRechazadas,
  sincronizarCola,
  type MarcacionRechazada,
} from '@/lib/colaOffline'

type TipoRegistro = 'ENTRADA' | 'SALIDA'
type EstadoTurno = 'sin_turno' | 'trabajando'
type Coordenadas = { lat: number; lng: number }

/** Ubicación del dispositivo, o `null` si no hay permiso o GPS. Nunca bloquea más de 8 s. */
function obtenerUbicacion(): Promise<Coordenadas | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    )
  })
}

function horaLocal(iso: string) {
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function KioskoPage() {
  const [cedula, setCedula] = useState('')
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<TipoRegistro>('ENTRADA')
  const [operacion, setOperacion] = useState('')
  // true = el colaborador tiene operación por defecto y marca siempre en ella
  const [operacionAsignada, setOperacionAsignada] = useState(false)
  const [estadoTurno, setEstadoTurno] = useState<EstadoTurno>('sin_turno')
  const [infoTurno, setInfoTurno] = useState<string | null>(null)
  const [tieneInconsistentes, setTieneInconsistentes] = useState(false)

  // Autorización de datos personales y biométricos (Ley 1581 de 2012)
  const [pedirAutorizacion, setPedirAutorizacion] = useState(false)
  const [autoriza, setAutoriza] = useState(false)

  // Sin conexión: la marcación se guarda cifrada en el dispositivo
  const [sinConexion, setSinConexion] = useState(false)
  const [pendientes, setPendientes] = useState(0)
  const [rechazadas, setRechazadas] = useState<MarcacionRechazada[]>([])
  const sincronizando = useRef(false)

  const [isLoading, setIsLoading] = useState(false)
  const [fotoFile, setFotoFile] = useState<File | null>(null)
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [opcionesOp, setOpcionesOp] = useState<{ id: string, nombre: string }[]>([])

  useEffect(() => {
    getOperacionesActivas()
      .then(res => { if (res.success && res.data) setOpcionesOp(res.data) })
      .catch(() => { /* sin conexión: se cargan al volver */ })
  }, [])

  // ─── Sincronización de marcaciones guardadas sin conexión ───────────
  const sincronizar = useCallback(async (avisar = false) => {
    if (sincronizando.current || !colaDisponible()) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    sincronizando.current = true
    try {
      const res = await sincronizarCola((m) =>
        registrarAsistenciaAPI({
          id: m.cedula,
          usuario_nombre: '',
          operacion: m.operacion,
          tipo: m.tipo,
          foto_base64: m.foto_base64,
          ubicacion: m.ubicacion,
          momento: m.momento,
        }),
      )
      setPendientes(res.pendientes)
      setRechazadas(leerRechazadas())
      if (res.enviadas > 0) toast.success(`${res.enviadas} marcación(es) guardadas sin conexión ya se registraron.`)
      if (res.rechazadas > 0) toast.warning(`${res.rechazadas} marcación(es) guardadas no se pudieron registrar. Avisa al coordinador.`, { duration: 10000 })
      if (avisar && res.enviadas === 0 && res.rechazadas === 0 && res.pendientes > 0) {
        toast.info('Aún no hay conexión con el servidor. Se reintentará solo.')
      }
    } catch {
      /* se reintenta en el siguiente ciclo */
    } finally {
      sincronizando.current = false
    }
  }, [])

  useEffect(() => {
    setSinConexion(typeof navigator !== 'undefined' && !navigator.onLine)
    setRechazadas(leerRechazadas())
    contarPendientes().then(setPendientes)
    sincronizar()

    const alVolver = () => { setSinConexion(false); sincronizar() }
    const alCaer = () => setSinConexion(true)
    window.addEventListener('online', alVolver)
    window.addEventListener('offline', alCaer)
    const ciclo = setInterval(() => sincronizar(), 60000)
    return () => {
      window.removeEventListener('online', alVolver)
      window.removeEventListener('offline', alCaer)
      clearInterval(ciclo)
    }
  }, [sincronizar])

  const limpiarColaborador = () => {
    setNombre('')
    setOperacion('')
    setOperacionAsignada(false)
    setEstadoTurno('sin_turno')
    setInfoTurno(null)
    setTieneInconsistentes(false)
    setPedirAutorizacion(false)
    setAutoriza(false)
  }

  useEffect(() => {
    if (!cedula) {
      limpiarColaborador()
      return
    }

    const timer = setTimeout(async () => {
      try {
        const res = await validarCedula(cedula)
        setSinConexion(false)
        if (!res.success || !res.data) {
          limpiarColaborador()
          toast.error(res.error || 'Cédula no válida')
          return
        }

        setNombre(res.data.nombre)
        // La operación viene de la ficha del colaborador y no se puede cambiar aquí.
        setOperacion(res.data.operacion ?? '')
        setOperacionAsignada(!!res.data.operacion)
        // Solo se pide autorización si el sistema guarda fotos y aún no la ha dado
        setPedirAutorizacion(res.data.fotosActivas && !res.data.autorizoDatos)
        setAutoriza(false)

        const estadoRes = await getEstadoJornada(cedula)
        if (estadoRes.success && estadoRes.data) {
          const { estado, tieneInconsistentes: inc, info } = estadoRes.data
          setTieneInconsistentes(inc)
          if (estado === 'trabajando') {
            setEstadoTurno('trabajando')
            setTipo('SALIDA')
            setInfoTurno(info ?? null)
          } else {
            setEstadoTurno('sin_turno')
            setTipo('ENTRADA')
            setInfoTurno(null)
          }
        }
      } catch {
        // No hubo respuesta del servidor: se trabaja sin conexión
        limpiarColaborador()
        setSinConexion(true)
      }
    }, 600)

    return () => clearTimeout(timer)
  }, [cedula])

  const handleComprimirImagen = (file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = (e) => {
        const img = new Image()
        img.src = e.target?.result as string
        img.onload = () => {
          const canvas = document.createElement('canvas')
          let width = img.width
          let height = img.height
          const max = 1024
          if (width > height && width > max) { height = (height * max) / width; width = max }
          else if (height > max) { width = (width * max) / height; height = max }
          canvas.width = width
          canvas.height = height
          canvas.getContext('2d')?.drawImage(img, 0, 0, width, height)
          canvas.toBlob(blob => {
            if (blob) resolve(new File([blob], file.name, { type: 'image/jpeg' }))
            else reject(new Error('Fallo compresión'))
          }, 'image/jpeg', 0.75)
        }
      }
    })
  }

  const handleFotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const compressed = await handleComprimirImagen(file)
      setFotoFile(compressed)
      setFotoPreview(URL.createObjectURL(compressed))
    } catch {
      setFotoFile(file)
      setFotoPreview(URL.createObjectURL(file))
    }
  }

  const convertirABase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const reiniciarFormulario = () => {
    setCedula('')
    limpiarColaborador()
    setTipo('ENTRADA')
    setFotoFile(null)
    setFotoPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /** Guarda la marcación en el dispositivo para enviarla cuando vuelva la conexión. */
  const guardarSinConexion = async (foto_base64: string, ubicacion: Coordenadas | null, toastId: string | number) => {
    if (!colaDisponible()) {
      toast.error('Sin conexión, y este dispositivo no permite guardar la marcación. Avisa al coordinador.', { id: toastId, duration: 8000 })
      return
    }
    await encolarMarcacion({
      cedula,
      tipo,
      operacion,
      momento: new Date().toISOString(),
      foto_base64,
      ubicacion,
    })
    setPendientes(await contarPendientes())
    toast.success(`Sin conexión: tu ${tipo} quedó guardada con la hora actual y se registrará sola al volver el internet.`, { id: toastId, duration: 8000 })
    setTimeout(reiniciarFormulario, 1500)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cedula) { toast.error('Ingresa tu cédula.'); return }
    if (!sinConexion && !nombre) { toast.error('Debe validar una cédula correcta primero.'); return }
    if (!sinConexion && !operacion) { toast.error('Debe seleccionar la operación.'); return }
    if (!fotoFile) { toast.error('Es obligatorio tomar una fotografía.'); return }

    setIsLoading(true)
    const toastId = toast.loading(`Registrando ${tipo}...`)

    try {
      const [foto_base64, ubicacion] = await Promise.all([convertirABase64(fotoFile), obtenerUbicacion()])

      if (sinConexion || !navigator.onLine) {
        await guardarSinConexion(foto_base64, ubicacion, toastId)
        return
      }

      let res
      try {
        // La autorización se registra antes de marcar, para que la foto de hoy ya se conserve
        if (pedirAutorizacion && autoriza) await registrarAutorizacionDatos(cedula)
        res = await registrarAsistenciaAPI({ id: cedula, usuario_nombre: nombre, operacion, tipo, foto_base64, ubicacion })
      } catch {
        // La petición no llegó al servidor: se guarda en el dispositivo
        setSinConexion(true)
        await guardarSinConexion(foto_base64, ubicacion, toastId)
        return
      }

      if (!res.success) {
        toast.error(res.error || 'Ocurrió un error al registrar', { id: toastId, duration: 6000 })
        return
      }

      const primerNombre = nombre.split(' ')[0]
      if (res.fueraGeocerca) {
        toast.warning(
          `${tipo} registrada para ${primerNombre}, pero fuera de la zona de la operación (o sin ubicación). El coordinador la validará.`,
          { id: toastId, duration: 8000 },
        )
      } else {
        toast.success(`¡${tipo} registrada correctamente para ${primerNombre}!`, { id: toastId, duration: 5000 })
      }

      setTimeout(reiniciarFormulario, 1500)

    } catch {
      toast.error('Error inesperado al procesar.', { id: toastId, duration: 5000 })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-50 items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg border relative overflow-hidden">
        <div className={`h-2 w-full absolute top-0 left-0 ${sinConexion ? 'bg-amber-500' : 'bg-blue-600'}`} />

        <div className="p-6">
          <div className="flex flex-col items-center mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-slate-800">Inlotrans</h1>
            <p className="text-sm text-slate-500">Registro de Asistencia</p>
          </div>

          {sinConexion && (
            <div className="flex items-start gap-2 mb-4 p-3 bg-amber-50 border border-amber-300 rounded-lg text-amber-900 text-sm">
              <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <b>Sin conexión.</b> Puedes marcar igual: escribe tu cédula, elige ENTRADA o SALIDA y toma la foto.
                Queda guardada con la hora actual y se registra sola cuando vuelva el internet.
              </span>
            </div>
          )}

          {pendientes > 0 && (
            <div className="flex items-center justify-between gap-2 mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-sm">
              <span className="flex items-center gap-2">
                <CloudUpload className="w-4 h-4 shrink-0" />
                {pendientes} marcación(es) guardadas por enviar
              </span>
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs bg-white" onClick={() => sincronizar(true)}>
                Enviar ahora
              </Button>
            </div>
          )}

          {rechazadas.length > 0 && (
            <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg text-red-900 text-xs space-y-1">
              <p className="font-semibold text-sm">Marcaciones guardadas que no se registraron (avisar al coordinador):</p>
              {rechazadas.map((r, i) => (
                <p key={i}>• CC {r.cedula} · {r.tipo} · {horaLocal(r.momento)} — {r.error}</p>
              ))}
              <button
                type="button"
                className="underline"
                onClick={() => { limpiarRechazadas(); setRechazadas([]) }}
              >
                Ya avisé, quitar de la lista
              </button>
            </div>
          )}

          {tieneInconsistentes && (
            <div className="flex items-center gap-2 mb-4 p-3 bg-amber-50 border border-amber-300 rounded-lg text-amber-800 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Tienes una jornada que quedó sin salida y se cerró automáticamente. Avisa a tu coordinador para que registre la hora real.</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="cedula">Cédula</Label>
              <Input
                id="cedula"
                value={cedula}
                onChange={(e) => setCedula(e.target.value.replace(/\s+/g, ''))}
                required
                placeholder="Ingrese su cédula"
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre Completo</Label>
              <Input
                id="nombre"
                value={sinConexion && cedula ? 'Se validará al volver la conexión' : nombre}
                readOnly
                disabled
                className="bg-slate-50"
              />
            </div>

            <div className="space-y-2 pt-2">
              <Label>Tipo de Registro</Label>
              {infoTurno && (
                <p className="text-sm font-medium text-slate-600 bg-slate-100 px-3 py-1.5 rounded-md">
                  {infoTurno}
                </p>
              )}
              {sinConexion ? (
                // Sin conexión no se sabe si está en turno: el colaborador elige
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    className={`py-6 text-lg ${tipo === 'ENTRADA' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
                    onClick={() => setTipo('ENTRADA')}
                  >
                    ENTRADA
                  </Button>
                  <Button
                    type="button"
                    className={`py-6 text-lg ${tipo === 'SALIDA' ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
                    onClick={() => setTipo('SALIDA')}
                  >
                    SALIDA
                  </Button>
                </div>
              ) : (
                <>
                  {estadoTurno === 'sin_turno' && (
                    <Button
                      type="button"
                      className="w-full bg-blue-600 hover:bg-blue-700 py-6 text-lg"
                      onClick={() => setTipo('ENTRADA')}
                    >
                      ENTRADA
                    </Button>
                  )}
                  {estadoTurno === 'trabajando' && (
                    <Button
                      type="button"
                      className="w-full bg-red-600 hover:bg-red-700 py-6 text-lg"
                      onClick={() => setTipo('SALIDA')}
                    >
                      SALIDA
                    </Button>
                  )}
                </>
              )}
            </div>

            {!sinConexion && (
              <div className="space-y-2">
                <Label htmlFor="operacion">Operación</Label>
                {operacionAsignada ? (
                  <>
                    <Input id="operacion" value={operacion} readOnly disabled className="bg-slate-50 font-medium" />
                    <p className="text-xs text-slate-500">
                      Es tu operación asignada. Si no es correcta, avisa a tu coordinador.
                    </p>
                  </>
                ) : (
                  <>
                    <Select value={operacion} onValueChange={setOperacion} disabled={!nombre}>
                      <SelectTrigger>
                        <SelectValue placeholder={nombre ? 'Seleccione...' : 'Primero ingrese su cédula'} />
                      </SelectTrigger>
                      <SelectContent>
                        {opcionesOp.map(op => (
                          <SelectItem key={op.id} value={op.nombre}>{op.nombre}</SelectItem>
                        ))}
                        {opcionesOp.length === 0 && (
                          <SelectItem value="cargando" disabled>Cargando operaciones...</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {nombre && (
                      <p className="text-xs text-amber-700">
                        No tienes operación asignada. Elige dónde trabajas hoy y avisa a tu coordinador.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>Captura Fotográfica</Label>
              <label className="flex items-center justify-center gap-2 w-full p-4 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition">
                <Camera className="w-5 h-5 text-slate-500" />
                <span className="text-sm font-medium text-slate-600">Tomar Foto</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleFotoChange}
                />
              </label>
              {fotoPreview && (
                <div className="mt-3 rounded-lg overflow-hidden border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fotoPreview} alt="Preview" className="w-full h-auto object-cover max-h-48" />
                </div>
              )}
            </div>

            {pedirAutorizacion && !sinConexion && (
              <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-300 bg-slate-50 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoriza}
                  onChange={(e) => setAutoriza(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  <b>Autorización de tratamiento de datos (Ley 1581 de 2012).</b> Autorizo a Inlotrans a guardar
                  de forma cifrada la foto de mis marcaciones y mi ubicación al marcar, únicamente para el control
                  de asistencia. Puedo solicitar su consulta, corrección o eliminación a través de mi coordinador.
                  <span className="block mt-1 text-slate-500">
                    Si no la marcas puedes registrar tu asistencia igual; la foto no se guardará.
                  </span>
                </span>
              </label>
            )}

            <Button
              type="submit"
              className="w-full mt-6 py-6 font-semibold text-lg shadow-sm"
              disabled={isLoading || (!sinConexion && !nombre) || !cedula}
            >
              {isLoading ? 'Guardando...' : sinConexion ? 'Guardar marcación' : 'Confirmar Registro'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
