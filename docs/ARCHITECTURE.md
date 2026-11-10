# Inlotrans Asistencia — Arquitectura Técnica

Sistema de control de asistencia y liquidación de horas para Inlotrans (logística / transporte, Colombia). Maneja marcación en quiosco público, dashboard del coordinador, motor de liquidación con bolsa de horas y cumplimiento de la **Ley 44h** colombiana.

---

## 1. Stack

| Capa          | Tecnología |
|---------------|-----------|
| Framework     | Next.js 16 (App Router) + React 19 + TypeScript 5 |
| Estilos       | TailwindCSS v4 + shadcn/ui (`new-york`) + Radix UI |
| Base de datos | Supabase (Postgres 17) — auth, RLS, storage |
| Hosting       | Netlify (incluye función programada diaria) |
| Validación    | Zod (en server actions) |
| UI varios     | `lucide-react` (iconos), `sonner` (toasts), `date-fns` |

No hay test runner configurado; la verificación es manual via `tsc`, `npm run lint` y Playwright.

---

## 2. Modelo de datos (unidad atómica: `jornadas`)

El sistema se construye alrededor de la tabla **`jornadas`**. Cada jornada representa un turno completo del empleado (entrada → salida), con el **snapshot de minutos ya calculado** al cerrar. No existe tabla de "eventos"; los estados son:

```
ABIERTO ──┬──► CERRADO          (empleado cierra desde quiosco)
          ├──► CERRADO_MANUAL   (coordinador corrige desde dashboard)
          └──► INCONSISTENTE    (cron detecta >16h sin cerrar)
```

### Tablas principales

| Tabla                 | Propósito |
|-----------------------|-----------|
| `usuarios`            | Empleados — PK es la cédula (string). |
| `perfiles`            | Vincula `auth.users.id` → `rol` (admin / coordinador) + `operacion_nombre`. |
| `operaciones`         | Centros de trabajo con `limite_horas` (8 o 12), `minutos_almuerzo` (descuento automático) y `max_extras_dia`. |
| `turnos`              | Horarios por operación — **referencia informativa, no conectado al motor aún**. |
| `tarifas`             | Precio por hora por tipo de concepto (9 tipos, valores 2026). |
| `novedades`           | Incapacidades, compensaciones, permisos, etc. Campos: `tipo_novedad`, `fecha_novedad`, `fecha_inicio/fin`, `es_pagado`, `codigo_causa` (código de causa de ausentismo), `valor_monetario`, `descripcion`, `tipo_ausentismo` (entero nullable — código de tipo de ausentismo para nómina). Incluye el tipo `AUXILIO_NO_PRESTACIONAL`. |
| `jornadas`            | Entidad central. Contiene `entrada`, `salida`, `estado`, snapshot de 9 tipos de minutos, `minutos_total`, `minutos_almuerzo_descontados`, `alerta_critica`, `cerrada_por`. |
| `aprobaciones_extras` | Toda hora >8h requiere aprobación. Estados: `PENDIENTE` / `APROBADA` / `RECHAZADA`. |
| `bolsa_horas`         | 1 fila por empleado. `saldo_minutos` (positivo = a favor, negativo = deuda). |
| `movimientos_bolsa`   | Trazabilidad de cada cambio en la bolsa. Motivos: `ABONO_EXCEDENTE`, `CARGO_DEFICIT`, `NOVEDAD_COMPENSA`, `AJUSTE_MANUAL`. |
| `semanas_dominicales` | Resultado del cierre semanal (Ley 44h). `paga_domingo` boolean. |
| `alertas`             | Eventos que el coordinador debe atender: `INCONSISTENTE`, `ALERTA_CRITICA` (>12h), `EXTRAS_PENDIENTES`. |

### RLS

- `authenticated` → full CRUD en todas las tablas.
- `anon` → SELECT en `usuarios` y `operaciones` (kiosco sólo lee para validar cédulas).
- `perfiles` → solo el propio usuario puede leer su perfil; escrituras requieren `service_role`.
- El kiosco de hecho corre **autenticado** (middleware exige login), así que el camino `anon` casi nunca se usa.

---

## 3. Motor de cálculo (`src/lib/calculoHoras.ts`)

Clasifica cada minuto trabajado en **9 tipos** según 3 variables: día domingo / festivo, franja nocturna (19:00–05:59 Colombia), y si supera las **8h acumuladas** del turno.

| # | ¿Extra (>8h)? | ¿Domingo / Festivo? | ¿Nocturno? | Tipo |
|---|---|---|---|---|
| 1 | No  | No  | No  | `normal` |
| 2 | No  | No  | Sí  | `nocturno` |
| 3 | Sí  | No  | No  | `extra` |
| 4 | Sí  | No  | Sí  | `extraNocturno` |
| 5 | No  | Sí (Dom)  | No  | `domingo` |
| 6 | No  | Sí (Fest) | No  | `festivo` |
| 7 | No  | Sí  | Sí  | `domingoFestivoNocturno` |
| 8 | Sí  | Sí  | No  | `extraDominicalFestivo` |
| 9 | Sí  | Sí  | Sí  | `extraNocturnaDominicalFestivo` |

