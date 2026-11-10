import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getOperationFilter, getUserProfile, type UserProfile } from '@/lib/auth'

type Contexto =
    | {
          ok: true
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          supabase: SupabaseClient<any, any, any>
          profile: UserProfile
          /** Operaciones a consultar. Vacío = todas (solo administrador). */
          operaciones: string[]
      }
    | { ok: false; response: NextResponse }

/**
 * Valida quién pide una descarga y a qué operaciones tiene derecho.
 *
 * - Solo perfiles con acceso al panel (administrador o coordinador) pueden descargar.
 * - El coordinador siempre queda limitado a su operación, aunque pida otras por URL.
 */
export async function contextoReporte(request: NextRequest): Promise<Contexto> {
    const profile = await getUserProfile()
    if (!profile) {
        return {
            ok: false,
            response: NextResponse.json(
                { error: 'No autorizado: tu perfil no tiene permiso para descargar reportes.' },
                { status: 403 },
            ),
        }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
        return { ok: false, response: NextResponse.json({ error: 'Config error' }, { status: 500 }) }
    }

    const opParam = new URL(request.url).searchParams.get('op')
    const pedidas = opParam ? opParam.split(',').filter(Boolean) : []
    const filtroPerfil = getOperationFilter(profile)
    const operaciones = filtroPerfil.length > 0 ? filtroPerfil : pedidas

    return {
        ok: true,
        supabase: createClient(supabaseUrl, supabaseServiceKey),
        profile,
        operaciones,
    }
}

export function esFechaISO(valor: string | null): valor is string {
    return !!valor && /^\d{4}-\d{2}-\d{2}$/.test(valor)
}

export function respuestaExcel(buffer: Buffer, nombreArchivo: string): NextResponse {
    return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
        },
    })
}
