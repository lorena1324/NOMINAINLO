-- ════════════════════════════════════════════════════════════════════
-- Inlotrans Asistencia — esquema completo de la base de datos
--
-- Cómo usarlo: en Supabase abre "SQL Editor", pega TODO este archivo y
-- pulsa "Run". Se puede ejecutar más de una vez sin dañar nada: solo crea
-- lo que falte y no borra datos.
--
-- Después de ejecutarlo, crea el primer administrador con
-- supabase/primer_admin.sql.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─── Operaciones (centros de trabajo / CECO) ─────────────────────────
create table if not exists public.operaciones (
    id               uuid primary key default gen_random_uuid(),
    codigo           text not null unique,              -- INL-XXXX
    nombre           text not null unique,
    status           boolean not null default true,     -- activa / inactiva
    limite_horas     integer not null default 8 check (limite_horas in (8, 12)),
    max_extras_dia   integer not null default 2,
    minutos_almuerzo integer not null default 0,        -- descuento automático en jornadas > 5 h
    created_at       timestamptz not null default now()
);

-- ─── Turnos por operación (base para calcular retardos) ──────────────
create table if not exists public.turnos (
    id           uuid primary key default gen_random_uuid(),
    operacion_id uuid not null references public.operaciones(id) on delete cascade,
    nombre       text not null,
    hora_inicio  time not null,
    hora_fin     time not null,
    created_at   timestamptz not null default now()
);
create index if not exists turnos_operacion_idx on public.turnos (operacion_id);

-- ─── Colaboradores (la llave es la cédula) ───────────────────────────
create table if not exists public.usuarios (
    id         text primary key,                         -- cédula, sin puntos
    nombre     text not null,
    cargo      text,
    operacion  text,                                     -- nombre de la operación por defecto
    status     text not null default 'activo' check (status in ('activo', 'inactivo')),
    birthdate  date,
    turno_id   uuid references public.turnos(id) on delete set null,
    salario    numeric,
    created_at timestamptz not null default now()
);
create index if not exists usuarios_operacion_idx on public.usuarios (operacion);

-- ─── Perfiles: cuentas que entran al panel (admin / coordinador) ─────
create table if not exists public.perfiles (
    id               uuid primary key references auth.users(id) on delete cascade,
    rol              text not null check (rol in ('admin', 'coordinador')),
    operacion_nombre text,                               -- solo coordinadores
    created_at       timestamptz not null default now()
);

-- ─── Tarifas por tipo de hora ────────────────────────────────────────
create table if not exists public.tarifas (
    tipo_hora       text primary key,
    precio_por_hora numeric not null,
    codigo_nomina   text,                                -- código del concepto en nómina
    activo          boolean not null default true
);

-- ─── Jornadas (entrada → salida). Entidad central ────────────────────
create table if not exists public.jornadas (
    id          uuid primary key default gen_random_uuid(),
    empleado_id text not null,
    operacion   text not null,
    entrada     timestamptz not null,
    salida      timestamptz,
    estado      text not null default 'ABIERTO'
                check (estado in ('ABIERTO', 'CERRADO', 'CERRADO_MANUAL', 'INCONSISTENTE')),
    minutos_normales                          integer not null default 0,
    minutos_nocturnas                         integer not null default 0,
    minutos_domingos                          integer not null default 0,
    minutos_festivos                          integer not null default 0,
    minutos_domingos_festivos_nocturnos       integer not null default 0,
    minutos_extras_ordinarias                 integer not null default 0,
    minutos_extras_nocturnas                  integer not null default 0,
    minutos_extras_dominical_festivo          integer not null default 0,
    minutos_extras_nocturna_dominical_festivo integer not null default 0,
    minutos_total                             integer not null default 0,
    minutos_almuerzo_descontados              integer not null default 0,
    cerrada_por        text check (cerrada_por in ('empleado', 'coordinador', 'cron')),
    hora_salida_manual timestamptz,
    alerta_critica     boolean not null default false,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    constraint jornadas_empleado_id_fkey
        foreign key (empleado_id) references public.usuarios(id) on update cascade
);
create index if not exists jornadas_empleado_entrada_idx on public.jornadas (empleado_id, entrada);
create index if not exists jornadas_entrada_idx on public.jornadas (entrada);
create index if not exists jornadas_estado_idx on public.jornadas (estado);
-- Un colaborador no puede tener dos jornadas abiertas al mismo tiempo
create unique index if not exists jornadas_una_abierta_por_empleado
    on public.jornadas (empleado_id) where estado = 'ABIERTO';

