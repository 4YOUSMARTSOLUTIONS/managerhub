-- Punição nascida de um lançamento não se edita pela tela antiga.
--
-- A FK `on delete restrict` já recusa a EXCLUSÃO, mas não diz nada sobre o
-- update: dava para trocar a data ou o tipo da sanção pelo Registro direto e o
-- lançamento continuaria exibindo o que foi aprovado, com o documento assinado
-- anexado, enquanto o fato dizia outra coisa. Divergência silenciosa, que é o
-- pior tipo.
--
-- A tela já desabilita os botões, mas isso é conforto: quem chamar o PostgREST
-- direto passaria. A garantia é aqui.
create or replace function public.guard_sancao_de_lancamento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (select 1 from public.punicao_lancamentos l where l.sanction_id = old.id)
     and (new.user_id is distinct from old.user_id
          or new.sanction_type_id is distinct from old.sanction_type_id
          or new.occurred_on is distinct from old.occurred_on)
  then
    raise exception 'Esta punição veio de um lançamento aprovado. Para desfazê-la, cancele o lançamento em Punições.';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_sancao_de_lancamento() from public, anon, authenticated;

drop trigger if exists trg_guard_sancao_de_lancamento on public.employee_sanctions;
create trigger trg_guard_sancao_de_lancamento
  before update on public.employee_sanctions
  for each row execute function public.guard_sancao_de_lancamento();

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
