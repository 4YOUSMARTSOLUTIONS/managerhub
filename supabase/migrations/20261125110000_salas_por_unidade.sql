-- Salas de reunião por unidade (LUIZ, 25/11/2026): a matriz tem umas salas, a
-- filial outras. A sala ganha a unidade; quem escolhe sala (reunião, reserva no
-- calendário, turma de treinamento) vê as da unidade em questão, e as listas
-- seguem o seletor de unidade do topo.
--
-- As salas que já existem ficam sem unidade até o administrador definir (a tela
-- avisa). Enquanto isso aparecem em qualquer unidade, a mesma regra das agendas
-- sem unidade. Sala nova e sala editada exigem a unidade (a action confere).

alter table public.rooms
  add column unit_id uuid references public.units(id) on delete set null;

create index rooms_unit_idx on public.rooms (unit_id);

-- a unidade tem de ser da mesma empresa da sala
create or replace function public.rooms_unidade_da_empresa()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.unit_id is not null and not exists (
    select 1 from public.units u where u.id = new.unit_id and u.tenant_id = new.tenant_id
  ) then
    raise exception 'A unidade escolhida não é desta empresa.';
  end if;
  return new;
end;
$function$;

create trigger rooms_unidade_da_empresa
  before insert or update of unit_id, tenant_id on public.rooms
  for each row execute function public.rooms_unidade_da_empresa();

notify pgrst, 'reload schema';
