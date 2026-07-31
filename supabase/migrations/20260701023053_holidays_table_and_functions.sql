-- Feriados customizados (por tenant). Nacionais são calculados por função.
create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  day date not null,
  name text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tenant_id, day)
);

alter table public.holidays enable row level security;

create policy holidays_member_select on public.holidays
  for select using (public.is_tenant_member(tenant_id));

create policy holidays_admin_write on public.holidays
  for all
  using (public.has_tenant_role(tenant_id, array['owner','admin','manager']::member_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin','manager']::member_role[]));

-- Domingo de Páscoa (algoritmo de Meeus/Butcher, Gregoriano)
create or replace function public.easter_sunday(p_year int)
returns date
language plpgsql
immutable
as $$
declare
  a int := p_year % 19;
  b int := p_year / 100;
  c int := p_year % 100;
  d int := b / 4;
  e int := b % 4;
  f int := (b + 8) / 25;
  g int := (b - f + 1) / 3;
  h int := (19*a + b - d - g + 15) % 30;
  i int := c / 4;
  k int := c % 4;
  l int := (32 + 2*e + 2*i - h - k) % 7;
  m int := (a + 11*h + 22*l) / 451;
  v_month int := (h + l - 7*m + 114) / 31;
  v_day int := ((h + l - 7*m + 114) % 31) + 1;
begin
  return make_date(p_year, v_month, v_day);
end; $$;

-- Nome do feriado NACIONAL (fixos + móveis) ou null
create or replace function public.national_holiday_name(p_date date)
returns text
language plpgsql
immutable
as $$
declare
  y int := extract(year from p_date)::int;
  e date := public.easter_sunday(y);
  mmdd text := to_char(p_date, 'MM-DD');
begin
  if p_date = e - 2  then return 'Sexta-feira Santa'; end if;
  if p_date = e - 48 then return 'Carnaval'; end if;
  if p_date = e - 47 then return 'Carnaval'; end if;
  if p_date = e + 60 then return 'Corpus Christi'; end if;

  case mmdd
    when '01-01' then return 'Confraternização Universal';
    when '04-21' then return 'Tiradentes';
    when '05-01' then return 'Dia do Trabalho';
    when '09-07' then return 'Independência do Brasil';
    when '10-12' then return 'Nossa Senhora Aparecida';
    when '11-02' then return 'Finados';
    when '11-15' then return 'Proclamação da República';
    when '12-25' then return 'Natal';
    else null;
  end case;

  if mmdd = '11-20' and y >= 2024 then return 'Consciência Negra'; end if;
  return null;
end; $$;

-- Feriado (nacional OU customizado do tenant)?
create or replace function public.is_holiday(p_tenant uuid, p_date date)
returns boolean
language sql
stable
as $$
  select public.national_holiday_name(p_date) is not null
      or exists (select 1 from public.holidays where tenant_id = p_tenant and day = p_date);
$$;

notify pgrst, 'reload schema';
