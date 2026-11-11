-- ════════════════════════════════════════════════════════════════════
-- Migración 002 — novedades pendientes de los coordinadores
--
-- Agrega lo necesario para: perfil Visualizador, fecha de ingreso, cambio de
-- operación con fecha de vigencia, cierre de incidencias por quincena,
-- geocerca, marcación sin conexión, fotos cifradas y auditoría.
--
-- Solo AGREGA columnas y tablas: no borra ni modifica datos existentes.
-- Se puede ejecutar más de una vez.
-- ════════════════════════════════════════════════════════════════════

-- ─── Perfil Visualizador (solo consulta) ─────────────────────────────
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles
    add constraint perfiles_rol_check check (rol in ('admin', 'coordinador', 'visualizador'));

-- ─── Colaboradores: fecha de ingreso y autorización de datos ─────────
alter table public.usuarios add column if not exists fecha_ingreso date;
-- Momento en que el colaborador autorizó el tratamiento de sus datos
-- personales y biométricos (Ley 1581 de 2012). Vacío = no ha autorizado.
alter table public.usuarios add column if not exists autorizacion_datos_en timestamptz;

-- ─── Geocerca por operación ──────────────────────────────────────────
alter table public.operaciones add column if not exists latitud double precision;
alter table public.operaciones add column if not exists longitud double precision;
alter table public.operaciones add column if not exists radio_metros integer;

-- ─── Jornadas: ubicación, marcación sin conexión y fotos ─────────────
alter table public.jornadas add column if not exists entrada_lat double precision;
alter table public.jornadas add column if not exists entrada_lng double precision;
alter table public.jornadas add column if not exists entrada_distancia_m integer;
alter table public.jornadas add column if not exists salida_lat double precision;
alter table public.jornadas add column if not exists salida_lng double precision;
alter table public.jornadas add column if not exists salida_distancia_m integer;
-- true = alguna marcación quedó fuera del radio de la operación, o sin ubicación
alter table public.jornadas add column if not exists fuera_geocerca boolean not null default false;
-- true = alguna marcación se hizo sin internet y se sincronizó después
alter table public.jornadas add column if not exists marcacion_offline boolean not null default false;
-- Ruta de la foto cifrada dentro del almacenamiento privado
alter table public.jornadas add column if not exists foto_entrada text;
alter table public.jornadas add column if not exists foto_salida text;

-- ─── Horas extra: cómo se resolvió cada una ──────────────────────────
alter table public.aprobaciones_extras add column if not exists resultado text;
alter table public.aprobaciones_extras drop constraint if exists aprobaciones_extras_resultado_check;
alter table public.aprobaciones_extras
    add constraint aprobaciones_extras_resultado_check
    check (resultado is null or resultado in
        ('PAGADA_NOMINA', 'COMPENSADA_TIEMPO', 'RECONOCIDA_CLIENTE', 'NO_APROBADA'));

-- ─── Cambios de operación (CECO) con fecha de vigencia ───────────────
create table if not exists public.cambios_operacion (
    id                 uuid primary key default gen_random_uuid(),
    empleado_id        text not null,
    operacion_anterior text,
    operacion_nueva    text not null,
    vigente_desde      date not null,
    motivo             text not null,
    autor              text not null,
    aplicado           boolean not null default false,
    aplicado_en        timestamptz,
    created_at         timestamptz not null default now(),
    constraint cambios_operacion_empleado_id_fkey
        foreign key (empleado_id) references public.usuarios(id) on update cascade on delete cascade
);
create index if not exists cambios_operacion_pendientes_idx
    on public.cambios_operacion (aplicado, vigente_desde);
create index if not exists cambios_operacion_empleado_idx
    on public.cambios_operacion (empleado_id, created_at);

-- ─── Cierres de quincena (con respaldo de lo que se cerró) ───────────
create table if not exists public.cierres_quincena (
    id                    uuid primary key default gen_random_uuid(),
    periodo_inicio        date not null,
    periodo_fin           date not null,
    automatico            boolean not null default false,
    ejecutado_por         text not null,
    aprobaciones_cerradas integer not null default 0,
    alertas_cerradas      integer not null default 0,
    jornadas_pendientes   integer not null default 0,
    respaldo              jsonb not null default '{}'::jsonb,
    created_at            timestamptz not null default now()
);
create index if not exists cierres_quincena_periodo_idx on public.cierres_quincena (periodo_fin);

-- ─── Auditoría: quién hizo qué, cuándo y por qué ─────────────────────
create table if not exists public.auditoria (
    id         uuid primary key default gen_random_uuid(),
    accion     text not null,
    entidad    text not null,
    entidad_id text,
    autor      text not null,
    motivo     text,
    detalle    jsonb,
    created_at timestamptz not null default now()
);
create index if not exists auditoria_entidad_idx on public.auditoria (entidad, entidad_id);
create index if not exists auditoria_fecha_idx on public.auditoria (created_at);

-- ─── Seguridad de las tablas nuevas ──────────────────────────────────
do $$
declare
    t text;
begin
    foreach t in array array['cambios_operacion', 'cierres_quincena', 'auditoria'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists %I on public.%I', t || '_autenticados', t);
        execute format(
            'create policy %I on public.%I for all to authenticated using (true) with check (true)',
            t || '_autenticados', t
        );
    end loop;
end $$;

-- ─── Almacenamiento privado para las fotos cifradas ──────────────────
-- Sin políticas públicas: solo el servidor (clave secreta) puede leer y escribir.
insert into storage.buckets (id, name, public)
values ('fotos-asistencia', 'fotos-asistencia', false)
on conflict (id) do nothing;
