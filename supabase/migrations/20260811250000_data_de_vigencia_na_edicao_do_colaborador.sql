-- Edição do colaborador aceita a DATA DE VIGÊNCIA da movimentação.
--
-- O histórico registrava quando o sistema SOUBE da mudança (o commit); sistemas
-- de RH deixam o RH informar quando ela passou a VALER ("promovido em 01/07,
-- lançado dia 15"). O formulário ganha o campo opcional e o valor viaja por GUC
-- local à transação até o trigger `membership_history_capture`, que já o lê
-- (`app.mov_effective_date`) com fallback no momento do commit. O próprio
-- trigger recusa data anterior ao início da vigência aberta, então não há como
-- criar intervalos sobrepostos por aqui.
--
-- O corpo é remendado a partir do banco (molde da 20260807162000): a função é
-- longa e uma cópia à mão perderia linha em silêncio.
do $do$
declare
  v_def text;
  c_velha constant text := $q$  if not exists (select 1 from public.memberships where user_id = p_user and tenant_id = v_tenant) then
    raise exception 'Usuário não pertence à empresa';
  end if;$q$;
  c_nova constant text := $q$  if not exists (select 1 from public.memberships where user_id = p_user and tenant_id = v_tenant) then
    raise exception 'Usuário não pertence à empresa';
  end if;

  -- data de vigência da movimentação, informada pelo RH (opcional). Vai por GUC
  -- local à transação e é lida pelo trigger membership_history_capture; em
  -- branco, a vigência começa no momento do commit. Data futura é recusada:
  -- vigência à frente criaria um intervalo que ainda não começou.
  if nullif(trim(p_data->>'effective_date'), '') is not null then
    if (p_data->>'effective_date') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Data de vigência inválida';
    end if;
    if (p_data->>'effective_date')::date > current_date then
      raise exception 'A data de vigência não pode ser futura';
    end if;
  end if;
  perform set_config('app.mov_effective_date', coalesce(nullif(trim(p_data->>'effective_date'), ''), ''), true);$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_update_employee';

  if (length(v_def) - length(replace(v_def, c_velha, ''))) / length(c_velha) <> 1 then
    raise exception 'admin_update_employee: trecho esperado não está exatamente uma vez no corpo';
  end if;

  execute replace(v_def, c_velha, c_nova);
end
$do$;

revoke execute on function public.admin_update_employee(uuid, jsonb) from public, anon;
grant execute on function public.admin_update_employee(uuid, jsonb) to authenticated;
