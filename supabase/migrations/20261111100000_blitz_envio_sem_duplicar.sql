-- Blitz registrada sem internet (LUIZ, 10/11/2026).
--
-- O celular da portaria perde o sinal. O app passa a guardar a blitz no
-- aparelho e enviar sozinho quando a conexão volta, e para isso o MESMO envio
-- pode chegar mais de uma vez: a fila reenvia, ou o servidor gravou e a
-- resposta se perdeu no caminho. Cada blitz nasce no aparelho com um código
-- (`client_id`), e o banco devolve a que já existe em vez de gravar outra.
--
-- Compatível com o app de antes: sem `client_id`, nada muda.

alter table public.seg_blitz_avaliacoes add column if not exists client_id uuid;
alter table public.seg_blitz_avaliacoes
  add constraint seg_blitz_avaliacoes_client_id_key unique (client_id);

create or replace function public.seg_criar_blitz(p_data jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant   uuid := public.my_active_tenant();
  v_user     uuid := nullif(p_data->>'user_id', '')::uuid;
  v_client   uuid := nullif(p_data->>'client_id', '')::uuid;
  v_meio     record;
  v_ocorrido date := nullif(p_data->>'occurred_on', '')::date;
  v_liberado boolean := coalesce((p_data->>'liberado')::boolean, true);
  v_motivo   uuid := nullif(p_data->>'motivo_bloqueio_id', '')::uuid;
  v_placa    text := upper(regexp_replace(coalesce(p_data->>'placa', ''), '[^A-Za-z0-9]', '', 'g'));
  v_tipo     text := nullif(btrim(coalesce(p_data->>'veiculo_tipo', '')), '');
  v_cor      text := nullif(lower(btrim(coalesce(p_data->>'cor', ''))), '');
  v_prop     public.seg_veiculo_propriedade;
  v_veiculo  uuid;
  v_conforme boolean;
  v_id       uuid;
  v_av       record;
  v_existe   record;
  r          jsonb;
  v_pergunta record;
begin
  if v_tenant is null then
    raise exception 'Você não tem acesso a esta empresa.';
  end if;
  if not public.pode_avaliar_blitz(v_tenant) then
    raise exception 'Só gestores e a equipe de segurança avaliam a blitz.';
  end if;

  -- o mesmo envio de novo: devolve a blitz gravada antes. Fica antes das
  -- conferências de propósito, porque a pessoa pode ter sido desligada entre
  -- o primeiro envio e o reenvio, e a blitz dela já está no sistema
  if v_client is not null then
    select a.id, a.tenant_id, a.created_by into v_existe
      from public.seg_blitz_avaliacoes a
     where a.client_id = v_client;
    if v_existe.id is not null then
      if v_existe.tenant_id <> v_tenant or v_existe.created_by is distinct from (select auth.uid()) then
        raise exception 'Este registro de blitz pertence a outra pessoa.';
      end if;
      return v_existe.id;
    end if;
  end if;

  if v_ocorrido is null then
    raise exception 'Informe a data da blitz.';
  end if;
  if not exists (
    select 1 from public.memberships m
     where m.user_id = v_user and m.tenant_id = v_tenant and m.is_active
  ) then
    raise exception 'Escolha um colaborador válido.';
  end if;

  select m.* into v_meio
    from public.seg_blitz_meios m
   where m.id = nullif(p_data->>'meio_id', '')::uuid and m.tenant_id = v_tenant and m.active;
  if v_meio.id is null then
    raise exception 'Escolha o meio de transporte.';
  end if;

  if not v_liberado and v_motivo is null then
    raise exception 'Bloqueio precisa de um motivo.';
  end if;
  if v_motivo is not null and not exists (
    select 1 from public.seg_blitz_motivos x where x.id = v_motivo and x.tenant_id = v_tenant
  ) then
    raise exception 'Motivo de bloqueio inválido.';
  end if;

  v_conforme := v_liberado and not exists (
    select 1 from jsonb_array_elements(coalesce(p_data->'respostas', '[]'::jsonb)) x
     where x->>'resposta' = 'nao'
  );

  if v_meio.tem_veiculo then
    -- tudo obrigatório quando há veículo (LUIZ, 10/11/2026)
    if v_placa = '' then
      raise exception 'Informe a placa do veículo.';
    end if;
    if v_tipo is null then
      raise exception 'Informe o modelo do veículo.';
    end if;
    if nullif(p_data->>'propriedade', '') is null then
      raise exception 'Informe a propriedade do veículo.';
    end if;
    if v_cor is null or v_cor not in ('branco', 'preto', 'prata', 'cinza', 'vermelho', 'azul', 'outra') then
      raise exception 'Informe a cor do veículo.';
    end if;
    v_prop := (p_data->>'propriedade')::public.seg_veiculo_propriedade;

    insert into public.seg_veiculos (tenant_id, user_id, meio_id, placa, tipo_descricao, propriedade, cor)
    values (v_tenant, v_user, v_meio.id, v_placa, v_tipo, v_prop, v_cor)
    on conflict (tenant_id, placa) do update
      set user_id = excluded.user_id,
          meio_id = excluded.meio_id,
          tipo_descricao = excluded.tipo_descricao,
          propriedade = excluded.propriedade,
          cor = excluded.cor,
          active = true
    returning id into v_veiculo;
  else
    v_placa := null;
    v_tipo := null;
    v_prop := null;
    v_cor := null;
  end if;

  begin
    insert into public.seg_blitz_avaliacoes (
      tenant_id, occurred_on, user_id, meio_id, veiculo_id,
      placa, veiculo_tipo, propriedade, cor,
      liberado, motivo_bloqueio_id, observacao, conforme, created_by, client_id
    ) values (
      v_tenant, v_ocorrido, v_user, v_meio.id, v_veiculo,
      v_placa, v_tipo, v_prop, v_cor,
      v_liberado, case when v_liberado then null else v_motivo end,
      nullif(btrim(coalesce(p_data->>'observacao', '')), ''),
      v_conforme, (select auth.uid()), v_client
    )
    returning * into v_av;
  exception when unique_violation then
    -- os dois envios chegaram juntos (o original lento e o reenvio): o outro
    -- gravou primeiro, com respostas e aviso ao gestor; este só devolve o id
    select a.id into v_id
      from public.seg_blitz_avaliacoes a
     where a.client_id = v_client and a.tenant_id = v_tenant and a.created_by = (select auth.uid());
    if v_id is null then
      raise;
    end if;
    return v_id;
  end;
  v_id := v_av.id;

  for r in select * from jsonb_array_elements(coalesce(p_data->'respostas', '[]'::jsonb))
  loop
    select q.id, q.name into v_pergunta
      from public.seg_blitz_perguntas q
     where q.id = nullif(r->>'pergunta_id', '')::uuid and q.tenant_id = v_tenant;
    if v_pergunta.id is null then
      continue;
    end if;
    insert into public.seg_blitz_respostas (avaliacao_id, tenant_id, pergunta_id, snap_pergunta, resposta)
    values (v_id, v_tenant, v_pergunta.id, v_pergunta.name, (r->>'resposta')::public.seg_blitz_resposta)
    on conflict (avaliacao_id, pergunta_id) do nothing;
  end loop;

  -- o fecho do ciclo: não conforme aciona o gestor DA ÉPOCA automaticamente
  if not v_conforme and v_av.snap_manager_id is not null then
    insert into public.seg_blitz_alertas (tenant_id, avaliacao_id, gestor_id)
    values (v_tenant, v_id, v_av.snap_manager_id)
    on conflict (avaliacao_id) do nothing;

    perform public.notify_users(
      v_tenant, array[v_av.snap_manager_id], 'seg_blitz_alerta',
      'Blitz de trajeto não conforme na sua equipe',
      coalesce(v_av.snap_full_name, 'Um colaborador') || ' saiu ' ||
      case when v_liberado then 'liberado com desvio' else 'bloqueado' end ||
      ' na blitz de ' || to_char(v_ocorrido, 'DD/MM/YYYY') ||
      '. Converse com a pessoa e registre a tratativa.',
      null
    );
  end if;

  return v_id;
end;
$function$;

revoke execute on function public.seg_criar_blitz(jsonb) from public, anon;

notify pgrst, 'reload schema';
