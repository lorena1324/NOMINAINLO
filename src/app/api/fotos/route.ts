import { NextRequest, NextResponse } from 'next/server'
import { leerFotoCifrada } from '@/lib/fotos'
import { registrarAuditoria } from '@/lib/auditoria'
import { contextoReporte } from '@/lib/reportesAuth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/fotos?jornada=<id>&tipo=entrada|salida
 *
 * Descifra y muestra la foto de una marcación. Solo perfiles del panel, y el
 * coordinador o visualizador únicamente de su operación. Cada consulta queda
 * en la auditoría, por tratarse de un dato sensible.
 */
export async function GET(request: NextRequest) {
    try {
        const ctx = await contextoReporte(request)
        if (!ctx.ok) return ctx.response
        const { supabase, profile, operaciones } = ctx

        const { searchParams } = new URL(request.url)
        const jornadaId = searchParams.get('jornada')
        const tipo = searchParams.get('tipo') === 'salida' ? 'salida' : 'entrada'
        if (!jornadaId || !/^[0-9a-f-]{36}$/i.test(jornadaId)) {
            return NextResponse.json({ error: 'Jornada no válida.' }, { status: 400 })
        }

        const { data: jornada } = await supabase
            .from('jornadas')
            .select('id, empleado_id, operacion, foto_entrada, foto_salida')
            .eq('id', jornadaId)
            .maybeSingle()
        if (!jornada) return NextResponse.json({ error: 'La jornada no existe.' }, { status: 404 })

        if (operaciones.length > 0 && !operaciones.includes(jornada.operacion)) {
            return NextResponse.json({ error: 'No autorizado para ver fotos de esta operación.' }, { status: 403 })
        }

        const ruta = tipo === 'entrada' ? jornada.foto_entrada : jornada.foto_salida
        if (!ruta) return NextResponse.json({ error: 'Esta marcación no tiene foto guardada.' }, { status: 404 })

        const foto = await leerFotoCifrada(ruta)
        if (!foto) return NextResponse.json({ error: 'No se pudo leer la foto.' }, { status: 500 })

        await registrarAuditoria(supabase, {
            accion: 'VER_FOTO',
            entidad: 'jornada',
            entidadId: jornada.id,
            autor: profile.email,
            detalle: { tipo, empleado_id: jornada.empleado_id },
        })

        return new NextResponse(new Uint8Array(foto), {
            status: 200,
            headers: {
                'Content-Type': 'image/jpeg',
                'Cache-Control': 'private, no-store',
            },
        })
    } catch (err) {
        console.error('[API /fotos]', err)
        return NextResponse.json({ error: 'Error interno' }, { status: 500 })
    }
}
