-- ════════════════════════════════════════════════════════════════════
-- Migración 004: tarifas y códigos de nómina (desde el 15/07/2026)
--
-- Valor hora ordinaria = SMMLV 2026 $1.750.905 / 210 h (semana de 42 h)
--                      = $8.337,64
-- Recargo dominical/festivo 90 % (Ley 2466 de 2025, desde julio de 2026).
--
--   H.E.D   11001  125 %  10.422   extra diurna
--   H.E.N   11002  175 %  14.591   extra nocturna
--   E.F.D   11330  215 %  17.926   extra festiva diurna
--   E.F.N   11331  265 %  22.095   extra festiva nocturna
--   R.N     11501   35 %   2.918   recargo nocturno (SOLO el recargo)
--   R.F.N   11344  225 %  18.760   recargo festivo nocturno
--   R.F     11345  190 %  15.842   recargo festivo / dominical
--
-- Solo actualiza la tabla tarifas. No toca jornadas.
-- ════════════════════════════════════════════════════════════════════
insert into public.tarifas (tipo_hora, precio_por_hora, codigo_nomina, activo) values
    ('normal',                        8337.642857, null,    true),
    ('nocturno',                      2918,        '11501', true),
    ('extra',                         10422,       '11001', true),
    ('extraNocturno',                 14591,       '11002', true),
    ('domingo',                       15842,       '11345', true),
    ('festivo',                       15842,       '11345', true),
    ('domingoFestivoNocturno',        18760,       '11344', true),
    ('extraDominicalFestivo',         17926,       '11330', true),
    ('extraNocturnaDominicalFestivo', 22095,       '11331', true)
on conflict (tipo_hora) do update
    set precio_por_hora = excluded.precio_por_hora,
        codigo_nomina   = excluded.codigo_nomina,
        activo          = true;

select tipo_hora, precio_por_hora, codigo_nomina from public.tarifas order by precio_por_hora;
