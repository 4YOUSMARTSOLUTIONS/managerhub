-- Absenteísmo (LUIZ, 12/11/2026):
--
-- 1. Cancelar um lançamento em aberto (a pessoa chegou depois das primeiras
--    horas) manda um e-mail aos destinatários do comunicado pedindo para
--    desconsiderá-lo. O log de envios passa a aceitar o evento 'cancelado'.
--
-- 2. O CPF do colaborador aparece no "Ver" do lançamento. `profiles.cpf` não
--    tem SELECT para `authenticated` (AGENTS.md: privilégio de coluna), então
--    a leitura é uma RPC com a mesma guarda de quem pode ver o lançamento
--    (`pode_ver_absenteismo`: quem lançou, o gestor da pessoa, owner/admin/RH).

alter table public.absenteismo_emails drop constraint absenteismo_emails_event_check;
alter table public.absenteismo_emails
  add constraint absenteismo_emails_event_check
    check (event = any (array['aberto', 'confirmado', 'aprovado', 'reprovado', 'reenvio', 'direto', 'cancelado']));

create or replace function public.absenteismo_cpf(p_id uuid)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_l record;
  v_cpf text;
begin
  select l.tenant_id, l.user_id, l.created_by into v_l
    from public.absenteismo_lancamentos l
   where l.id = p_id;
  if v_l.tenant_id is null
     or not public.pode_ver_absenteismo(v_l.tenant_id, v_l.user_id, v_l.created_by) then
    return null;
  end if;

  select p.cpf into v_cpf from public.profiles p where p.id = v_l.user_id;
  return v_cpf;
end;
$function$;

comment on function public.absenteismo_cpf(uuid) is
  'CPF do colaborador de um lançamento de absenteísmo, para o "Ver". Mesma guarda de quem vê o lançamento.';

-- AGENTS.md: SECURITY DEFINER fora do alcance da chave pública
revoke execute on function public.absenteismo_cpf(uuid) from public, anon;
grant execute on function public.absenteismo_cpf(uuid) to authenticated;

notify pgrst, 'reload schema';
