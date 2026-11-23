-- ════════════════════════════════════════════════════════════════════
-- Migración 003: documentos enviados por los colaboradores
--
-- El colaborador entra al portal (/portal) con su cédula y envía un PDF
-- (incapacidad, cita médica, permiso…) con una descripción. El
-- administrador y el coordinador de su operación lo revisan en el panel
-- "Documentos": Marcar revisado, Rechazar (con nota) o Devolver a pendientes.
--
-- Solo agrega una tabla y un almacenamiento privado. No borra nada.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.documentos (
    id              uuid primary key default gen_random_uuid(),
    empleado_id     text not null references public.usuarios(id) on update cascade on delete cascade,
    descripcion     text not null,
    archivo_ruta    text not null,                       -- ruta en el almacenamiento privado
    archivo_nombre  text not null,                       -- nombre original del PDF
    archivo_tamano  integer not null default 0,          -- bytes
    estado          text not null default 'PENDIENTE'
                    check (estado in ('PENDIENTE', 'REVISADO', 'RECHAZADO')),
    nota            text,                                -- obligatoria al rechazar
    revisado_por    text,
    revisado_en     timestamptz,
    created_at      timestamptz not null default now()
);
create index if not exists documentos_estado_idx on public.documentos (estado, created_at desc);
create index if not exists documentos_empleado_idx on public.documentos (empleado_id, created_at desc);

-- Mismo esquema de seguridad que las demás tablas de trabajo:
-- solo cuentas con sesión iniciada. El portal escribe desde el servidor.
alter table public.documentos enable row level security;
drop policy if exists documentos_autenticados on public.documentos;
create policy documentos_autenticados on public.documentos
    for all to authenticated using (true) with check (true);

-- Almacenamiento privado para los PDF (máx. 10 MB, solo PDF).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos-empleados', 'documentos-empleados', false, 10485760, array['application/pdf'])
on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

select 'documentos' as tabla, count(*) as filas from public.documentos;
