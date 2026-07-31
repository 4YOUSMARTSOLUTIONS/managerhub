-- Seção passa a ser um catálogo global (não pertence a um pilar).
-- Blocos e Itens passam a carregar pilar_id + secao_id.

alter table public.sdpo_blocos add column if not exists pilar_id uuid references public.sdpo_pilares(id) on delete restrict;
alter table public.sdpo_itens add column if not exists pilar_id uuid references public.sdpo_pilares(id) on delete restrict;

-- backfill pilar_id a partir da seção atual (que hoje aponta o pilar)
update public.sdpo_blocos b set pilar_id = s.pilar_id from public.sdpo_secoes s where b.secao_id = s.id and b.pilar_id is null;
update public.sdpo_itens i set pilar_id = s.pilar_id from public.sdpo_secoes s where i.secao_id = s.id and i.pilar_id is null;

-- dedupe seções por nome (por tenant): escolhe a canônica (menor created_at, desempate por id)
with canon as (
  select distinct on (tenant_id, name) id as canon_id, tenant_id, name
  from public.sdpo_secoes
  order by tenant_id, name, created_at, id
),
remap as (
  select s.id as dup_id, c.canon_id
  from public.sdpo_secoes s
  join canon c on c.tenant_id = s.tenant_id and c.name = s.name
  where s.id <> c.canon_id
)
-- religa referências para a seção canônica
, u1 as (update public.sdpo_blocos b set secao_id = r.canon_id from remap r where b.secao_id = r.dup_id returning 1)
, u2 as (update public.sdpo_itens i set secao_id = r.canon_id from remap r where i.secao_id = r.dup_id returning 1)
, u3 as (update public.actions a set secao_id = r.canon_id from remap r where a.secao_id = r.dup_id returning 1)
-- remove as seções duplicadas
delete from public.sdpo_secoes s using remap r where s.id = r.dup_id;

-- seção deixa de pertencer a um pilar
alter table public.sdpo_secoes drop column if exists pilar_id;

-- torna pilar_id obrigatório em blocos/itens (dados já backfillados)
alter table public.sdpo_blocos alter column pilar_id set not null;
alter table public.sdpo_itens alter column pilar_id set not null;

create index if not exists sdpo_blocos_pilar_idx on public.sdpo_blocos(pilar_id);
create index if not exists sdpo_itens_pilar_idx on public.sdpo_itens(pilar_id);
