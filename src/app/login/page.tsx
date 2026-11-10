import { login, signup } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

// Explicación en lenguaje claro de por qué no se pudo entrar
const MENSAJES_ERROR: Record<string, string> = {
    credenciales:
        'Correo o contraseña incorrectos. Verifica que el usuario exista en este sistema y que la contraseña sea la correcta.',
    sin_confirmar: 'Este correo aún no ha sido confirmado. Pide al administrador que active el usuario.',
    clave_api:
        'El sitio no pudo autenticarse con la base de datos: la clave pública configurada no corresponde al proyecto. Avisa al administrador del sistema.',
    conexion:
        'No se pudo conectar con la base de datos. Revisa tu conexión e intenta de nuevo; si persiste, avisa al administrador del sistema.',
    otro: 'No se pudo iniciar sesión.',
}

export default async function LoginPage({
    searchParams,
}: {
    searchParams: Promise<{ error?: string; detalle?: string }>
}) {
    const { error, detalle } = await searchParams
    const mensaje = error ? (MENSAJES_ERROR[error] ?? MENSAJES_ERROR.otro) : null

    return (
        <div className="flex h-screen w-full items-center justify-center px-4">
            <Card className="w-full max-w-sm">
                <CardHeader>
                    <CardTitle className="text-2xl">Inlotrans</CardTitle>
                    <CardDescription>Ingresa tus credenciales para acceder al sistema.</CardDescription>
                </CardHeader>
                <form>
                    <CardContent className="grid gap-4">
                        {mensaje && (
                            <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                                <p>{mensaje}</p>
                                {detalle && error !== 'credenciales' && (
                                    <p className="mt-1 text-xs text-red-600">Detalle técnico: {detalle}</p>
                                )}
                            </div>
                        )}
                        <div className="grid gap-2">
                            <Label htmlFor="email">Correo electrónico</Label>
                            <Input id="email" name="email" type="email" placeholder="m@ejemplo.com" required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="password">Contraseña</Label>
                            <Input id="password" name="password" type="password" required />
                        </div>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-2">
                        <Button className="w-full" formAction={login}>Acceder</Button>
                        {/* Ocultar registro por defecto en prod - solo HR/Admin deberían crear */}
                        {process.env.NODE_ENV === 'development' && (
                            <Button variant="outline" className="w-full" formAction={signup}>
                                Registrarse (Dev Only)
                            </Button>
                        )}
                    </CardFooter>
                </form>
            </Card>
        </div>
    )
}
