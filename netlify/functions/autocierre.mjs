/**
 * Función programada de Netlify: reemplaza al cron que antes corría en Vercel.
 *
 * Todos los días a las 00:00 UTC (19:00 hora Colombia) llama al proceso
 * nocturno de la app (/api/cron/autocierre), que:
 *   1. marca como cierre automático las jornadas abiertas por más de 15 h, y
 *   2. los lunes calcula el cumplimiento semanal de las 44 h (cierre dominical).
 *
 * Solo se ejecuta en el sitio publicado en producción.
 */
export default async () => {
    // URL pública del sitio; Netlify la define sola en producción.
    const base = process.env.URL
    if (!base) {
        console.error('[autocierre] Falta la variable URL del sitio.')
        return
    }

    const headers = {}
    if (process.env.CRON_SECRET) {
        headers.authorization = `Bearer ${process.env.CRON_SECRET}`
    }

    try {
        const res = await fetch(`${base}/api/cron/autocierre`, { headers })
        const texto = await res.text()
        console.log(`[autocierre] ${res.status} ${texto.slice(0, 500)}`)
    } catch (err) {
        console.error('[autocierre] No se pudo ejecutar el proceso nocturno:', err)
    }
}

export const config = {
    schedule: '0 0 * * *',
}
