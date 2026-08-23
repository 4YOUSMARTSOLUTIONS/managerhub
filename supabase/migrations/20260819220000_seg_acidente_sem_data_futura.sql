-- Acidente não acontece amanhã.
--
-- A data do ocorrido estava livre nas três camadas: o formulário aceitava
-- qualquer valor, a action só checava se veio preenchida, e o banco não tinha
-- nada. Retroativo PRECISA continuar valendo, porque o acidente costuma ser
-- cadastrado depois, quando a CAT sai e o afastamento é confirmado; o que não
-- pode é 2027 por erro de digitação entrar em silêncio e ainda sumir do painel
-- do ano corrente.
--
-- Por que TRIGGER e não CHECK: `current_date` é STABLE, e o Postgres só aceita
-- função IMMUTABLE dentro de check constraint. O gatilho cobre os mesmos
-- caminhos (insert e update, por RPC ou PostgREST), que é o que importa.
--
-- Quem responde "quando isso foi lançado" continua sendo `created_at`, que já
-- existe em toda linha desde a primeira migração do módulo, junto com
-- `created_by`. Não há nada a criar aqui: faltava mostrar na tela.

create or replace function public.seg_acidente_data_valida()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.occurred_on > current_date then
    raise exception 'A data do acidente não pode estar no futuro.';
  end if;
  -- a CAT também não é emitida antes do fato nem depois de amanhã
  if new.cat_emitida_em is not null and new.cat_emitida_em > current_date then
    raise exception 'A data de emissão da CAT não pode estar no futuro.';
  end if;
  return new;
end;
$$;

revoke execute on function public.seg_acidente_data_valida() from public, anon, authenticated;

drop trigger if exists seg_acidentes_data_valida on public.seg_acidentes;
create trigger seg_acidentes_data_valida
  before insert or update of occurred_on, cat_emitida_em on public.seg_acidentes
  for each row execute function public.seg_acidente_data_valida();

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception 'ha % funcoes SECURITY DEFINER alcancaveis por anon', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
