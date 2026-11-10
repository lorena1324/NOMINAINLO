'use client'

import { useState, useRef, useEffect } from 'react'
import { validarCedula, getEstadoJornada, registrarAsistenciaAPI } from './actions'
import { getOperacionesActivas } from './(dashboard)/admin/operaciones-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Camera, AlertTriangle } from 'lucide-react'

type TipoRegistro = 'ENTRADA' | 'SALIDA'
type EstadoTurno = 'sin_turno' | 'trabajando'

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

  const [isLoading, setIsLoading] = useState(false)
  const [fotoFile, setFotoFile] = useState<File | null>(null)
  const [fotoPreview, setFotoPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [opcionesOp, setOpcionesOp] = useState<{ id: string, nombre: string }[]>([])

  useEffect(() => {
    getOperacionesActivas().then(res => {
      if (res.success && res.data) setOpcionesOp(res.data)
    })
  }, [])

  useEffect(() => {
    if (!cedula) {
      setNombre('')
      setOperacion(''); setOperacionAsignada(false)
      setEstadoTurno('sin_turno')
      setInfoTurno(null)
      setTieneInconsistentes(false)
      return
    }

    const timer = setTimeout(async () => {
      const res = await validarCedula(cedula)
      if (!res.success || !res.data) {
        setNombre('')
        setOperacion(''); setOperacionAsignada(false)
        setEstadoTurno('sin_turno')
        setInfoTurno(null)
        toast.error(res.error || 'Cédula no válida')
        return
      }

      setNombre(res.data.nombre)
      // La operación viene de la ficha del colaborador y no se puede cambiar aquí.
      setOperacion(res.data.operacion ?? '')
      setOperacionAsignada(!!res.data.operacion)

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nombre) { toast.error('Debe validar una cédula correcta primero.'); return }
    if (!operacion) { toast.error('Debe seleccionar la operación.'); return }
    if (!fotoFile) { toast.error('Es obligatorio tomar una fotografía.'); return }

    setIsLoading(true)
    const toastId = toast.loading(`Registrando ${tipo}...`)

    try {
      const foto_base64 = await convertirABase64(fotoFile)
      const res = await registrarAsistenciaAPI({ id: cedula, usuario_nombre: nombre, operacion, tipo, foto_base64 })

      if (!res.success) {
        toast.error(res.error || 'Ocurrió un error al registrar', { id: toastId, duration: 5000 })
        return
      }

      toast.success(`¡${tipo} registrada correctamente para ${nombre.split(' ')[0]}!`, { id: toastId, duration: 5000 })

      setTimeout(() => {
        setCedula('')
        setNombre('')
        setOperacion(''); setOperacionAsignada(false)
        setTipo('ENTRADA')
        setEstadoTurno('sin_turno')
        setInfoTurno(null)
        setTieneInconsistentes(false)
        setFotoFile(null)
        setFotoPreview(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }, 1500)

    } catch (error: any) {
      toast.error('Error inesperado al procesar.', { id: toastId, duration: 5000 })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-50 items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg border relative overflow-hidden">
        <div className="h-2 w-full bg-blue-600 absolute top-0 left-0" />

        <div className="p-6">
          <div className="flex flex-col items-center mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-slate-800">Inlotrans</h1>
            <p className="text-sm text-slate-500">Registro de Asistencia</p>
          </div>

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
              <Input id="nombre" value={nombre} readOnly disabled className="bg-slate-50" />
            </div>

            <div className="space-y-2 pt-2">
              <Label>Tipo de Registro</Label>
              {infoTurno && (
                <p className="text-sm font-medium text-slate-600 bg-slate-100 px-3 py-1.5 rounded-md">
                  {infoTurno}
                </p>
              )}
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
            </div>

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
                  <img src={fotoPreview} alt="Preview" className="w-full h-auto object-cover max-h-48" />
                </div>
              )}
            </div>

            <Button
              type="submit"
              className="w-full mt-6 py-6 font-semibold text-lg shadow-sm"
              disabled={isLoading || !nombre}
            >
              {isLoading ? 'Guardando...' : 'Confirmar Registro'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
