-- Ocorrência padronizada: o "o quê" do relato, escolhido de uma lista.
--
-- Hoje o relato tem classificação, local, área e um texto livre. O texto livre
-- é o que a pessoa viu, e ele continua; o que falta é o RÓTULO padronizado do
-- fato ("Pallet quebrado", "Sem sinalização"), sem o qual não dá para contar
-- quantas vezes a mesma coisa aconteceu. Descrição não empilha em gráfico:
-- cinco pessoas escrevem o mesmo problema de cinco jeitos.
--
-- OS VÍNCULOS, e a regra que os torna práticos. Nem toda ocorrência faz sentido
-- em toda classificação, local ou área: "Pista esburacada" não existe dentro do
-- armazém, e "Utilização de EPI" só existe no positivo. Então cada ocorrência
-- pode ser amarrada a tipos, locais e áreas, e a mesma ideia vale para local e
-- área em relação ao tipo.
--
--   >> SEM VÍNCULO = VALE PARA TODOS. <<
--
-- Essa regra é o que impede o cadastro de virar trabalho braçal: só se amarra o
-- que precisa de recorte, e o resto aparece sempre. Sem ela, cada ocorrência
-- nova exigiria marcar todos os locais do mundo para não sumir da tela.
--
-- As tabelas de ligação NÃO têm audit trigger, ao contrário das tabelas-mãe. É
-- configuração de baixo risco (nenhum dado de pessoa, nenhum valor legal), e o
-- audit genérico exigiria uma coluna `id` em cada uma só para carimbar algo que
-- ninguém vai auditar.

create table public.seg_ocorrencias (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  description text,
  image_path  text,
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint seg_ocorrencias_nome_unico     unique (tenant_id, name),
  constraint seg_ocorrencias_nome_nao_vazio check (btrim(name) <> '')
);
create index seg_ocorrencias_tenant_idx on public.seg_ocorrencias (tenant_id, sort, name);

create trigger trg_seg_ocorrencias_updated before update on public.seg_ocorrencias
  for each row execute function public.set_updated_at();

-- ligações: ocorrência x (tipo | local | área)
create table public.seg_ocorrencia_tipos (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  ocorrencia_id uuid not null references public.seg_ocorrencias(id) on delete cascade,
  tipo_id       uuid not null references public.seg_tipos_relato(id) on delete cascade,
  primary key (ocorrencia_id, tipo_id)
);
create table public.seg_ocorrencia_locais (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  ocorrencia_id uuid not null references public.seg_ocorrencias(id) on delete cascade,
  local_id      uuid not null references public.seg_locais(id) on delete cascade,
  primary key (ocorrencia_id, local_id)
);
create table public.seg_ocorrencia_areas (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  ocorrencia_id uuid not null references public.seg_ocorrencias(id) on delete cascade,
  area_id       uuid not null references public.seg_areas(id) on delete cascade,
  primary key (ocorrencia_id, area_id)
);

-- ligações: local x tipo e área x tipo
create table public.seg_local_tipos (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  local_id  uuid not null references public.seg_locais(id) on delete cascade,
  tipo_id   uuid not null references public.seg_tipos_relato(id) on delete cascade,
  primary key (local_id, tipo_id)
);
create table public.seg_area_tipos (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  area_id   uuid not null references public.seg_areas(id) on delete cascade,
  tipo_id   uuid not null references public.seg_tipos_relato(id) on delete cascade,
  primary key (area_id, tipo_id)
);

alter table public.seg_relatos
  add column ocorrencia_id uuid references public.seg_ocorrencias(id) on delete restrict;
create index seg_relatos_ocorrencia_idx on public.seg_relatos (tenant_id, ocorrencia_id);