### Algoritmo por tramos (chunks)

`calcularPeriodosHorasOptimizado(entradaBogota, salidaBogota, festivos, offset)` **no itera minuto a minuto**. Avanza por chunks hasta el próximo "punto de corte": `06:00`, `19:00`, `00:00`, o el umbral de **480 min** acumulados (pasaje de ordinario a extra). Un turno típico se resuelve en 2–6 chunks.

### Zonas horarias

Colombia es UTC-5 fijo (sin DST). La función `toColombiaTime(d)` crea una fecha "falsa" donde `getUTC*` retorna la hora local de Bogotá — eso simplifica toda la clasificación dentro del motor.

### Caches en memoria

- **Festivos**: consume `https://api-colombia.com/api/v1/Holiday/year/{año}`, TTL 24h por año, con fallback al último valor cacheado si la API falla.
- **Tarifas**: lee `tarifas` de Supabase, TTL 5 min, con fallback hardcoded 2026.

Ambos se resetean en cada arranque en frío del servidor (Netlify).

### Casos especiales validados

- **Cruce de medianoche**: el motor corta el chunk en 00:00 y reclasifica.
- **Domingo noche → Lunes festivo**: minutos 22:00 dom a 05:59 lun festivo = `domingoFestivoNocturno`; 06:00+ lun = `festivo`.
- **Turno que cruza domingo → lunes ordinario**: las horas del domingo se clasifican por el día de **inicio** del minuto, no el de fin.

---

## 4. Motor de liquidación (`src/lib/jornadas.ts`)

Al cerrar una jornada:

1. Obtiene `limite_horas` y `minutos_almuerzo` de la operación.
2. Si la jornada duró > 5h y la operación tiene almuerzo configurado → resta `minutos_almuerzo` de la salida para el cálculo.
3. Invoca `calcularPeriodosHorasOptimizado` sobre la ventana efectiva.
4. `minutos_total` = suma de los 9 tipos (lo que realmente paga).
5. Si `minutos_total > 12 * 60` → marca `alerta_critica = true` + inserta `alerta` tipo `ALERTA_CRITICA`.
6. **Excedente** = max(0, `minutos_total` − `limite_horas * 60`):
    - Si hay deuda en bolsa → abona primero, registra `movimientos_bolsa(ABONO_EXCEDENTE)`.
    - Resto (si queda) → inserta `aprobaciones_extras(PENDIENTE)` + `alerta(EXTRAS_PENDIENTES)`.
7. **Déficit** (trabajó < `limite_horas`):
    - Si hay novedad `es_pagado = true` que cubre el día → no toca bolsa.
    - Sino → `movimientos_bolsa(CARGO_DEFICIT, -deficit)` y actualiza `saldo_minutos`.

### API pública

```ts
abrirJornada(cedula, operacion)              // quiosco: ENTRADA
cerrarJornada(cedula)                        // quiosco: SALIDA
corregirJornadaInconsistente(id, salidaReal) // coordinador corrige
obtenerJornadaActiva(cedula)
obtenerBolsaHoras(cedula)
tieneJornadasInconsistentes(cedula)
registrarCompensaTiempo({empleadoId, minutos, novedadId})
```

---

## 5. Cron diario (`/api/cron/autocierre`)

- Schedule: `0 0 * * *` UTC (= **19:00 Colombia**).
- Protegido con `CRON_SECRET` opcional (header `Authorization: Bearer <token>`).
- Tareas:
  1. **Inconsistencias**: marca como `INCONSISTENTE` toda jornada `ABIERTO` con > 16h transcurridas, genera alerta.
  2. **Cierre dominical**: si **ayer** (hora Colombia) fue domingo, para cada empleado activo suma `minutos_ordinarios` (5 tipos no-extra) + días de novedad remunerada × 480, y hace upsert a `semanas_dominicales`. `paga_domingo = total >= 44 * 60`.

Se dispara cuando "ayer fue domingo" para tener la semana completa cerrada; si lo hiciéramos a las 19:00 del domingo perderíamos las últimas 5h del día.

---

## 6. Reportes (`src/lib/reportes.ts`)

Agrega jornadas cerradas (snapshot ya calculado) por empleado y período, con las tarifas aplicadas. **No recalcula** — solo suma y multiplica. Usado por `/admin` y `/empleados/[cedula]`.

```ts
calcularHorasUsuarioEnPeriodo(cedula, inicio, fin)
calcularHorasTodosEnPeriodo(inicio, fin, operaciones)
```

---

## 7. RBAC

Tres roles:

- **admin**: todo, sin filtros. Único que accede a `/admin/operaciones` y `/admin/usuarios`.
- **coordinador**: scope = su `operacion_nombre`. Todas las queries se filtran automáticamente server-side via `getOperationFilter(profile)`.
- **trabajador**: sin cuenta auth. Solo usa el quiosco via cédula.

