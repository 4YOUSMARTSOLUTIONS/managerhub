-- Marcação "Fora da folha" (LUIZ, 27/11/2026).
--
-- Os sócios diretores usam o sistema mas não são empregados: não estão no
-- Domínio, não têm férias, ponto nem absenteísmo. Com a marcação:
--   - férias: fora do painel (agora, próximas, linha do tempo, saldos e as
--     contagens de vencidas), do resumo semanal de vencimento, do modelo de
--     lançamento em lote e do painel do 13º;
--   - absenteísmo: fora da lista de quem pode receber uma ausência (na tela);
--   - importação do Domínio: fora do aviso "ativos que não vieram no arquivo"
--     (na tela).
-- Quem marca é owner, admin ou DP: é dado do cadastro, não permissão.

alter table public.memberships add column if not exists fora_da_folha boolean not null default false;
comment on column public.memberships.fora_da_folha is
  'Usa o sistema sem ser empregado da folha (ex.: sócios diretores): fora de férias, absenteísmo e do aviso da importação do Domínio.';

create or replace function public.so_dp_marca_fora_da_folha()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.fora_da_folha)
     or (tg_op = 'UPDATE' and new.fora_da_folha is distinct from old.fora_da_folha) then
    if not public.has_tenant_role(new.tenant_id, '{owner,admin,hr}'::public.member_role[]) then
      raise exception 'Só o proprietário, um administrador ou o DP marcam quem está fora da folha';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.so_dp_marca_fora_da_folha() from public, anon, authenticated;

drop trigger if exists memberships_so_dp_marca_fora_da_folha on public.memberships;
create trigger memberships_so_dp_marca_fora_da_folha
  before insert or update on public.memberships
  for each row execute function public.so_dp_marca_fora_da_folha();

-- ---------------------------------------------------------------------------
-- Férias: as quatro funções que escolhem PESSOAS (as de aviso ao DP ou ao
-- gestor ficam como estão: um sócio pode receber avisos). Patch no lugar, pela
-- âncora: o corpo vivo tem patches (Área de Gente) que um corpo recopiado perderia.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  a text;
begin
  -- painel: filtra o conjunto de pessoas uma vez, e isso cobre agora, próximas,
  -- linha do tempo, saldos e as contagens de vencidas
  v_def := pg_get_functiondef('public.ferias_painel(uuid,date,uuid[])'::regprocedure);
  a := $q$v_ids := coalesce(v_ids, '{}');$q$;
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception 'ferias_painel mudou: âncora do fora da folha não confere';
  end if;
  execute replace(v_def, a, a || $q$
  -- fora da folha (sócios): sem férias (LUIZ, 27/11/2026)
  v_ids := array(select x from unnest(v_ids) x
                  where not exists (select 1 from public.memberships mf
                                     where mf.tenant_id = p_tenant and mf.user_id = x and mf.fora_da_folha));$q$);

  -- resumo semanal de vencimento (cron)
  v_def := pg_get_functiondef('public.ferias_alertas_vencimento()'::regprocedure);
  a := $q$   where ms.is_active
     and ms.admission_date is not null$q$;
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception 'ferias_alertas_vencimento mudou: âncora do fora da folha não confere';
  end if;
  execute replace(v_def, a, a || E'\n     and not ms.fora_da_folha');

  -- modelo do lançamento em lote
  v_def := pg_get_functiondef('public.ferias_modelo_lancamento(uuid,date)'::regprocedure);
  a := $q$and m.user_id = any(coalesce(v_ids, '{}'))$q$;
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception 'ferias_modelo_lancamento mudou: âncora do fora da folha não confere';
  end if;
  execute replace(v_def, a, 'and not m.fora_da_folha ' || a);

  -- painel do 13º
  v_def := pg_get_functiondef('public.ferias_painel_decimo(uuid,integer,uuid[])'::regprocedure);
  a := '       and m.is_active';
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception 'ferias_painel_decimo mudou: âncora do fora da folha não confere';
  end if;
  execute replace(v_def, a, a || E'\n       and not m.fora_da_folha');
end $$;

-- os grants continuam os de antes; a regra da casa é fechar de novo
revoke execute on function public.ferias_painel(uuid, date, uuid[]) from public, anon;
revoke execute on function public.ferias_modelo_lancamento(uuid, date) from public, anon;
revoke execute on function public.ferias_painel_decimo(uuid, integer, uuid[]) from public, anon;
revoke execute on function public.ferias_alertas_vencimento() from public, anon, authenticated;

notify pgrst, 'reload schema';
