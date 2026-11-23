'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ingresarPortal } from '../actions'

export default function PortalLoginPage() {
    const [estado, accion, enviando] = useActionState(ingresarPortal, null)

    return (
        <div className="flex min-h-screen w-full items-center justify-center px-4 bg-slate-50">
            <Card className="w-full max-w-sm">
                <CardHeader>
                    <CardTitle className="text-2xl">Portal de empleados</CardTitle>
                    <CardDescription>Ingresa para enviar tus documentos.</CardDescription>
                </CardHeader>
                <form action={accion}>
                    <CardContent className="grid gap-4">
                        {estado?.error && (
                            <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                                {estado.error}
                            </div>
                        )}
                        <div className="grid gap-2">
                            <Label htmlFor="cedula">Cédula</Label>
                            <Input id="cedula" name="cedula" inputMode="numeric" autoComplete="username" required />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="clave">Clave</Label>
                            <Input id="clave" name="clave" type="password" inputMode="numeric" autoComplete="current-password" required />
                            <p className="text-xs text-muted-foreground">Tu clave es tu número de cédula.</p>
                        </div>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-3">
                        <Button className="w-full" disabled={enviando}>{enviando ? 'Ingresando…' : 'Ingresar'}</Button>
                        <Link href="/login" className="text-xs text-muted-foreground hover:underline">
                            ¿Eres administrador o coordinador? Ingresa aquí
                        </Link>
                    </CardFooter>
                </form>
            </Card>
        </div>
    )
}
