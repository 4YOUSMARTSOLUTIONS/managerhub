-- Anexo de ação: alcança o arquivo quem vê a ação, e grava só quem criou a ação.
--
-- Antes, ser membro da empresa bastava para ler e gravar em qualquer pasta do
-- bucket pela chave pública, inclusive em ação de reunião privada, que
-- `can_view_action` esconde. A tabela tinha uma policy FOR ALL que deixava quem vê
-- a ação reescrever `path` ou apagar a linha.
--
-- A regra do storage lê o `actionId` da pasta ({tenantId}/{actionId}/{arquivo}) e
-- não depende da linha em `action_attachments`: `createAction` envia o arquivo antes
-- de inserir a linha, e `deleteAction` remove o arquivo depois que o cascade a levou.
--
-- Pelo mesmo motivo o proprietário lê qualquer arquivo da empresa. Depois do delete
-- a ação não existe mais, e o Storage precisa de SELECT para remover: sem isso o
-- remove afetaria 0 linhas, sem erro, e o arquivo ficaria órfão. Não abre nada novo,
-- porque `can_view_series` já mostra ao proprietário toda reunião privada.

create or replace function public.pode_ver_arquivo_de_acao(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((
    select public.has_tenant_role(m[1]::uuid, '{owner}'::public.member_role[])
        or exists (
             select 1 from public.actions a
             where a.id = m[2]::uuid
               and a.tenant_id = m[1]::uuid
               and public.can_view_action(a.*)
           )
    from regexp_match(
      p_name,
      '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[^/]+$'
    ) as m
    where m is not null
  ), false);
$$;

-- O único fluxo que grava anexo é `createAction`, logo após criar a ação.
create or replace function public.pode_gravar_arquivo_de_acao(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from regexp_match(
      p_name,
      '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[^/]+$'
    ) as m
    join public.actions a on a.id = m[2]::uuid and a.tenant_id = m[1]::uuid
    where a.created_by = auth.uid()
      and public.can_view_action(a.*)
  );
$$;

drop policy if exists action_attach_select on storage.objects;
create policy action_attach_select on storage.objects for select to authenticated
using (bucket_id = 'action-attachments' and public.pode_ver_arquivo_de_acao(name));

drop policy if exists action_attach_insert on storage.objects;
create policy action_attach_insert on storage.objects for insert to authenticated
with check (bucket_id = 'action-attachments' and public.pode_gravar_arquivo_de_acao(name));

-- Linha de anexo: sem UPDATE nem DELETE pela chave pública. O cascade da ação segue
-- funcionando, porque a checagem de FK roda como dono da tabela.
drop policy if exists action_attachments_rw on public.action_attachments;

create policy action_attachments_select on public.action_attachments for select to authenticated
using (exists (
  select 1 from public.actions a
  where a.id = action_attachments.action_id and public.can_view_action(a.*)
));

create policy action_attachments_insert on public.action_attachments for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and split_part(path, '/', 1) = tenant_id::text
  and split_part(path, '/', 2) = action_id::text
  and public.pode_gravar_arquivo_de_acao(path)
  and (
    action_attachments.demanda_id is null
    or exists (
      select 1 from public.action_demandas d
      where d.id = action_attachments.demanda_id
        and d.action_id = action_attachments.action_id
    )
  )
);

revoke all on table public.action_attachments from public, anon, authenticated;
grant select, insert on table public.action_attachments to authenticated;

-- As duas são chamadas pelas policies do storage, que rodam como `authenticated`.
revoke execute on function public.pode_ver_arquivo_de_acao(text) from public, anon;
revoke execute on function public.pode_gravar_arquivo_de_acao(text) from public, anon;
grant execute on function public.pode_ver_arquivo_de_acao(text) to authenticated;
grant execute on function public.pode_gravar_arquivo_de_acao(text) to authenticated;
