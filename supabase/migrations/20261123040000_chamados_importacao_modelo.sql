-- Importação de chamados por modelo, para revenda de qualquer sistema (LUIZ, 22/11/2026).
--
-- - ID passa a ser opcional. Sem ele o sistema numera, e a identidade da linha é o
--   próprio conteúdo: repetir o arquivo continua sem duplicar.
-- - Prioridade entra pela planilha (a exportação do SAVI não traz).
-- - O número do chamado passa a ser único POR EMPRESA. Com o índice global, a
--   segunda revenda a importar um "1001" perderia o próprio ID.
-- - Um ID no formato da numeração do sistema (CH-0010) empurra a sequência, senão
--   o próximo chamado aberto na tela bateria nele.

alter table public.tickets drop constraint if exists tickets_code_key;
alter table public.tickets drop constraint if exists tickets_tenant_code_key;
alter table public.tickets add constraint tickets_tenant_code_key unique (tenant_id, code);

do $migracao$
declare
  v_def text := pg_get_functiondef('public.chamados_importar(uuid, jsonb, boolean)'::regprocedure);
  v_par record;
begin
  for v_par in
    select * from (values
      ($a$  v_origem text;
$a$, $b$  v_origem text;
  v_id_planilha text;
  v_prio public.priority_level;
  v_prio_pedida public.priority_level;
$b$),
      ($a$      v_origem := nullif(btrim(v_l ->> 'id'), '');
      v_titulo := nullif(btrim(v_l ->> 'titulo'), '');
      if v_origem is null then raise exception 'Sem ID.'; end if;
      if v_titulo is null then raise exception 'Chamado % sem título.', v_origem; end if;
$a$, $b$      v_id_planilha := nullif(btrim(v_l ->> 'id'), '');
      v_titulo := nullif(btrim(v_l ->> 'titulo'), '');
      if v_titulo is null then raise exception 'Chamado sem título.'; end if;
      -- sem ID, a identidade é o conteúdo: repetir o arquivo continua sem duplicar
      v_origem := coalesce(v_id_planilha, 'sem-id:' || md5(
        public.chamado_chave(v_titulo) || '|' || coalesce(v_l ->> 'criado_em', '') || '|' || public.chamado_chave(v_l ->> 'criador')));
$b$),
      ($a$      if v_criado is null then raise exception 'Chamado % sem data de criação.', v_origem; end if;
      if v_status not in ('resolved', 'closed', 'cancelled') then v_concl := null; end if;
$a$, $b$      v_criado := coalesce(v_criado, now());
      if v_status not in ('resolved', 'closed', 'cancelled') then v_concl := null; end if;
      -- encerrado sem data: fecha no dia em que abriu, para contar no Dashboard
      if v_status in ('resolved', 'closed') and v_concl is null then v_concl := v_criado; end if;
      v_prio_pedida := nullif(v_l ->> 'prioridade', '')::public.priority_level;
      v_prio := coalesce(v_prio_pedida, 'medium');
$b$),
      ($a$          status, due_date, resolved_at, created_by, created_at, updated_at,$a$,
       $b$          status, priority, requested_priority, due_date, resolved_at, created_by, created_at, updated_at,$b$),
      ($a$          -- o código é o ID de lá; se outra empresa já o usa, cai na numeração normal
          case when exists (select 1 from public.tickets t where t.code = v_origem) then null else v_origem end,$a$,
       $b$          -- o número é o ID da planilha; sem ID, ou já usado nesta empresa, o sistema numera
          case when v_id_planilha is null
                 or exists (select 1 from public.tickets t where t.tenant_id = p_tenant and t.code = v_id_planilha)
               then null else v_id_planilha end,$b$),
      ($a$          v_status, v_prazo, v_concl, coalesce(v_req, v_eu), v_criado, coalesce(v_concl, v_criado),$a$,
       $b$          v_status, v_prio, v_prio_pedida, v_prazo, v_concl, coalesce(v_req, v_eu), v_criado, coalesce(v_concl, v_criado),$b$),
      ($a$        returning id into v_id;
$a$, $b$        returning id into v_id;

        -- ID no formato da numeração do sistema: o próximo chamado não pode repeti-lo
        if v_id_planilha ~ '^CH-[0-9]{1,15}$' then
          perform setval('public.ticket_code_seq',
            greatest(substring(v_id_planilha from 4)::bigint, (select last_value from public.ticket_code_seq)));
        end if;
$b$)
    ) as t(de, para)
  loop
    if (length(v_def) - length(replace(v_def, v_par.de, ''))) / length(v_par.de) <> 1 then
      raise exception 'chamados_importar: trecho não encontrado: %', left(v_par.de, 60);
    end if;
    v_def := replace(v_def, v_par.de, v_par.para);
  end loop;
  execute v_def;
end
$migracao$;

revoke execute on function public.chamados_importar(uuid, jsonb, boolean) from public, anon;
grant execute on function public.chamados_importar(uuid, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
