-- Abrir a ação não é ter tratado o relato.
--
-- Estava errado: `seg_vincular_acao` marcava o relato como `tratado` no
-- instante em que a ação era criada. Só que a ação acabou de nascer, com prazo
-- para daqui uma semana e ninguém tendo feito nada ainda. O painel mostrava
-- "relato tratado" enquanto o buraco no piso continuava lá.
--
-- A régua correta:
--   abrir a ação  → o relato vai para `triado` (em tratativa);
--   concluir a AÇÃO (todas as suas demandas) → o relato vira `tratado`,
--   automaticamente, e o relator é avisado.
--
-- E como nem todo relato precisa de ação (muitos são corrigidos na hora, ou são
-- comportamento seguro, que é reconhecimento), a equipe continua podendo
-- concluir a tratativa direto pela triagem, sem ação nenhuma.
--
-- O gatilho vive em `action_demandas` porque é lá que a conclusão acontece; a
-- primeira coisa que ele faz é perguntar se aquela ação tem relato vinculado, e
-- para toda ação do resto do sistema ele sai na primeira linha.

create or replace function public.seg_vincular_acao(p_relato_id uuid, p_action_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_r record;
begin
  select r.* into v_r from public.seg_relatos r where r.id = p_relato_id;
  if v_r.id is null then
    raise exception 'Relato não encontrado.';
  end if;
  perform public.seg_exige_tratativa(v_r.tenant_id);

  if not exists (
    select 1 from public.actions a where a.id = p_action_id and a.tenant_id = v_r.tenant_id
  ) then
    raise exception 'Ação não encontrada nesta empresa.';
  end if;

  insert into public.seg_relato_acoes (relato_id, action_id, tenant_id, created_by)
  values (p_relato_id, p_action_id, v_r.tenant_id, (select auth.uid()))
  on conflict (relato_id, action_id) do nothing;

  -- EM TRATATIVA, não tratado: quem fecha o relato é a conclusão da ação
  if v_r.status = 'aberto' then
    update public.seg_relatos
       set status = 'triado',
           triado_por = coalesce(triado_por, (select auth.uid())),
           triado_em = coalesce(triado_em, now())
     where id = p_relato_id;
  end if;

  if v_r.created_by is not null then
    perform public.notify_users(
      v_r.tenant_id, array[v_r.created_by], 'seg_relato_desfecho',
      'Seu relato virou ação',
      'A equipe de segurança abriu uma ação com prazo para tratar o que você apontou. Você é avisado quando ela for concluída.',
      null
    );
  end if;
end;
$$;

revoke execute on function public.seg_vincular_acao(uuid, uuid) from public, anon;
grant  execute on function public.seg_vincular_acao(uuid, uuid) to authenticated;

/**
 * Fecha o relato quando a ação de tratamento termina.
 *
 * "Terminar" é: todas as demandas da ação em `done`. Uma ação com três demandas
 * e duas concluídas continua em aberto, e o relato também.
 */
create or replace function public.seg_relato_fecha_com_acao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_falta integer;
  v_r     record;
begin
  -- sai cedo para as ações que não vieram de relato, que são a maioria
  if not exists (select 1 from public.seg_relato_acoes x where x.action_id = new.action_id) then
    return null;
  end if;

  select count(*) into v_falta
    from public.action_demandas d
   where d.action_id = new.action_id
     and d.status <> 'done';
  if v_falta > 0 then
    return null;
  end if;

  for v_r in
    select r.*
      from public.seg_relatos r
      join public.seg_relato_acoes ra on ra.relato_id = r.id
     where ra.action_id = new.action_id
       and r.status in ('aberto', 'triado')
  loop
    update public.seg_relatos
       set status = 'tratado',
           triado_em = coalesce(triado_em, now())
     where id = v_r.id;

    if v_r.created_by is not null then
      -- `notify_users_sistema`: quem concluiu a demanda pode não ser membro do
      -- tenant do relato pela ótica do guard de `notify_users` (o caminho é
      -- disparado por trigger, não por uma tela de segurança)
      perform public.notify_users_sistema(
        v_r.tenant_id, array[v_r.created_by], 'seg_relato_desfecho',
        'Seu relato foi tratado',
        'A ação aberta a partir do que você apontou foi concluída. Obrigado por relatar.'
      );
    end if;
  end loop;

  return null;
end;
$$;

revoke execute on function public.seg_relato_fecha_com_acao() from public, anon, authenticated;

drop trigger if exists seg_relato_fecha_com_acao on public.action_demandas;
create trigger seg_relato_fecha_com_acao
  after update of status on public.action_demandas
  for each row
  when (new.status = 'done' and old.status is distinct from 'done')
  execute function public.seg_relato_fecha_com_acao();

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
