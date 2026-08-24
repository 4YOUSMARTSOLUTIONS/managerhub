-- Catálogos da blitz de trajeto: meios, perguntas e motivos de bloqueio.
--
-- A blitz confere o deslocamento de TODO colaborador, em qualquer meio: moto,
-- carro, bicicleta, a pé, coletivo, carona. As perguntas mudam por meio (e
-- mudam com o tempo, por decisão da empresa), então são CADASTRO, não código.
--
-- O vínculo pergunta→meio segue a regra que o módulo inteiro já usa:
-- SEM VÍNCULO = VALE PARA TODOS. Pergunta geral ("você saiu no horário que
-- permite dirigir sem pressa?") se cadastra uma vez, sem amarrar em nada.
--
-- `tem_veiculo` no meio é o que liga e desliga placa/tipo/propriedade no
-- formulário: quem veio a pé não tem placa, e campo irrelevante em formulário
-- de portaria é fila andando devagar.

create table public.seg_blitz_meios (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  image_path  text,
  tem_veiculo boolean not null default true,
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint seg_blitz_meios_nome_unico     unique (tenant_id, name),
  constraint seg_blitz_meios_nome_nao_vazio check (btrim(name) <> '')
);
create index seg_blitz_meios_tenant_idx on public.seg_blitz_meios (tenant_id, sort, name);

create table public.seg_blitz_perguntas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint seg_blitz_perguntas_nome_unico     unique (tenant_id, name),
  constraint seg_blitz_perguntas_nome_nao_vazio check (btrim(name) <> '')
);
create index seg_blitz_perguntas_tenant_idx on public.seg_blitz_perguntas (tenant_id, sort, name);

-- ligação SEM audit e SEM id, como as ligações de seg_ocorrencias: o
-- audit_trigger genérico lê new.id e morreria aqui
create table public.seg_blitz_pergunta_meios (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  pergunta_id uuid not null references public.seg_blitz_perguntas(id) on delete cascade,
  meio_id     uuid not null references public.seg_blitz_meios(id) on delete cascade,
  primary key (pergunta_id, meio_id)
);
create index seg_blitz_pergunta_meios_meio_idx on public.seg_blitz_pergunta_meios (meio_id);

create table public.seg_blitz_motivos (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint seg_blitz_motivos_nome_unico     unique (tenant_id, name),
  constraint seg_blitz_motivos_nome_nao_vazio check (btrim(name) <> '')
);
create index seg_blitz_motivos_tenant_idx on public.seg_blitz_motivos (tenant_id, sort, name);

create trigger trg_seg_blitz_meios_updated before update on public.seg_blitz_meios
  for each row execute function public.set_updated_at();
create trigger trg_seg_blitz_perguntas_updated before update on public.seg_blitz_perguntas
  for each row execute function public.set_updated_at();
create trigger trg_seg_blitz_motivos_updated before update on public.seg_blitz_motivos
  for each row execute function public.set_updated_at();

alter table public.seg_blitz_meios          enable row level security;
alter table public.seg_blitz_perguntas      enable row level security;
alter table public.seg_blitz_pergunta_meios enable row level security;
alter table public.seg_blitz_motivos        enable row level security;

create policy seg_blitz_meios_select on public.seg_blitz_meios
  for select using (tenant_id in (select public.my_tenant_ids()));
create policy seg_blitz_meios_write on public.seg_blitz_meios
  for all
  using      (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));

create policy seg_blitz_perguntas_select on public.seg_blitz_perguntas
  for select using (tenant_id in (select public.my_tenant_ids()));
create policy seg_blitz_perguntas_write on public.seg_blitz_perguntas
  for all
  using      (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));

create policy seg_blitz_pergunta_meios_select on public.seg_blitz_pergunta_meios
  for select using (tenant_id in (select public.my_tenant_ids()));
create policy seg_blitz_pergunta_meios_write on public.seg_blitz_pergunta_meios
  for all
  using      (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));

create policy seg_blitz_motivos_select on public.seg_blitz_motivos
  for select using (tenant_id in (select public.my_tenant_ids()));
create policy seg_blitz_motivos_write on public.seg_blitz_motivos
  for all
  using      (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])))
  with check (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::member_role[])));

revoke all on table public.seg_blitz_meios          from public, anon;
revoke all on table public.seg_blitz_perguntas      from public, anon;
revoke all on table public.seg_blitz_pergunta_meios from public, anon;
revoke all on table public.seg_blitz_motivos        from public, anon;

drop trigger if exists audit_seg_blitz_meios on public.seg_blitz_meios;
create trigger audit_seg_blitz_meios after insert or update or delete on public.seg_blitz_meios
  for each row execute function public.audit_trigger();
