-- Correção de 20261110230000: `v_lista || 'seg_blitz'` lia o literal como
-- array ("malformed array literal") e derrubava `minhas_telas` para o
-- avaliador com acesso restrito. array_append deixa o tipo explícito. Pego na
-- simulação, antes de qualquer pessoa ter a marca.

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
    v_lista := array_append(v_lista, 'seg_blitz'::text);
  end if;
  return v_lista;
end $$;
revoke execute on function public.minhas_telas(uuid) from public, anon;
