
-- Pilar passa a ser global (único por nome). O programa (SPO/DPO) desce para blocos e itens,
-- preservando a estrutura de cada programa mesmo com um único registro de pilar.

-- 1) novas colunas de programa em blocos e itens
alter table public.sdpo_blocos add column if not exists programa_id uuid references public.sdpo_programas(id) on delete restrict;
alter table public.sdpo_itens  add column if not exists programa_id uuid references public.sdpo_programas(id) on delete restrict;

-- 2) backfill do programa a partir do pilar atual (ANTES de mesclar os pilares)
update public.sdpo_blocos b set programa_id = p.programa_id
  from public.sdpo_pilares p where p.id = b.pilar_id and b.programa_id is null;
update public.sdpo_itens i set programa_id = p.programa_id
  from public.sdpo_pilares p where p.id = i.pilar_id and i.programa_id is null;

-- 3) dedupe de pilares por (tenant, nome normalizado): sobrevive o mais antigo.
--    Recalcula o mapa a cada passo (sdpo_pilares não muda nas atualizações de filhos).
update public.sdpo_blocos b set pilar_id = s.survivor
  from (select id as loser, first_value(id) over (partition by tenant_id, lower(btrim(name)) order by created_at, id) as survivor from public.sdpo_pilares) s
  where s.loser <> s.survivor and b.pilar_id = s.loser;
update public.sdpo_itens i set pilar_id = s.survivor
  from (select id as loser, first_value(id) over (partition by tenant_id, lower(btrim(name)) order by created_at, id) as survivor from public.sdpo_pilares) s
  where s.loser <> s.survivor and i.pilar_id = s.loser;
update public.actions a set pilar_id = s.survivor
  from (select id as loser, first_value(id) over (partition by tenant_id, lower(btrim(name)) order by created_at, id) as survivor from public.sdpo_pilares) s
  where s.loser <> s.survivor and a.pilar_id = s.loser;
delete from public.sdpo_pilares p
  using (select id as loser, first_value(id) over (partition by tenant_id, lower(btrim(name)) order by created_at, id) as survivor from public.sdpo_pilares) s
  where s.loser <> s.survivor and p.id = s.loser;

-- 4) pilar deixa de pertencer a um programa (a informação vive nos filhos)
alter table public.sdpo_pilares drop column if exists programa_id;

-- 5) impedir novos pilares duplicados por nome (por tenant)
create unique index if not exists sdpo_pilares_tenant_name_uidx
  on public.sdpo_pilares (tenant_id, lower(btrim(name)));

