-- Ausência nascida de um lançamento aprovado não se edita pela tela antiga.
--
-- A FK `on delete restrict` já recusa a EXCLUSÃO em Configurações › Colaboradores
-- › Férias e afastamentos, mas não dizia nada sobre o update: dava para trocar as
-- datas ou o tipo por lá enquanto o lançamento continuava exibindo o período
-- aprovado, com o atestado anexado. Divergência silenciosa entre o processo e o
-- fato, que é o pior tipo.
--
-- Mesma trava que a 20260814106000 pôs em `employee_sanctions`.
create or replace function public.guard_ausencia_de_lancamento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (select 1 from public.absenteismo_lancamentos l where l.absence_id = old.id)
     and (new.user_id is distinct from old.user_id
          or new.kind is distinct from old.kind
          or new.start_date is distinct from old.start_date
          or new.end_date is distinct from old.end_date)
  then
    raise exception 'Esta ausência veio de um lançamento aprovado. Para desfazê-la, cancele o lançamento em Absenteísmos.';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_ausencia_de_lancamento() from public, anon, authenticated;

drop trigger if exists trg_guard_ausencia_de_lancamento on public.employee_absences;
create trigger trg_guard_ausencia_de_lancamento
  before update on public.employee_absences
  for each row execute function public.guard_ausencia_de_lancamento();

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
