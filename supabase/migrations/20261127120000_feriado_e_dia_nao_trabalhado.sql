-- Feriado x dia não trabalhado (LUIZ, 27/11/2026).
--
-- A lista própria de feriados da empresa servia a duas coisas: dia sem
-- expediente (agenda, salas, reuniões recorrentes) e feriado da regra de férias
-- (art. 134 §3º: o início não cai em feriado nem nos 2 dias antes dele, nem nos
-- 2 dias antes do DSR). Os "SÁBADO NÃO TRABALHADO" cadastrados barravam o início
-- de férias nas quintas, e sábado de folga não é feriado nem DSR.
--
-- Agora cada dia da lista tem um tipo:
--   feriado         : sem expediente E conta na regra de férias;
--   nao_trabalhado  : sem expediente (sábado de folga, ponte, recesso, ponto
--                     facultativo como o carnaval), mas não barra férias.
-- O DSR (domingo) e os 2 dias antes dele já são barrados pelo dia da semana.

alter table public.holidays add column if not exists tipo text not null default 'feriado';
alter table public.holidays drop constraint if exists holidays_tipo;
alter table public.holidays add constraint holidays_tipo check (tipo in ('feriado', 'nao_trabalhado'));
comment on column public.holidays.tipo is
  'feriado: sem expediente e conta no art. 134 das férias; nao_trabalhado: só sem expediente (sábado de folga, ponte, recesso, ponto facultativo).';

-- os sábados de folga que a empresa já cadastrou
update public.holidays set tipo = 'nao_trabalhado'
 where tipo = 'feriado' and name ~* 'n(ã|a)o\s+trabalhad';

-- Feriado de verdade: o nacional ou o da empresa do tipo feriado. O is_holiday
-- continua respondendo "dia sem expediente" (os dois tipos) para as reuniões.
create or replace function public.is_feriado_legal(p_tenant uuid, p_date date)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select public.national_holiday_name(p_date) is not null
      or exists (select 1 from public.holidays
                  where tenant_id = p_tenant and day = p_date and tipo = 'feriado');
$$;
revoke execute on function public.is_feriado_legal(uuid, date) from public, anon;

-- Férias: a regra do art. 134 passa a olhar só feriado. Patch pela âncora: o
-- corpo vivo pode ter ajustes que um corpo recopiado perderia.
do $$
declare
  v_def text;
  a text := 'public.is_holiday(p_tenant, r.ini';
begin
  v_def := pg_get_functiondef('public.ferias_validar_periodos(uuid,uuid,jsonb,date,uuid,boolean)'::regprocedure);
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 3 then
    raise exception 'ferias_validar_periodos mudou: âncora do feriado não confere';
  end if;
  execute replace(v_def, a, 'public.is_feriado_legal(p_tenant, r.ini');
end $$;
revoke execute on function public.ferias_validar_periodos(uuid, uuid, jsonb, date, uuid, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