Doble capa de enforcement: el `middleware.ts` bloquea rutas, y cada server action llama a `requireAdmin()` / `requireAdminOrCoordinador()`.

Helpers: `src/lib/auth.ts`.

---

## 8. Estructura de carpetas

```
src/
├── app/
│   ├── page.tsx                        # Quiosco (ENTRADA / SALIDA)
│   ├── actions.ts                      # validarCedula, registrarAsistenciaAPI
│   ├── login/                          # Email+password via Supabase Auth
│   ├── api/
│   │   ├── cron/autocierre/route.ts
│   │   └── reportes/
│   │       ├── nomina/route.ts
│   │       └── planos/
│   │           ├── cumpleanos/route.ts
│   │           ├── auxilio/route.ts
│   │           ├── extras/route.ts
│   │           └── otro/route.ts
│   └── (dashboard)/                    # Layout con sidebar
│       ├── admin/                      # Reporte administrativo + KPIs
│       │   ├── operaciones/            # CRUD de operaciones + turnos (admin only)
│       │   └── usuarios/               # Gestión de perfiles admin/coord (admin only)
│       ├── empleados/
│       │   └── [cedula]/               # Detalle rico con bolsa, jornadas, novedades
│       ├── novedades/                  # Formulario + historial
│       └── aprobaciones/               # Panel de extras pendientes + inconsistentes
│
├── lib/
│   ├── auth.ts                         # RBAC
│   ├── calculoHoras.ts                 # Motor por tramos + utilidades tiempo
│   ├── jornadas.ts                     # API de jornadas + motor de liquidación
│   ├── reportes.ts                     # Agregación por período
│   ├── constants/
│   │   └── ausentismos.ts              # Constantes: tipos, clases, causas ausentismo + códigos nómina
│   ├── excel/                          # Generadores Excel
│   │   ├── nomina.ts
│   │   └── planos/
│   │       ├── cumpleanos.ts
│   │       ├── auxilio.ts
│   │       ├── extras.ts
│   │       └── otro.ts
│   ├── supabase/                       # client / server / middleware / admin
│   └── utils.ts                        # cn()
│
├── components/
│   ├── ui/                             # shadcn (card, button, table, etc.)
│   └── ExportPlanosDialog.tsx          # Diálogo de selección para descarga de planos
└── middleware.ts                       # Auth + RBAC route gates
```

---

## 9. Convenciones

- **Server Components fetchean, Client Components interactúan**. Cada ruta tiene `page.tsx` (server) + `*Client.tsx` / `*Form.tsx` (client) + `actions.ts` (server actions).
- **4 clientes Supabase** (`src/lib/supabase/`):
  - `client.ts` — `createBrowserClient` para components cliente.
  - `server.ts` — `createServerClient` con cookies, para server components y actions.
  - `middleware.ts` — session refresh, solo dentro del middleware.
  - `admin.ts` — service role, solo para crear auth accounts.
- **Path alias**: `@/*` → `./src/*`.
- **Timezone**: el server siempre trabaja en UTC. `toColombiaTime` es solo para el motor de clasificación.
- **Commits**: conventional commits, sin AI attribution.

---

## 10. Variables de entorno

```bash
NEXT_PUBLIC_SUPABASE_URL        # URL del proyecto Supabase (expuesta al cliente)
NEXT_PUBLIC_SUPABASE_ANON_KEY   # key publica
SUPABASE_SERVICE_ROLE_KEY       # key admin, solo server — bypass RLS, usado en cron y /admin/usuarios
CRON_SECRET                     # opcional: protege /api/cron/autocierre
```

---

## 11. Flujo end-to-end de una jornada típica

```
1. Empleado llega al quiosco, ingresa su cédula.
2. validarCedula() confirma usuario activo.
3. getEstadoJornada() consulta si hay jornada ABIERTO → botón ENTRADA o SALIDA.
4. Captura foto obligatoria (ritual, no se almacena — se descarta en server).
5. Click → registrarAsistenciaAPI.
    - ENTRADA: abrirJornada() → crea fila en `jornadas` (estado ABIERTO).
    - SALIDA: cerrarJornada() → ejecuta motor de liquidación:
        · calcula snapshot de 9 tipos
        · ajusta bolsa
        · crea aprobación si hay extras
        · crea alertas si corresponde
        · estado → CERRADO.
6. Si el empleado olvida cerrar y pasan >16h:
    - Cron marca la jornada INCONSISTENTE → alerta al coordinador.
    - Coordinador va a /aprobaciones, ingresa hora salida real → corregirJornadaInconsistente.
7. Cada lunes 00:00 UTC el cron ejecuta el cierre dominical de la semana pasada.
```

---

## 12. Futuro / no en scope

- **Turnos → motor**: los turnos ya existen como tabla pero no participan del cálculo. A futuro, `usuarios.turno_id` permitiría umbrales dinámicos.
- **Widget "Cierre de Semana"** en dashboard del coordinador (barra de progreso por empleado hacia 44h).
- **Decisión automática** cuando no completa las 44h y no hay novedad: actualmente deja `paga_domingo = false` y requiere intervención manual.