-- ─── Novedades (incapacidades, permisos, vacaciones, etc.) ───────────
create table if not exists public.novedades (
    id              uuid primary key default gen_random_uuid(),
    usuario_id      text not null,
    usuario_nombre  text,
    tipo_novedad    text not null,
    fecha_novedad   date,
    fecha_inicio    date,
    fecha_fin       date,
    es_pagado       boolean not null default false,
    codigo_causa    integer,
    tipo_ausentismo integer,
    valor_monetario numeric,
    descripcion     text,
    created_at      timestamptz not null default now(),
    constraint novedades_usuario_id_fkey
        foreign key (usuario_id) references public.usuarios(id) on update cascade
);
create index if not exists novedades_usuario_fecha_idx on public.novedades (usuario_id, fecha_novedad);

-- ─── Aprobaciones de horas extra ─────────────────────────────────────
create table if not exists public.aprobaciones_extras (
    id                  uuid primary key default gen_random_uuid(),
    jornada_id          uuid not null,
    empleado_id         text not null,
    minutos_solicitados integer not null,
    estado              text not null default 'PENDIENTE'
                        check (estado in ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
    coordinador_id      uuid,                            -- cuenta que aprobó o rechazó
    nota_coordinador    text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    constraint aprobaciones_extras_jornada_id_fkey
        foreign key (jornada_id) references public.jornadas(id) on delete cascade,
    constraint aprobaciones_extras_empleado_id_fkey
        foreign key (empleado_id) references public.usuarios(id) on update cascade
);
create index if not exists aprobaciones_extras_estado_idx on public.aprobaciones_extras (estado);
create index if not exists aprobaciones_extras_empleado_idx on public.aprobaciones_extras (empleado_id);

-- ─── Bolsa de horas (saldo por colaborador) ──────────────────────────
create table if not exists public.bolsa_horas (
    empleado_id   text primary key,
    saldo_minutos integer not null default 0,
    updated_at    timestamptz not null default now(),
    constraint bolsa_horas_empleado_id_fkey
        foreign key (empleado_id) references public.usuarios(id) on update cascade
);

create table if not exists public.movimientos_bolsa (
    id            uuid primary key default gen_random_uuid(),
    empleado_id   text not null,
    jornada_id    uuid references public.jornadas(id) on delete set null,
    novedad_id    uuid references public.novedades(id) on delete set null,
    minutos       integer not null,
    motivo        text not null
                  check (motivo in ('ABONO_EXCEDENTE', 'CARGO_DEFICIT', 'NOVEDAD_COMPENSA', 'AJUSTE_MANUAL')),
    saldo_antes   integer not null,
    saldo_despues integer not null,
    nota          text,
    created_at    timestamptz not null default now(),
    constraint movimientos_bolsa_empleado_id_fkey
        foreign key (empleado_id) references public.usuarios(id) on update cascade
);
create index if not exists movimientos_bolsa_empleado_idx on public.movimientos_bolsa (empleado_id, created_at);

-- ─── Cumplimiento semanal (Ley 44 h) ─────────────────────────────────
create table if not exists public.semanas_dominicales (
    id                            uuid primary key default gen_random_uuid(),
    empleado_id                   text not null,
    semana_inicio                 date not null,
    semana_fin                    date not null,
    minutos_ordinarios            integer not null default 0,
    minutos_novedades_remuneradas integer not null default 0,
    total_minutos_cumplimiento    integer generated always as
                                  (minutos_ordinarios + minutos_novedades_remuneradas) stored,
    paga_domingo                  boolean,
    marcado_por                   text not null default 'sistema',
    created_at                    timestamptz not null default now(),
    constraint semanas_dominicales_empleado_id_fkey
        foreign key (empleado_id) references public.usuarios(id) on update cascade,
    constraint semanas_dominicales_empleado_semana_key unique (empleado_id, semana_inicio)
);

-- ─── Alertas para el coordinador ─────────────────────────────────────
create table if not exists public.alertas (
    id          uuid primary key default gen_random_uuid(),
    tipo        text not null check (tipo in ('INCONSISTENTE', 'ALERTA_CRITICA', 'EXTRAS_PENDIENTES')),
    empleado_id text not null,
    jornada_id  uuid references public.jornadas(id) on delete cascade,
    operacion   text,
    mensaje     text,
    leida       boolean not null default false,
    created_at  timestamptz not null default now(),
    constraint alertas_empleado_id_fkey
        foreign key (empleado_id) references public.usuarios(id) on update cascade
);
create index if not exists alertas_empleado_leida_idx on public.alertas (empleado_id, leida);
create index if not exists alertas_jornada_idx on public.alertas (jornada_id);

-- ─── updated_at automático ───────────────────────────────────────────
create or replace function public.tocar_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists jornadas_updated_at on public.jornadas;
create trigger jornadas_updated_at before update on public.jornadas
    for each row execute function public.tocar_updated_at();

-- ════════════════════════════════════════════════════════════════════
-- Seguridad (RLS)
--   · Cuentas con sesión iniciada: acceso completo a las tablas de trabajo.
--   · Sin sesión (anon): solo lectura de colaboradores y operaciones.
--   · perfiles: cada cuenta solo lee su propio perfil; los cambios se hacen
--     con la clave secreta del servidor.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
    t text;
begin
    foreach t in array array[
        'operaciones', 'turnos', 'usuarios', 'tarifas', 'jornadas', 'novedades',
        'aprobaciones_extras', 'bolsa_horas', 'movimientos_bolsa',
        'semanas_dominicales', 'alertas'
    ] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('drop policy if exists %I on public.%I', t || '_autenticados', t);
        execute format(
            'create policy %I on public.%I for all to authenticated using (true) with check (true)',
            t || '_autenticados', t
        );
    end loop;
end $$;

drop policy if exists usuarios_lectura_publica on public.usuarios;
create policy usuarios_lectura_publica on public.usuarios
    for select to anon using (true);

drop policy if exists operaciones_lectura_publica on public.operaciones;
create policy operaciones_lectura_publica on public.operaciones
    for select to anon using (true);

alter table public.perfiles enable row level security;
drop policy if exists perfiles_propio on public.perfiles;
create policy perfiles_propio on public.perfiles
    for select to authenticated using (auth.uid() = id);

-- ════════════════════════════════════════════════════════════════════
-- Datos iniciales: tarifas por hora (valores 2026 que trae la app por
-- defecto). El código de nómina queda vacío: complétalo desde el editor
-- de tablas con los códigos de tu sistema de nómina.
-- ════════════════════════════════════════════════════════════════════
insert into public.tarifas (tipo_hora, precio_por_hora) values
    ('normal',                        7959),
    ('nocturno',                      10745),
    ('extra',                         9948),
    ('extraNocturno',                 13928),
    ('domingo',                       14326),
    ('festivo',                       14326),
    ('domingoFestivoNocturno',        17111),
    ('extraDominicalFestivo',         17111),
    ('extraNocturnaDominicalFestivo', 21091)
on conflict (tipo_hora) do nothing;
