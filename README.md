# Inlotrans Asistencia V2

Sistema de control de asistencia, liquidación de horas y gestión de nómina para **Inlotrans** (empresa de logística y transporte, Colombia). Diseñado para operaciones con múltiples centros de trabajo, turnos nocturnos, festivos y cumplimiento de la **Ley 44 horas** colombiana.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | **Next.js 16** (App Router) + React 19 + TypeScript 5 |
| Base de datos | **Supabase** (PostgreSQL 17) — auth, RLS, API |
| Estilos | TailwindCSS v4 + shadcn/ui (new-york) + Radix UI |
| Reportes | ExcelJS (generación de nómina .xlsx) |
| Hosting | Netlify (incluye función programada diaria) |
| Validación | Zod (server actions) |
| UI | lucide-react (iconos), sonner (toasts), date-fns |

---

## Requisitos

- Node.js 18+
- npm 9+
- Cuenta de Supabase con proyecto configurado
- Variables de entorno (ver abajo)

## Instalación

```bash
git clone https://github.com/JuanDr08/Inlotrans.git
cd Inlotrans
npm install
cp .env.example .env.local   # rellenar con credenciales Supabase
npm run dev                   # http://localhost:3000
```

## Comandos

```bash
npm run dev                # Dev server (Next.js Turbopack)
npm run build              # Build de producción
npm run lint               # ESLint
npx tsc --noEmit           # Type-check sin build
npm run migrate:prod-to-dev  # Migración de datos prod → dev
```

## Variables de entorno

```bash
NEXT_PUBLIC_SUPABASE_URL        # URL del proyecto Supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY   # Key pública (segura para el cliente)
SUPABASE_SERVICE_ROLE_KEY       # Key admin (solo server — bypass RLS)
CRON_SECRET                     # Protege el endpoint /api/cron/autocierre
```

---

## Arquitectura

### Modelo de datos

La entidad central es **`jornadas`**: cada fila = 1 turno completo de un empleado (entrada → salida), con un **snapshot precalculado de 9 tipos de minutos** al momento de cerrar. No existe tabla de "eventos" ni "registros" — la jornada es la unidad atómica.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│   usuarios   │────<│   jornadas   │>────│ aprobaciones_    │
│   (cédula)   │     │  (snapshot)  │     │     extras       │
└──────────────┘     └──────┬───────┘     └──────────────────┘
       │                    │
       │              ┌─────┴─────┐
       │              │  alertas  │
       │              └───────────┘
       │
  ┌────┴────────┐     ┌──────────────┐     ┌──────────────────┐
  │ bolsa_horas │────<│ movimientos_ │     │   semanas_       │
  │  (saldo)    │     │    bolsa     │     │  dominicales     │
  └─────────────┘     └──────────────┘     └──────────────────┘
       │
  ┌────┴────────┐     ┌──────────────┐
  │  novedades  │     │ operaciones  │──── turnos
  └─────────────┘     │  (código)    │     tarifas
                      └──────────────┘
