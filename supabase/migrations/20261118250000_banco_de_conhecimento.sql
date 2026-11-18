-- Banco de conhecimento (LUIZ, 18/11/2026): a documentação de cada módulo,
-- ensinando como funciona e como usar.
--
-- Decisões dele:
--   * GLOBAL: o sistema funciona igual para todas as empresas, então o manual é
--     escrito uma vez, pelo dono da plataforma, e todas leem. Sem tenant_id.
--   * Só o proprietário da plataforma escreve (is_super_admin).
--   * Cada artigo aparece para quem tem acesso ao módulo dele. Esse recorte é
--     feito no app (getModuleAccess + permitidoPeloPapel), porque o acesso a
--     módulo mora em três camadas (venda por unidade, papel e nível) e só o app
--     junta as três. A RLS garante o que é dado: rascunho só o autor vê, e só
--     ele escreve. O conteúdo é manual de uso, sem dado de pessoa.

create table if not exists public.conhecimento_artigos (
  id uuid primary key default gen_random_uuid(),
  -- endereço do artigo (/conhecimento/<slug>); "novo" é rota do editor
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and slug <> 'novo'),
  -- a key do módulo em src/lib/modules.ts; nulo = artigo geral, para todos
  modulo text,
  titulo text not null check (length(btrim(titulo)) > 0),
  resumo text,
  -- markdown; imagens como ![legenda](img:<arquivo no bucket conhecimento>)
  conteudo text not null default '',
  ordem integer not null default 0,
  publicado boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conhecimento_artigos_modulo_idx on public.conhecimento_artigos (modulo, ordem);

alter table public.conhecimento_artigos enable row level security;

-- O ACL padrão do Supabase dá tudo a anon e authenticated em tabela nova:
-- derruba e devolve só o que a RLS vai decidir.
revoke all on table public.conhecimento_artigos from public, anon, authenticated;
grant select, insert, update, delete on table public.conhecimento_artigos to authenticated;

drop policy if exists conhecimento_ler on public.conhecimento_artigos;
create policy conhecimento_ler on public.conhecimento_artigos
  for select to authenticated
  using (publicado or public.is_super_admin());

drop policy if exists conhecimento_criar on public.conhecimento_artigos;
create policy conhecimento_criar on public.conhecimento_artigos
  for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists conhecimento_editar on public.conhecimento_artigos;
create policy conhecimento_editar on public.conhecimento_artigos
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists conhecimento_apagar on public.conhecimento_artigos;
create policy conhecimento_apagar on public.conhecimento_artigos
  for delete to authenticated
  using (public.is_super_admin());

-- quem mexeu por último e quando: carimbado pelo banco, não pelo app
create or replace function public.conhecimento_carimbo()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists conhecimento_carimbo on public.conhecimento_artigos;
create trigger conhecimento_carimbo
  before update on public.conhecimento_artigos
  for each row execute function public.conhecimento_carimbo();

-- Imagens dos artigos (prints de tela). Privado: a página assina os links na
-- hora de mostrar. Qualquer pessoa logada lê (o manual é de todas as empresas);
-- só o dono da plataforma envia, troca ou apaga.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'conhecimento', 'conhecimento', false, 5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists conhecimento_imagem_ler on storage.objects;
create policy conhecimento_imagem_ler on storage.objects
  for select to authenticated
  using (bucket_id = 'conhecimento');

drop policy if exists conhecimento_imagem_enviar on storage.objects;
create policy conhecimento_imagem_enviar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'conhecimento' and public.is_super_admin());

drop policy if exists conhecimento_imagem_trocar on storage.objects;
create policy conhecimento_imagem_trocar on storage.objects
  for update to authenticated
  using (bucket_id = 'conhecimento' and public.is_super_admin())
  with check (bucket_id = 'conhecimento' and public.is_super_admin());

drop policy if exists conhecimento_imagem_apagar on storage.objects;
create policy conhecimento_imagem_apagar on storage.objects
  for delete to authenticated
  using (bucket_id = 'conhecimento' and public.is_super_admin());

notify pgrst, 'reload schema';
