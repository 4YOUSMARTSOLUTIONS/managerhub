-- Importação de colaboradores: complemento das regras e prévia mais clara
-- (LUIZ, 26/11/2026, depois do primeiro teste do DP com o arquivo do Domínio).
--
-- 1. A regra função → hierarquia nasceu só dos ATIVOS. Funções que hoje só
--    têm desligados ficaram "sem regra" mesmo quando o histórico conhece a
--    hierarquia (4 na Cervantes), e uma da aba "Hierarquia" da planilha do DP
--    não tem ninguém no sistema. As demais funções sem regra (as de quem saiu
--    antes de existir hierarquia, ou que nunca foram usadas) seguem sem: não
--    há de onde tirar.
-- 2. A prévia dizia "Dados do cadastro atualizados (e-mail, telefone,
--    nascimento ou sexo)" sem dizer qual. Agora diz o campo.

-- 1a. a hierarquia mais comum entre os desligados, para função ainda sem regra
insert into public.regra_funcao_hierarquia (tenant_id, position_id, hierarchy_level_id)
select distinct on (m.tenant_id, m.position_id) m.tenant_id, m.position_id, m.hierarchy_level_id
  from public.memberships m
  join public.positions p on p.id = m.position_id and p.tenant_id = m.tenant_id
  join public.hierarchy_levels h on h.id = m.hierarchy_level_id and h.tenant_id = m.tenant_id
 where m.position_id is not null and m.hierarchy_level_id is not null
 group by m.tenant_id, m.position_id, m.hierarchy_level_id
 order by m.tenant_id, m.position_id, count(*) desc, m.hierarchy_level_id
on conflict (tenant_id, position_id) do nothing;

-- 1b. Cervantes: a função da aba "Hierarquia" da planilha do DP que não tem
-- ninguém no sistema
insert into public.regra_funcao_hierarquia (tenant_id, position_id, hierarchy_level_id)
select p.tenant_id, p.id, h.id
  from public.positions p
  join public.hierarchy_levels h on h.tenant_id = p.tenant_id and public.nome_canonico(h.name) = 'analista'
 where p.tenant_id = '373d5ce2-9c41-4cad-bfe7-24b80616ffa9'
   and public.nome_canonico(p.name) = 'analista financeiro pleno'
on conflict (tenant_id, position_id) do nothing;

-- 2. o campo que mudou, na lista de dados pessoais da prévia
do $$
declare
  v_def text := pg_get_functiondef('public.admin_import_employees(jsonb,text,boolean)'::regprocedure);
  a_decl text := $q$  v_avisos jsonb := '[]'::jsonb;$q$;
  a_upd text := $q$          update public.profiles set
            full_name = trim(r->>'full_name'),
            email = coalesce(v_email, email),
            phone = coalesce(nullif(trim(r->>'phone'), ''), phone),
            birth_date = coalesce(public.parse_br_date(r->>'birth_date'), birth_date),
            gender = v_gender
          where id = v_existing_uid
            and (full_name, email, phone, birth_date, gender) is distinct from ($q$;
  a_mot text := $q$'motivo', 'Dados do cadastro atualizados (e-mail, telefone, nascimento ou sexo)', 'tipo', 'dados');$q$;
begin
  if (length(v_def) - length(replace(v_def, a_decl, ''))) / length(a_decl) <> 1
     or (length(v_def) - length(replace(v_def, a_upd, ''))) / length(a_upd) <> 1
     or (length(v_def) - length(replace(v_def, a_mot, ''))) / length(a_mot) <> 1 then
    raise exception 'admin_import_employees mudou: âncoras dos dados pessoais não conferem';
  end if;

  v_def := replace(v_def, a_decl, a_decl || E'\n  v_campos text;');
  v_def := replace(v_def, a_upd, $q$          -- quais campos a linha muda, para a prévia dizer (antes do update)
          select concat_ws(', ',
                   case when p4.full_name is distinct from trim(r->>'full_name') then 'nome' end,
                   case when p4.email is distinct from coalesce(v_email, p4.email) then 'e-mail' end,
                   case when p4.phone is distinct from coalesce(nullif(trim(r->>'phone'), ''), p4.phone) then 'telefone' end,
                   case when p4.birth_date is distinct from coalesce(public.parse_br_date(r->>'birth_date'), p4.birth_date) then 'data de nascimento' end,
                   case when p4.gender is distinct from v_gender then 'sexo' end)
            into v_campos
            from public.profiles p4 where p4.id = v_existing_uid;
$q$ || a_upd);
  v_def := replace(v_def, a_mot,
    $q$'motivo', 'Dados atualizados: ' || coalesce(nullif(v_campos, ''), 'cadastro'), 'tipo', 'dados');$q$);
  execute v_def;
end $$;

revoke execute on function public.admin_import_employees(jsonb, text, boolean) from public, anon;

notify pgrst, 'reload schema';
