-- Equipes do setor: a carteira do comercial ajustada no sistema (LUIZ, 26/11/2026).
--
-- Todo mês o DP pedia ao comercial uma planilha com o gestor de cada RN e
-- promotor, e a repassava à planilha de importação. Agora quem cuida da
-- carteira ajusta direto, em Configurações > Colaboradores > Equipes do setor:
--   - marca "Ajusta equipes do setor" na ficha, concedida por owner/admin;
--   - vale só para colaboradores do MESMO setor de quem tem a marca, e o
--     gestor novo também precisa ser do setor (decisão do LUIZ);
--   - a mudança tem data e entra no histórico (membership_history);
--   - o gestor que perde e o que recebe a pessoa são avisados no sino.
-- Owner, admin e DP usam a mesma subaba para qualquer setor.

-- ---------------------------------------------------------------------------
-- 1. A marca
-- ---------------------------------------------------------------------------
alter table public.memberships add column if not exists is_ajusta_equipe boolean not null default false;
comment on column public.memberships.is_ajusta_equipe is
  'Ajusta equipes do setor: muda gestor e subsetor de quem é do mesmo setor, com data (equipe_transferir). Concedida só por owner/admin.';

create or replace function public.so_administracao_concede_ajusta_equipe()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.is_ajusta_equipe)
     or (tg_op = 'UPDATE' and new.is_ajusta_equipe is distinct from old.is_ajusta_equipe) then
    if not public.has_tenant_role(new.tenant_id, '{owner,admin}'::public.member_role[]) then
      raise exception 'Só o proprietário ou um administrador concede o ajuste de equipes do setor';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.so_administracao_concede_ajusta_equipe() from public, anon, authenticated;

drop trigger if exists memberships_so_administracao_concede_ajusta_equipe on public.memberships;
create trigger memberships_so_administracao_concede_ajusta_equipe
  before insert or update on public.memberships
  for each row execute function public.so_administracao_concede_ajusta_equipe();

-- ---------------------------------------------------------------------------
-- 2. Acesso por nível: com a marca, Configurações entra na lista (a página
--    mostra a essa pessoa só a subaba Equipes do setor)
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.minhas_telas(uuid)'::regprocedure);
  a_sel text := $q$select role, is_hr, hierarchy_level_id, is_avaliador_blitz into v_m$q$;
  a_fim text := $q$    v_lista := array_append(v_lista, 'seg_blitz'::text);
  end if;$q$;
begin
  if position(a_sel in v_def) = 0 or position(a_fim in v_def) = 0 then
    raise exception 'minhas_telas mudou: âncoras da marca de equipes não encontradas';
  end if;
  v_def := replace(v_def, a_sel, $q$select role, is_hr, hierarchy_level_id, is_avaliador_blitz, is_ajusta_equipe into v_m$q$);
  v_def := replace(v_def, a_fim, a_fim || $q$
  if v_lista is not null and v_m.is_ajusta_equipe and not ('configuracoes' = any(v_lista)) then
    v_lista := array_append(v_lista, 'configuracoes'::text);
  end if;$q$);
  execute v_def;
