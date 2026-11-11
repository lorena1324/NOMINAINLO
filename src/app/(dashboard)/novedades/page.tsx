import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NovedadesForm } from './NovedadesForm'
import { DeleteNovedadButton } from './DeleteNovedadButton'
import Link from 'next/link'
import { getUserProfile, puedeEditar } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function NovedadesPage() {
    const profile = await getUserProfile()
    if (!profile) redirect('/')

    const supabase = await createClient()

    const { data: novedadesRaw } = await supabase
        .from('novedades')
        .select(`
            id, usuario_id, usuario_nombre, tipo_novedad,
            fecha_novedad, fecha_inicio, fecha_fin,
            es_pagado, codigo_causa, valor_monetario, descripcion, created_at,
            usuario:usuarios(nombre, operacion)
        `)
        .order('fecha_novedad', { ascending: false })

    type NovedadRow = {
        id: string
        usuario_id: string
        usuario_nombre: string
        tipo_novedad: string
        fecha_novedad: string
        fecha_inicio: string | null
        fecha_fin: string | null
        es_pagado: boolean
        codigo_causa: number | null
        valor_monetario: number | null
        descripcion: string | null
        usuario?: { nombre?: string; operacion?: string } | { nombre?: string; operacion?: string }[]
    }
    let novedades = (novedadesRaw ?? []) as NovedadRow[]
    if (profile.rol !== 'admin' && profile.operacion_nombre) {
        novedades = novedades.filter((n) => {
            const usuario = Array.isArray(n.usuario) ? n.usuario[0] : n.usuario
            return usuario?.operacion === profile.operacion_nombre
        })
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Registro de Novedades</h1>
                    <p className="text-muted-foreground mt-1">Gestión de auxilios, deducciones e incapacidades médicas</p>
                </div>
                <Link href="/empleados">
                    <Button variant="outline" className="border-blue-600 text-blue-700 hover:bg-blue-50">
                        👥 Gestión de Usuarios
                    </Button>
                </Link>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <div className="col-span-1">
                    {puedeEditar(profile) ? (
                        <NovedadesForm />
                    ) : (
                        <Card><CardContent className="py-8 text-sm text-slate-500 text-center">Tu perfil es de solo consulta: puedes ver el historial, pero no registrar novedades.</CardContent></Card>
                    )}
                </div>

                <div className="col-span-1 lg:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Historial de Novedades ({novedades?.length || 0})</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-md border overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Empleado (Cédula)</TableHead>
                                            <TableHead>Fechas</TableHead>
                                            <TableHead>Tipo / Concepto</TableHead>
                                            <TableHead>Justificación</TableHead>
                                            <TableHead className="text-right">Afecta Planilla</TableHead>
                                            {profile.rol === 'admin' && <TableHead className="text-right">Acciones</TableHead>}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {novedades?.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={profile.rol === 'admin' ? 6 : 5} className="text-center py-8 text-muted-foreground">
                                                    No hay novedades recientes registradas.
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {novedades?.map((nov) => {
                                            const usuarioRel = Array.isArray(nov.usuario) ? nov.usuario[0] : nov.usuario
                                            return (
                                            <TableRow key={nov.id}>
                                                <TableCell>
                                                    <div className="font-medium text-sm">{usuarioRel?.nombre || nov.usuario_nombre || 'Desconocido'}</div>
                                                    <div className="text-xs text-muted-foreground">{nov.usuario_id}</div>
                                                </TableCell>
                                                <TableCell>
                                                    {nov.fecha_inicio && nov.fecha_fin ? (
                                                        <>
                                                            <div className="text-xs">Del: {new Date(nov.fecha_inicio).toLocaleDateString('es-CO')}</div>
                                                            <div className="text-xs">Al: {new Date(nov.fecha_fin).toLocaleDateString('es-CO')}</div>
                                                        </>
                                                    ) : (
                                                        <div className="text-xs">{new Date(nov.fecha_novedad).toLocaleDateString('es-CO')}</div>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge
                                                        variant={nov.tipo_novedad.startsWith('INCAPACIDAD') ? 'destructive' : 'secondary'}
                                                        className="text-[10px] uppercase"
                                                    >
                                                        {nov.tipo_novedad.replace(/_/g, ' ')}
                                                    </Badge>
                                                    {nov.valor_monetario && (
                                                        <div className="text-xs font-semibold text-emerald-600 mt-1">
                                                            $ {nov.valor_monetario.toLocaleString('es-CO')}
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <p className="max-w-[200px] truncate text-xs text-slate-600" title={nov.descripcion ?? ''}>
                                                        {nov.descripcion || '-'}
                                                    </p>
                                                    {nov.codigo_causa && (
                                                        <span className="text-[10px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded mt-1 inline-block">
                                                            EPS: {nov.codigo_causa}
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {nov.es_pagado ? (
                                                        <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200">Sí</Badge>
                                                    ) : (
                                                        <Badge variant="outline" className="text-slate-500 bg-slate-50">No</Badge>
                                                    )}
                                                </TableCell>
                                                {profile.rol === 'admin' && (
                                                    <TableCell className="text-right">
                                                        <DeleteNovedadButton id={nov.id} />
                                                    </TableCell>
                                                )}
                                            </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
