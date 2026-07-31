-- Seção: nível entre Pilar e Bloco. Bloco passa a pertencer a uma seção e é opcional.
create table if not exists public.sdpo_secoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pilar_id uuid not null references public.sdpo_pilares(id) on delete restrict,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.sdpo_secoes enable row level security;
drop policy if exists sdpo_secoes_rw on public.sdpo_secoes;
create policy sdpo_secoes_rw on public.sdpo_secoes
  for all using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
create index if not exists sdpo_secoes_tenant_idx on public.sdpo_secoes(tenant_id);
create index if not exists sdpo_secoes_pilar_idx on public.sdpo_secoes(pilar_id);

-- Blocos: pilar_id -> secao_id (0 linhas, sem retrofit) + código
alter table public.sdpo_blocos drop column if exists pilar_id;
alter table public.sdpo_blocos add column if not exists secao_id uuid not null references public.sdpo_secoes(id) on delete restrict;
alter table public.sdpo_blocos add column if not exists code text;
create index if not exists sdpo_blocos_secao_idx on public.sdpo_blocos(secao_id);

-- Itens: pertencem a uma seção (obrigatório) e, opcionalmente, a um bloco + código
alter table public.sdpo_itens add column if not exists secao_id uuid not null references public.sdpo_secoes(id) on delete restrict;
alter table public.sdpo_itens alter column bloco_id drop not null;
alter table public.sdpo_itens add column if not exists code text;
create index if not exists sdpo_itens_secao_idx on public.sdpo_itens(secao_id);
create index if not exists sdpo_itens_bloco_idx on public.sdpo_itens(bloco_id);

-- Ações: classificação ganha a seção (nullable)
alter table public.actions add column if not exists secao_id uuid references public.sdpo_secoes(id);
create index if not exists actions_secao_idx on public.actions(secao_id);