end $$;
revoke execute on function public.minhas_telas(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 3. Histórico com a origem certa: a versão de 3 argumentos grava a origem
--    pedida; a de 2 (usada pela importação) continua gravando 'importacao'
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.membership_history_registrar(uuid,date)'::regprocedure);
  a_sig text := 'public.membership_history_registrar(p_mid uuid, p_from date)';
begin
  if position(a_sig in v_def) = 0
     or (length(v_def) - length(replace(v_def, $q$'importacao'$q$, ''))) / length($q$'importacao'$q$) <> 3 then
    raise exception 'membership_history_registrar mudou: âncoras da origem não conferem';
  end if;
  v_def := replace(v_def, a_sig, 'public.membership_history_registrar(p_mid uuid, p_from date, p_source text)');
  v_def := replace(v_def, $q$'importacao'$q$, 'coalesce(p_source, ''importacao'')');
  execute v_def;
end $$;
revoke execute on function public.membership_history_registrar(uuid, date, text) from public, anon, authenticated;

create or replace function public.membership_history_registrar(p_mid uuid, p_from date)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  perform public.membership_history_registrar(p_mid, p_from, 'importacao');
end $$;
revoke execute on function public.membership_history_registrar(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. A transferência
-- ---------------------------------------------------------------------------
create or replace function public.equipe_transferir(
  p_tenant uuid, p_membros uuid[], p_subsetor uuid, p_gestor uuid, p_data date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := (select auth.uid());
  v_eu public.memberships%rowtype;
  v_amplo boolean;
  v_gestor public.memberships%rowtype;
  v_gestor_nome text;
  v_mid uuid;
  v_m record;
  v_novo_sub uuid;
  v_novo_gestor uuid;
  v_sub_nome text;
  v_data_txt text := to_char(p_data, 'DD/MM/YYYY');
  v_movidos int := 0;
  v_iguais int := 0;
begin
  if v_user is null then
    raise exception 'Sessão expirada. Faça login novamente.' using errcode = '42501';
  end if;
  select * into v_eu from public.memberships where tenant_id = p_tenant and user_id = v_user and is_active;
  v_amplo := public.is_super_admin() or public.has_tenant_role(p_tenant, '{owner,admin,hr}'::public.member_role[]);
  if not v_amplo and (v_eu.id is null or not v_eu.is_ajusta_equipe) then
    raise exception 'Sem permissão para ajustar equipes.' using errcode = '42501';
  end if;
  if not v_amplo and v_eu.department_id is null then
    raise exception 'Seu cadastro não tem setor: peça ao DP para completar a sua ficha.';
  end if;

  if coalesce(array_length(p_membros, 1), 0) = 0 then
    raise exception 'Escolha ao menos um colaborador.';
  end if;
  if p_subsetor is null and p_gestor is null then
    raise exception 'Escolha o subsetor novo, o gestor novo ou os dois.';
  end if;
  if p_data is null then
    raise exception 'Informe a data da mudança: o primeiro dia na equipe nova.';
  end if;
  if p_data > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A data da mudança não pode ser futura.';
  end if;

  if p_gestor is not null then
    select * into v_gestor from public.memberships
     where tenant_id = p_tenant and user_id = p_gestor and is_active;
    if not found then
      raise exception 'O gestor escolhido não está ativo nesta empresa.';
    end if;
    if not v_amplo and v_gestor.department_id is distinct from v_eu.department_id then
      raise exception 'O gestor novo precisa ser do seu setor.';
    end if;
    select full_name into v_gestor_nome from public.profiles where id = p_gestor;
  end if;

  foreach v_mid in array p_membros loop
    select m.*, p.full_name as nome into v_m
      from public.memberships m join public.profiles p on p.id = m.user_id
     where m.id = v_mid and m.tenant_id = p_tenant;
    if not found or not v_m.is_active then
      raise exception 'Colaborador não encontrado ou inativo.';
    end if;
    if not v_amplo then
      if v_m.user_id = v_user then
        raise exception 'Você não pode mudar a sua própria equipe.';
      end if;
      if v_m.department_id is distinct from v_eu.department_id then
        raise exception '% não é do seu setor.', v_m.nome;
      end if;
    end if;
    if p_subsetor is not null and not exists (
         select 1 from public.subdepartments s
          where s.id = p_subsetor and s.tenant_id = p_tenant and s.active
            and s.department_id is not distinct from v_m.department_id) then
      raise exception '%: o subsetor escolhido não é do setor da pessoa.', v_m.nome;
    end if;
    if p_gestor is not null then
      if p_gestor = v_m.user_id then
        raise exception '% não pode ser gestor de si mesmo.', v_m.nome;
      end if;
      -- ciclo: a pessoa não pode estar acima do gestor novo na cadeia
      if exists (
        with recursive cadeia(uid, nivel) as (
          select p_gestor, 0
          union all
          select m2.manager_id, c.nivel + 1
            from cadeia c
            join public.memberships m2 on m2.user_id = c.uid and m2.tenant_id = p_tenant
           where m2.manager_id is not null and c.nivel < 30
        )
        select 1 from cadeia where uid = v_m.user_id
      ) then
        raise exception '% está acima de % na cadeia de gestão: a troca criaria um ciclo.', v_m.nome, coalesce(v_gestor_nome, 'o gestor escolhido');
      end if;
    end if;

    v_novo_sub := coalesce(p_subsetor, v_m.subdepartment_id);
    v_novo_gestor := coalesce(p_gestor, v_m.manager_id);
    if v_novo_sub is not distinct from v_m.subdepartment_id and v_novo_gestor is not distinct from v_m.manager_id then
      v_iguais := v_iguais + 1;
      continue;
    end if;

    update public.memberships
       set subdepartment_id = v_novo_sub, manager_id = v_novo_gestor
     where id = v_mid;
    begin
      perform public.membership_history_registrar(v_mid, p_data, 'equipe');
    exception when others then
      raise exception '%: %', v_m.nome, sqlerrm;
    end;

    -- avisos (decisão do LUIZ: o gestor que perde e o que recebe)
    if v_novo_gestor is distinct from v_m.manager_id then
      if v_novo_gestor is not null then
        perform public.notify_users_sistema(p_tenant, array[v_novo_gestor], 'equipe_mudanca',
          'Mudança na sua equipe',
          v_m.nome || ' entra na sua equipe a partir de ' || v_data_txt || '.');
      end if;
      if v_m.manager_id is not null then
        perform public.notify_users_sistema(p_tenant, array[v_m.manager_id], 'equipe_mudanca',
          'Mudança na sua equipe',
          v_m.nome || ' sai da sua equipe a partir de ' || v_data_txt
            || coalesce(' e passa para ' || v_gestor_nome, '') || '.');
      end if;
    elsif v_novo_gestor is not null then
      select name into v_sub_nome from public.subdepartments where id = v_novo_sub;
      perform public.notify_users_sistema(p_tenant, array[v_novo_gestor], 'equipe_mudanca',
        'Mudança na sua equipe',
        v_m.nome || ' passa para ' || coalesce(v_sub_nome, 'outro subsetor') || ' a partir de ' || v_data_txt || '.');
    end if;
    v_movidos := v_movidos + 1;
  end loop;

  return jsonb_build_object('movidos', v_movidos, 'semMudanca', v_iguais);
end $$;
revoke execute on function public.equipe_transferir(uuid, uuid[], uuid, uuid, date) from public, anon;
grant execute on function public.equipe_transferir(uuid, uuid[], uuid, uuid, date) to authenticated;

notify pgrst, 'reload schema';
