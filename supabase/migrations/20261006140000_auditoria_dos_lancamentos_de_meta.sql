-- Auditoria dos LANÇAMENTOS de meta individual.
--
-- O indicador (`individual_goals`) já era auditado desde a cobertura ampla de
-- 20260731020819, mas o lançamento não. Resultado: dava para reconstruir que um
-- indicador foi renomeado, e não que a meta de setembro foi de 95 para 2. E é no
-- lançamento que mora o número que paga a remuneração variável.
--
-- POR QUE UMA FUNÇÃO PRÓPRIA, e não o `audit_trigger()` genérico: ele monta o
-- rótulo do registro a partir de uma coluna de nome da própria linha
-- (`name`, `title`, `full_name`…). O lançamento não tem nenhuma: ele é
-- (meta, competência), e o nome mora na tabela do indicador. Com o genérico, uma
-- alteração de meta apareceria nos Logs como um id solto, sem dizer de quem nem
-- de qual mês, que é justamente o que se quer saber. O preço é a duplicação do
-- laço de diff; o ganho é um log que se lê sem consultar o banco.
create or replace function public.audit_lancamento_de_meta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant  uuid;
  v_id      text;
  v_goal    uuid;
  v_period  date;
  v_label   text;
  v_row     jsonb;
  v_old     jsonb;
  v_new     jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key     text;
  v_val     jsonb;
  -- `goal_id` fica de fora do diff porque já está no rótulo, e porque ele não
  -- muda: o lançamento é identificado por (meta, competência).
  v_ignore constant text[] := array[
    'id','tenant_id','goal_id','created_at','updated_at','updated_by','created_by','deleted_at'
  ];
begin
  if (tg_op = 'DELETE') then
    v_tenant := old.tenant_id; v_id := old.id::text; v_row := to_jsonb(old);
    v_goal := old.goal_id; v_period := old.period;
  else
    v_tenant := new.tenant_id; v_id := new.id::text; v_row := to_jsonb(new);
    v_goal := new.goal_id; v_period := new.period;
  end if;

  -- "Baixa de pagamentos · 09/2026 · MARIA FERNANDA ROCHA CANABRAVA"
  select g.name || ' · ' || to_char(v_period, 'MM/YYYY') || coalesce(' · ' || p.full_name, '')
    into v_label
    from public.individual_goals g
    left join public.profiles p on p.id = g.owner_id
   where g.id = v_goal;

  if (tg_op = 'UPDATE') then
    v_old := to_jsonb(old); v_new := to_jsonb(new);
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key = any(v_ignore) then continue; end if;
      if (v_old->v_key) is distinct from (v_new->v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key, jsonb_build_object('de', v_old->v_key, 'para', v_new->v_key)
        );
      end if;
    end loop;
    -- só `updated_at` mexeu: não vira linha de log
    if v_changes = '{}'::jsonb then return new; end if;
  else
    for v_key, v_val in select key, value from jsonb_each(v_row) loop
      if v_key = any(v_ignore) then continue; end if;
      if v_val is null or v_val = 'null'::jsonb or v_val = '""'::jsonb then continue; end if;
      v_changes := v_changes || jsonb_build_object(v_key, v_val);
    end loop;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, entity_label, changes)
  values (v_tenant, auth.uid(), tg_op, tg_table_name, v_id, v_label, v_changes);

  if (tg_op = 'DELETE') then return old; else return new; end if;
end;
$function$;

-- Função de gatilho: ninguém a chama pelo app, e chamada direta nem funcionaria
-- fora de um trigger. O revoke é a regra da casa mesmo assim, porque o Postgres
-- concede EXECUTE ao PUBLIC por padrão.
revoke execute on function public.audit_lancamento_de_meta() from public, anon, authenticated;

create or replace trigger audit_individual_goal_entries
  after insert or update or delete on public.individual_goal_entries
  for each row execute function public.audit_lancamento_de_meta();

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
