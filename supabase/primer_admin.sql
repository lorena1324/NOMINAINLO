-- ════════════════════════════════════════════════════════════════════
-- Primer administrador
--
-- 1. En Supabase ve a Authentication → Users → "Add user" → "Create new user".
--    Escribe el correo y una contraseña segura, y deja marcado "Auto Confirm User".
-- 2. Cambia abajo el correo por el que acabas de crear y ejecuta este script
--    en el SQL Editor.
--
-- Los demás usuarios (administradores y coordinadores) se crean después
-- desde la app, en el menú "Usuarios".
-- ════════════════════════════════════════════════════════════════════
insert into public.perfiles (id, rol)
select id, 'admin'
from auth.users
where email = 'admin@inlotrans.com'   -- ← cambia el correo si usaste otro
on conflict (id) do update set rol = 'admin', operacion_nombre = null;

-- Debe devolver una fila con el correo y el rol "admin".
-- Si no devuelve nada, el usuario del paso 1 no existe o el correo no coincide.
select u.email, p.rol
from public.perfiles p
join auth.users u on u.id = p.id;
