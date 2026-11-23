-- Número do chamado no padrão das ações (LUIZ, 23/11/2026).
--
-- Chamado novo deixa de nascer "CH-0007": o número é o maior da empresa + 1, como em
-- `assign_action_code`. O "#" é só exibição (`numeroChamado`).
--
-- SECURITY DEFINER de propósito: a leitura de `tickets` é restrita, e quem abre um
-- chamado não enxerga os dos colegas. Sem isso o "maior número" seria só o dele, e o
-- próximo chamado bateria na trava de número único.

create or replace function public.tickets_before_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.code is null then
    perform pg_advisory_xact_lock(hashtext('tickets_code:' || new.tenant_id::text));
    select coalesce(max(t.code::bigint), 0) + 1 into new.code
    from public.tickets t
    where t.tenant_id = new.tenant_id and t.code ~ '^[0-9]{1,18}$';
  end if;
  return new;
end;
$function$;

revoke execute on function public.tickets_before_insert() from public, anon, authenticated;

-- a sequência antiga deixa de numerar, então a importação não precisa mais empurrá-la
do $migracao$
declare
  v_def text := pg_get_functiondef('public.chamados_importar(uuid, jsonb, boolean)'::regprocedure);
  v_de text := $a$        returning id into v_id;

        -- ID no formato da numeração do sistema: o próximo chamado não pode repeti-lo
        if v_id_planilha ~ '^CH-[0-9]{1,15}$' then
          perform setval('public.ticket_code_seq',
            greatest(substring(v_id_planilha from 4)::bigint, (select last_value from public.ticket_code_seq)));
        end if;
$a$;
  v_para text := $b$        returning id into v_id;
$b$;
begin
  if position(v_de in v_def) = 0 then
    raise exception 'chamados_importar: trecho da sequência não encontrado';
  end if;
  execute replace(v_def, v_de, v_para);
end
$migracao$;

revoke execute on function public.chamados_importar(uuid, jsonb, boolean) from public, anon;
grant execute on function public.chamados_importar(uuid, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