alter table public.seg_ocorrencias        enable row level security;
alter table public.seg_ocorrencia_tipos   enable row level security;
alter table public.seg_ocorrencia_locais  enable row level security;
alter table public.seg_ocorrencia_areas   enable row level security;
alter table public.seg_local_tipos        enable row level security;
alter table public.seg_area_tipos         enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'seg_ocorrencias', 'seg_ocorrencia_tipos', 'seg_ocorrencia_locais',
    'seg_ocorrencia_areas', 'seg_local_tipos', 'seg_area_tipos'
  ] loop
    execute format($f$
      create policy %I on public.%I for select
        using (tenant_id in (select public.my_tenant_ids()))
    $f$, t || '_select', t);
    execute format($f$
      create policy %I on public.%I for all
        using      (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
        with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
    $f$, t || '_write', t);
    execute format('revoke all on table public.%I from public, anon', t);
  end loop;
end $$;

drop trigger if exists audit_seg_ocorrencias on public.seg_ocorrencias;
create trigger audit_seg_ocorrencias after insert or update or delete on public.seg_ocorrencias
  for each row execute function public.audit_trigger();

-- ============================================================================
-- Seed: a lista que a operação usa hoje, amarrada às classificações
-- ============================================================================
--
-- "Piso irregular" vinha duas vezes na lista de origem e entra uma só, porque o
-- nome é único por empresa. As duas positivas ficam em "Comportamento seguro",
-- que é o tipo positivo semeado no módulo.

insert into public.seg_ocorrencias (tenant_id, name, sort)
select t.id, v.name, v.sort
  from public.tenants t
 cross join (values
   ('Não Utilização de EPI', 10), ('Normas de Segurança', 20),
   ('Sem sinalização', 100), ('Ferramenta danificada', 110), ('Ferramenta imprópria', 120),
   ('Piso irregular', 130), ('Falta de manutenção', 140), ('Sobrepeso', 150),
   ('Defeito no caminhão', 160), ('Acesso perigoso', 170), ('Amarração incorreta', 180),
   ('Empilhamento incorreto', 190), ('Pista esburacada', 200), ('Vasilhame quebrado', 210),
   ('Pallet quebrado', 220), ('Caixa quebrada', 230), ('Falta de manutenção no armazém', 240),
   ('Pallet sem filme', 250), ('Faixa de pedestres obstruída', 260),
   ('Hidrantes e extintores obstruídos', 270), ('Segregação', 280),
   ('Máquinas danificadas', 290), ('Escada irregular', 300), ('Iluminação irregular', 310),
   ('Condições higiênicas do depósito', 320), ('Quantidade de caixas para baldeio', 330),
   ('Rua de difícil acesso', 340), ('Restrição de estacionamento', 350),
   ('Risco de violência urbana', 360), ('Dificuldade do uso de cone', 370),
   ('Calçada de acesso irregular', 380), ('Perfil do caminhão inadequado', 390),
   ('Outro', 900),
   ('Utilização de EPI', 1000), ('Normas de segurança seguidas', 1010)
 ) as v(name, sort)
on conflict (tenant_id, name) do nothing;

-- amarra cada ocorrência à sua classificação
insert into public.seg_ocorrencia_tipos (tenant_id, ocorrencia_id, tipo_id)
select o.tenant_id, o.id, t.id
  from public.seg_ocorrencias o
  join public.seg_tipos_relato t
    on t.tenant_id = o.tenant_id
   and t.name = case
         when o.name in ('Não Utilização de EPI', 'Normas de Segurança') then 'Ato inseguro'
         when o.name in ('Utilização de EPI', 'Normas de segurança seguidas') then 'Comportamento seguro'
         else 'Condição insegura'
       end
 where o.name in (
   'Não Utilização de EPI','Normas de Segurança','Sem sinalização','Ferramenta danificada',
   'Ferramenta imprópria','Piso irregular','Falta de manutenção','Sobrepeso','Defeito no caminhão',
   'Acesso perigoso','Amarração incorreta','Empilhamento incorreto','Pista esburacada',
   'Vasilhame quebrado','Pallet quebrado','Caixa quebrada','Falta de manutenção no armazém',
   'Pallet sem filme','Faixa de pedestres obstruída','Hidrantes e extintores obstruídos',
   'Segregação','Máquinas danificadas','Escada irregular','Iluminação irregular',
   'Condições higiênicas do depósito','Quantidade de caixas para baldeio','Rua de difícil acesso',
   'Restrição de estacionamento','Risco de violência urbana','Dificuldade do uso de cone',
   'Calçada de acesso irregular','Perfil do caminhão inadequado',
   'Utilização de EPI','Normas de segurança seguidas'
 )
on conflict do nothing;
-- "Outro" fica sem vínculo de propósito: é a saída para o que não está na lista,
-- e por isso precisa aparecer em qualquer classificação.

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
