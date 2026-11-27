-- Carnaval não é feriado nacional (LUIZ, 27/11/2026).
--
-- A lista nacional trazia a segunda e a terça de carnaval, e isso barrava o
-- início de férias em 08/02/2027 ("O início cai num feriado (art. 134)"). Por
-- lei federal o carnaval é ponto facultativo, não feriado (os feriados civis são
-- os da Lei 662/1949 com as alterações posteriores; os religiosos, os da Lei
-- 9.093/1995). Empresa ou cidade que folga no carnaval cadastra o dia na lista
-- própria de feriados (Configurações).
--
-- Efeitos: férias (art. 134), agenda, salas e as reuniões recorrentes, que
-- deixam de pular os dois dias. A rotina das 3h (topup_all_series_bookings)
-- devolve as ocorrências empurradas para o dia da série, que é o mesmo dia do
-- convite de calendário (RRULE sem exceção de feriado).
--
-- Espelho no aplicativo: src/lib/holidays.ts.

create or replace function public.national_holiday_name(p_date date)
returns text
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  y int := extract(year from p_date)::int;
  e date := public.easter_sunday(y);
  mmdd text := to_char(p_date, 'MM-DD');
begin
  if p_date = e - 2  then return 'Sexta-feira Santa'; end if;
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

notify pgrst, 'reload schema';
