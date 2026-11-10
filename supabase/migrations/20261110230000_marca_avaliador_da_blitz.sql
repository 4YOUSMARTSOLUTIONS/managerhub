-- Marca "Avaliador da blitz" (LUIZ, 10/11/2026).
--
-- Quem faz a blitz na portaria nem sempre é gestor. O único caminho até aqui
-- era a Equipe de segurança, que enxerga relatos (inclusive o nome de quem
-- relatou anônimo) e acidentes com CID: acesso demais para quem só confere o
-- veículo. A marca, na ficha do colaborador, libera SÓ a blitz:
--   - lançar (`pode_avaliar_blitz`);
--   - ver as blitzes que ela mesma registrou (decisão do LUIZ), com respostas;
--   - ler o cadastro de veículos, de onde vem a sugestão do formulário;
--   - a tela da blitz, mesmo com acesso restrito por nível (`minhas_telas`).
-- Quem concede é proprietário ou administrador (trava abaixo, molde da
-- gestão de treinamentos).

alter table public.memberships add column if not exists is_avaliador_blitz boolean not null default false;

create or replace function public.so_administracao_concede_avaliador_blitz()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.is_avaliador_blitz)
     or (tg_op = 'UPDATE' and new.is_avaliador_blitz is distinct from old.is_avaliador_blitz) then
    if not public.has_tenant_role(new.tenant_id, '{owner,admin}'::public.member_role[]) then
      raise exception 'Só o proprietário ou um administrador concede a avaliação da blitz';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.so_administracao_concede_avaliador_blitz() from public, anon, authenticated;

drop trigger if exists memberships_so_administracao_concede_avaliador_blitz on public.memberships;
create trigger memberships_so_administracao_concede_avaliador_blitz
  before insert or update on public.memberships
  for each row execute function public.so_administracao_concede_avaliador_blitz();

create or replace function public.pode_avaliar_blitz(p_tenant uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select public.has_tenant_role(p_tenant, '{owner,admin,manager,team_lead}'::public.member_role[])
      or public.is_safety_member(p_tenant)
      or exists (
        select 1 from public.memberships m
         where m.tenant_id = p_tenant and m.user_id = (select auth.uid())
           and m.is_active and m.is_avaliador_blitz
      );
$$;
revoke execute on function public.pode_avaliar_blitz(uuid) from public, anon;

-- quem registrou vê o que registrou (com as respostas)
alter policy seg_blitz_av_select on public.seg_blitz_avaliacoes
  using (public.pode_ver_blitz(tenant_id, user_id) or created_by = (select auth.uid()));
alter policy seg_blitz_respostas_select on public.seg_blitz_respostas
  using (exists (
    select 1 from public.seg_blitz_avaliacoes a
     where a.id = seg_blitz_respostas.avaliacao_id
       and (public.pode_ver_blitz(a.tenant_id, a.user_id) or a.created_by = (select auth.uid()))
  ));
-- quem avalia lê o cadastro de veículos: é a sugestão de placa, modelo e cor
alter policy seg_veiculos_select on public.seg_veiculos
  using (public.pode_ver_blitz(tenant_id, user_id) or public.pode_avaliar_blitz(tenant_id));

-- a tela da blitz entra para o avaliador mesmo com acesso restrito por nível
create or replace function public.minhas_telas(p_tenant uuid)
returns text[]
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_m record;
  v_p record;
  v_lista text[];
begin
  if v_user is null then
    raise exception 'Sessão expirada. Faça login novamente.' using errcode = '42501';
  end if;
  if is_super_admin() then
    return null;
  end if;

  select role, is_hr, hierarchy_level_id, is_avaliador_blitz into v_m
    from memberships where tenant_id = p_tenant and user_id = v_user
   order by created_at limit 1;
  if not found then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if v_m.role in ('owner', 'admin') or v_m.is_hr then
    return null;
  end if;

  select livre, modulos into v_p from acesso_telas_pessoa where tenant_id = p_tenant and user_id = v_user;
  if found then
    if v_p.livre then
      return null;
    end if;
    v_lista := v_p.modulos;
  else
    select modulos into v_lista from acesso_telas_nivel
     where tenant_id = p_tenant and hierarchy_level_id = v_m.hierarchy_level_id;
  end if;

  -- null = sem restrição (o nível não tem regra)
  if v_lista is not null and v_m.is_avaliador_blitz and not ('seg_blitz' = any(v_lista)) then
    v_lista := v_lista || 'seg_blitz';
  end if;
  return v_lista;
end $$;
revoke execute on function public.minhas_telas(uuid) from public, anon;

notify pgrst, 'reload schema';
