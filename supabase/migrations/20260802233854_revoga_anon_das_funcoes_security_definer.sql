-- Toda funcao SECURITY DEFINER roda com os privilegios do dono, ou seja, a RLS nao
-- se aplica por dentro dela. A unica protecao e a guarda escrita no corpo. Deixa-las
-- ao alcance da chave publica significa que um erro numa guarda vira exposicao
-- anonima, sem nenhuma segunda camada.
--
-- O Postgres concede EXECUTE ao PUBLIC por padrao em toda funcao nova, entao isso
-- volta a acontecer a cada RPC criada: novas migracoes devem repetir o revoke.
--
-- Verificado antes de aplicar: as 49 alcancaveis pelo anon tem grant EXPLICITO para
-- authenticated e service_role, logo remover PUBLIC/anon nao afeta quem esta logado.
-- Verificado tambem que email_by_cpf era a unica RPC chamada antes do login.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end $$;

-- Internas: nao ha chamador no app, so outras funcoes SECURITY DEFINER e cron.
-- Chamada interna nao precisa de grant (a checagem ocorre sob o dono), entao nem
-- usuario logado precisa alcanca-las.
revoke execute on function public.demanda_close_if_all_done(uuid) from authenticated;
revoke execute on function public.topup_all_series_bookings() from authenticated;
revoke execute on function public.auto_finish_overdue_meetings() from authenticated;