```

### Schema de tablas

| Tabla | PK | Propósito |
|-------|-----|----------|
| `usuarios` | `id` (cédula TEXT) | Empleados. Nombre, cargo, operación, status activo/inactivo. |
| `perfiles` | `id` (FK auth.users) | Vincula cuenta Supabase Auth a rol (`admin`/`coordinador`) + operación. |
| `operaciones` | `id` (UUID) | Centros de trabajo. `codigo` (INL-XXXX), `nombre`, `limite_horas` (8 o 12), `minutos_almuerzo`, `max_extras_dia`. |
| `turnos` | `id` (UUID) | Horarios por operación (informativo, no conectado al motor aún). |
| `tarifas` | `tipo_hora` (TEXT) | Precio por hora de cada tipo (9 tipos) + `codigo_nomina` para Excel. |
| `novedades` | `id` (UUID) | Incapacidades, compensaciones, permisos, etc. `tipo_novedad`, `es_pagado`, `fecha_inicio/fin`, `descripcion`. |
| `jornadas` | `id` (UUID) | **Entidad central.** `entrada/salida` (TIMESTAMPTZ), `estado` (ABIERTO/CERRADO/CERRADO_MANUAL/INCONSISTENTE), snapshot de 9 tipos de minutos, `minutos_total`, `alerta_critica`. |
| `bolsa_horas` | `empleado_id` (TEXT) | Saldo compensatorio por empleado. Positivo = a favor, negativo = deuda. |
| `movimientos_bolsa` | `id` (UUID) | Trazabilidad de cada cambio. Motivos: ABONO_EXCEDENTE, CARGO_DEFICIT, NOVEDAD_COMPENSA, AJUSTE_MANUAL. |
| `aprobaciones_extras` | `id` (UUID) | Toda hora >8h requiere aprobación. PENDIENTE → APROBADA / RECHAZADA. |
| `semanas_dominicales` | `id` (UUID) | Cumplimiento semanal 44h. `paga_domingo` boolean. |
| `alertas` | `id` (UUID) | INCONSISTENTE, ALERTA_CRITICA (>12h), EXTRAS_PENDIENTES. |

### Los 9 tipos de horas

El motor clasifica cada minuto trabajado según 3 variables (día festivo/domingo, franja nocturna 19:00-05:59, umbral >8h):

| # | Tipo | Condición |
|---|------|-----------|
| 1 | `normal` | Día ordinario, diurno, ≤8h |
| 2 | `nocturno` | Día ordinario, nocturno, ≤8h |
| 3 | `extra` | Día ordinario, diurno, >8h |
| 4 | `extraNocturno` | Día ordinario, nocturno, >8h |
| 5 | `domingo` | Domingo, diurno, ≤8h |
| 6 | `festivo` | Festivo, diurno, ≤8h |
| 7 | `domingoFestivoNocturno` | Dom/Fest, nocturno, ≤8h |
| 8 | `extraDominicalFestivo` | Dom/Fest, diurno, >8h |
| 9 | `extraNocturnaDominicalFestivo` | Dom/Fest, nocturno, >8h |

---

### Motor de cálculo (`src/lib/calculoHoras.ts`)

Algoritmo **por tramos (chunks)** — no itera minuto a minuto. Avanza hasta el próximo punto de corte (06:00, 19:00, 00:00 o umbral 480 min) y clasifica cada chunk completo. Un turno típico se resuelve en 2-6 chunks.

**Zona horaria**: Colombia = UTC-5 fijo (sin DST). `toColombiaTime(d)` crea un Date "falso" donde `getUTC*` retorna hora local de Bogotá.

**Caches en memoria** (se resetean en cada arranque en frío del servidor):
- Festivos: API Colombia (`api-colombia.com`), TTL 24h por año, con fallback al último valor cacheado.
- Tarifas: tabla `tarifas` de Supabase, TTL 5 min, con fallback hardcoded 2026.

**Casos especiales validados**:
- Cruce de medianoche (turno nocturno)
- Domingo 22:00 → Lunes festivo 10:00
- Turno que cruza domingo → lunes ordinario
- Festivo en medio de la semana

### Motor de liquidación (`src/lib/jornadas.ts`)

Al cerrar una jornada (empleado marca SALIDA o coordinador corrige):

1. Descuenta almuerzo si `minutos_almuerzo > 0` y jornada > 5h.
2. Llama al motor de cálculo → snapshot de 9 tipos. `minutos_total` = suma.
3. Si >12h → `alerta_critica` + alerta.
4. **Excedente** (>8h) → sana deuda de bolsa primero, resto → `aprobaciones_extras(PENDIENTE)`.
5. **Déficit** (<8h sin novedad remunerada) → descuenta de `bolsa_horas` + registra movimiento.

API pública:
```typescript
abrirJornada(cedula, operacion)
cerrarJornada(cedula)
corregirJornadaInconsistente(jornadaId, horaSalidaReal)
obtenerJornadaActiva(cedula)
obtenerBolsaHoras(cedula)
tieneJornadasInconsistentes(cedula)
registrarCompensaTiempo({empleadoId, minutos, novedadId})
```

### Reportes (`src/lib/reportes.ts`)

Agrega jornadas cerradas por empleado y período. **No recalcula** — solo suma los snapshots y multiplica por tarifas.

```typescript
calcularHorasUsuarioEnPeriodo(cedula, inicio, fin)
calcularHorasTodosEnPeriodo(inicio, fin, operaciones)
```

### Generador Excel de nómina (`src/lib/excel/nomina.ts`)

Genera un `.xlsx` con:
- 1 línea por empleado × día (fecha de entrada, IN/OUT en hora entera, desglose de horas por tipo)
- Duplicación de líneas si hay >1 novedad el mismo día
- Tabla de totales al final: subtotales, códigos de nómina, valor por hora, porcentaje sobre hora normal, total `horas × valor`

Endpoint: `GET /api/reportes/nomina?start=YYYY-MM-DD&end=YYYY-MM-DD&op=OP1,OP2`

---

### CRON diario (`/api/cron/autocierre`)

Schedule: `0 0 * * *` UTC (= 19:00 Colombia). Protegido con `CRON_SECRET`.

1. **Inconsistencias**: jornadas ABIERTO >16h → estado INCONSISTENTE + alerta.
2. **Cierre dominical**: si **ayer** (hora Colombia) fue domingo → calcula cumplimiento 44h para cada empleado (minutos ordinarios + novedades remuneradas), upsert a `semanas_dominicales`.

---

### RBAC

| Rol | Acceso |
|-----|--------|
| **admin** | Todo. Único con `/admin/operaciones` y `/admin/usuarios`. |
| **coordinador** | Dashboard filtrado a su `operacion_nombre`. |
| **trabajador** | Sin cuenta auth. Solo usa el quiosco via cédula. |

Doble enforcement: middleware (rutas) + server actions (`requireAdmin`, `requireAdminOrCoordinador`).

4 clientes Supabase (`src/lib/supabase/`):
- `client.ts` — browser
- `server.ts` — server components + actions (con cookies)
- `middleware.ts` — session refresh
- `admin.ts` — service role (bypass RLS, solo para crear auth accounts)

---

### Estructura de carpetas

```
src/
├── app/
│   ├── page.tsx                           # Quiosco (ENTRADA / SALIDA)
│   ├── actions.ts                         # validarCedula, registrarAsistenciaAPI
│   ├── login/                             # Auth Supabase (email + password)
│   ├── api/
│   │   ├── cron/autocierre/route.ts       # CRON diario
│   │   └── reportes/nomina/route.ts       # Excel de nómina
│   └── (dashboard)/                       # Layout con sidebar
│       ├── admin/                         # Reporte administrativo + filtros + botón nómina
│       │   ├── operaciones/               # CRUD operaciones + turnos (admin only)
│       │   └── usuarios/                  # Gestión perfiles admin/coord (admin only)
│       ├── empleados/
│       │   └── [cedula]/                  # Detalle: bolsa, jornadas, novedades, aprobaciones
│       ├── novedades/                     # Formulario + historial
│       └── aprobaciones/                  # Extras pendientes + corrección inconsistentes
│
├── lib/
│   ├── auth.ts                            # RBAC helpers
│   ├── calculoHoras.ts                    # Motor por tramos + utilidades tiempo
│   ├── jornadas.ts                        # API jornadas + motor de liquidación
│   ├── reportes.ts                        # Agregación por período
│   ├── excel/nomina.ts                    # Generador Excel
│   ├── supabase/                          # 4 clientes (client/server/middleware/admin)
│   └── utils.ts                           # cn()
│
├── components/ui/                         # shadcn (card, button, table, tabs, etc.)
└── middleware.ts                          # Auth + RBAC route gates
```

---

### Convenciones de código

- **Server Components fetchean, Client Components interactúan.** Cada ruta: `page.tsx` (server) + `*Client.tsx` / `*Form.tsx` (client) + `actions.ts` (server actions).
- **Path alias**: `@/*` → `./src/*`
- **Timezone**: el server trabaja en UTC. `toColombiaTime` solo para clasificación del motor.
- **Reportes**: leen `jornadas` (snapshot precalculado), nunca recalculan.
- **Commits**: conventional commits, sin AI attribution.
- **CLI tools**: `bat` (cat), `rg` (grep), `fd` (find), `sd` (sed), `eza` (ls).

---

### Scripts de migración

```
scripts/
├── migrate-prod-to-dev.ts     # Migra datos de prod al schema nuevo en dev
├── backup-prod.ts             # Backup de prod como JSON (sin fotos)
├── migration.env.example      # Template de credenciales
└── migration.env              # Credenciales reales (en .gitignore)
```

La migración convierte la tabla `registros` (eventos ENTRADA/SALIDA del schema viejo) a `jornadas` con snapshot calculado, ejecutando el motor de liquidación sobre cada par histórico.

---

### RLS

- `authenticated` → full CRUD en todas las tablas.
- `anon` → SELECT en `usuarios` y `operaciones` (el quiosco valida cédulas).
- `perfiles` → solo el propio usuario puede leer su fila; escrituras requieren service_role.

---

### Deploy

El proyecto se deploya en **Netlify** (configuración en `netlify.toml`). El proceso nocturno lo dispara la función programada `netlify/functions/autocierre.mjs`, que todos los días a las 00:00 UTC (19:00 Colombia) llama a `/api/cron/autocierre`:

```js
export const config = { schedule: '0 0 * * *' }
```

Variables de entorno a crear en Netlify → Site configuration → Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y `CRON_SECRET` (protege el endpoint del proceso nocturno).
