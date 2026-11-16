-- Redutor da RV: um motivo pode somar VÁRIOS tipos de ausência (LUIZ, 16/11/2026).
--
-- Até aqui cada regra observava um tipo só (`absence_kind`), e o atestado cortava
-- pela soma dos dias de atestado no mês. A regra da empresa é outra: qualquer
-- ausência conta na mesma faixa. 3 dias de atestado + 2 de afastamento no mês
-- são 5 dias, faixa de 50%, e não 20% + 20%.
--
-- `absence_kinds` é a lista de tipos cujos dias somam no motivo; `absence_kind`
-- continua sendo o principal (sempre está na lista) para o que já lia a coluna.
-- A trava antiga, "um tipo em um motivo só", continua valendo e agora olha a
-- lista: o mesmo dia nunca corta duas vezes.

alter table public.rv_reducer_rules
  add column absence_kinds public.absence_kind[] not null default '{}';

update public.rv_reducer_rules
   set absence_kinds = array[absence_kind]
 where source = 'absence' and absence_kind is not null;

comment on column public.rv_reducer_rules.absence_kinds is
  'Tipos de ausência cujos dias somam neste motivo (inclui absence_kind). Um tipo só pode estar em um motivo.';

create or replace function public.guard_rv_reducer_tipos()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_outro record;
begin
  if new.source <> 'absence' then
    new.absence_kinds := '{}';
    return new;
  end if;

  -- o principal sempre conta, e cada tipo aparece uma vez
  select coalesce(array_agg(distinct k order by k), '{}') into new.absence_kinds
    from unnest(array_append(new.absence_kinds, new.absence_kind)) k
   where k is not null;

  select r.name,
         (select string_agg(case k when 'licenca' then 'licença' when 'ferias' then 'férias' else k::text end, ', ')
            from unnest(r.absence_kinds) k where k = any(new.absence_kinds)) as tipos
    into v_outro
    from public.rv_reducer_rules r
   where r.tenant_id = new.tenant_id and r.source = 'absence' and r.id <> new.id
     and r.absence_kinds && new.absence_kinds
   limit 1;
  if found then
    raise exception 'Os dias de % já são contados no motivo "%". Um mesmo dia não pode cortar duas vezes.',
      v_outro.tipos, v_outro.name using errcode = '23505';
  end if;
  return new;
end;
$function$;

revoke execute on function public.guard_rv_reducer_tipos() from public, anon, authenticated;

create trigger trg_guard_rv_reducer_tipos
  before insert or update of source, absence_kind, absence_kinds on public.rv_reducer_rules
  for each row execute function public.guard_rv_reducer_tipos();

alter table public.rv_reducer_rules
  add constraint rv_reducer_rules_tipos check (
    (source = 'absence' and cardinality(absence_kinds) >= 1 and absence_kind = any(absence_kinds))
    or (source = 'sanction' and cardinality(absence_kinds) = 0));

notify pgrst, 'reload schema';