drop trigger if exists audit_seg_blitz_perguntas on public.seg_blitz_perguntas;
create trigger audit_seg_blitz_perguntas after insert or update or delete on public.seg_blitz_perguntas
  for each row execute function public.audit_trigger();
drop trigger if exists audit_seg_blitz_motivos on public.seg_blitz_motivos;
create trigger audit_seg_blitz_motivos after insert or update or delete on public.seg_blitz_motivos
  for each row execute function public.audit_trigger();

-- ============================================================================
-- Seeds: um ponto de partida que o cliente ajusta, não um chute
-- ============================================================================

insert into public.seg_blitz_meios (tenant_id, name, tem_veiculo, sort)
select t.id, v.name, v.tem_veiculo, v.sort
  from public.tenants t
 cross join (values
   ('Motocicleta',          true,  10),
   ('Carro',                true,  20),
   ('Caminhão',             true,  30),
   ('Bicicleta',            true,  40),
   ('A pé',                 false, 50),
   ('Transporte coletivo',  false, 60),
   ('Carona',               false, 70)
 ) as v(name, tem_veiculo, sort)
on conflict (tenant_id, name) do nothing;

insert into public.seg_blitz_perguntas (tenant_id, name, sort)
select t.id, v.name, v.sort
  from public.tenants t
 cross join (values
   ('O condutor está com as vestimentas adequadas (manga longa e luvas)?',            10),
   ('O veículo possui antena corta-pipa?',                                            20),
   ('Todas as luzes do veículo estão funcionando corretamente?',                      30),
   ('Os pneus estão em boas condições de uso?',                                       40),
   ('Os espelhos retrovisores estão em perfeito estado?',                             50),
   ('O capacete está em boas condições e afivelado corretamente?',                    60),
   ('Utiliza os equipamentos de segurança da bicicleta (capacete e luvas)?',          70),
   ('Costuma utilizar o cinto de segurança durante o trajeto?',                       80),
   ('O trajeto até a empresa evita vias e horários de risco conhecidos?',             90)
 ) as v(name, sort)
on conflict (tenant_id, name) do nothing;

-- vínculos dos seeds: pergunta sem linha aqui vale para todos os meios
insert into public.seg_blitz_pergunta_meios (tenant_id, pergunta_id, meio_id)
select p.tenant_id, p.id, m.id
  from public.seg_blitz_perguntas p
  join public.seg_blitz_meios m on m.tenant_id = p.tenant_id
  join (values
    ('O condutor está com as vestimentas adequadas (manga longa e luvas)?', 'Motocicleta'),
    ('O veículo possui antena corta-pipa?',                                 'Motocicleta'),
    ('O capacete está em boas condições e afivelado corretamente?',         'Motocicleta'),
    ('Todas as luzes do veículo estão funcionando corretamente?',           'Motocicleta'),
    ('Todas as luzes do veículo estão funcionando corretamente?',           'Carro'),
    ('Todas as luzes do veículo estão funcionando corretamente?',           'Caminhão'),
    ('Os pneus estão em boas condições de uso?',                            'Motocicleta'),
    ('Os pneus estão em boas condições de uso?',                            'Carro'),
    ('Os pneus estão em boas condições de uso?',                            'Caminhão'),
    ('Os pneus estão em boas condições de uso?',                            'Bicicleta'),
    ('Os espelhos retrovisores estão em perfeito estado?',                  'Carro'),
    ('Os espelhos retrovisores estão em perfeito estado?',                  'Caminhão'),
    ('Utiliza os equipamentos de segurança da bicicleta (capacete e luvas)?', 'Bicicleta'),
    ('Costuma utilizar o cinto de segurança durante o trajeto?',            'Carro'),
    ('Costuma utilizar o cinto de segurança durante o trajeto?',            'Caminhão'),
    ('Costuma utilizar o cinto de segurança durante o trajeto?',            'Transporte coletivo'),
    ('Costuma utilizar o cinto de segurança durante o trajeto?',            'Carona')
  ) as v(pergunta, meio)
    on v.pergunta = p.name and v.meio = m.name
on conflict do nothing;

insert into public.seg_blitz_motivos (tenant_id, name, sort)
select t.id, v.name, v.sort
  from public.tenants t
 cross join (values
   ('Pneu em má condição',            10),
   ('Iluminação com defeito',         20),
   ('Sem EPI de condução',            30),
   ('Documentação vencida',           40),
   ('Condição insegura do veículo',   50),
   ('Outro',                          90)
 ) as v(name, sort)
on conflict (tenant_id, name) do nothing;

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
