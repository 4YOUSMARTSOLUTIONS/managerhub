-- ---------------------------------------------------------------------------
-- Férias: o modelo de programação em lote deixa de fora quem está afastado sem
-- data de retorno.
--
-- Pedido do LUIZ (09/11/2026). O modelo já trazia só ativos; os três casos de
-- aposentadoria por invalidez (afastamento com fim 9999-12-31, o "sem
-- retorno" de 20261031140000) apareciam nele, e não há férias a programar
-- para eles. Afastamento COM data de retorno continua no modelo: a pessoa
-- volta e tem férias a programar.
-- ---------------------------------------------------------------------------

do $do$
declare
  v_def text;
  v_velho text := $q$         and m.is_active
         and m.user_id = any(coalesce(v_ids, '{}'))$q$;
begin
  v_def := pg_get_functiondef('public.ferias_modelo_lancamento(uuid, date)'::regprocedure);
  if strpos(v_def, v_velho) = 0 then
    raise exception 'ferias_modelo_lancamento: trecho não encontrado';
  end if;
  v_def := replace(v_def, v_velho, $q$         and m.is_active
         -- afastado sem data de retorno (aposentadoria por invalidez) não tem
         -- férias a programar
         and not exists (select 1 from public.employee_absences a
                          where a.tenant_id = p_tenant and a.user_id = m.user_id
                            and a.end_date = date '9999-12-31' and a.start_date <= p_hoje)
         and m.user_id = any(coalesce(v_ids, '{}'))$q$);
  execute v_def;
end
$do$;

revoke execute on function public.ferias_modelo_lancamento(uuid, date) from public, anon;
