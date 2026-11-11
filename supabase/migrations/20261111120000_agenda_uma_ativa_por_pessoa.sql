-- Uma agenda de rotina ativa por pessoa (LUIZ, 11/11/2026).
--
-- A pessoa tem uma função, então tem uma rotina. Duas agendas ativas para o
-- mesmo responsável somavam as tarefas no diário e distorciam carga e
-- aderência (caso real: duas "AUXILIAR DE PUXADA", montadas por dois gestores).
-- Inativas não contam e continuam guardando o histórico de execução. A agenda
-- de "Demandas não previstas" fica fora: é do diário e já tem índice próprio.
--
-- O gatilho explica o conflito com nome da agenda e de quem a montou (a RLS
-- pode esconder essa agenda de quem está tentando criar a outra, por isso ele
-- é SECURITY DEFINER). O índice único segura o caso de dois cliques ao mesmo
-- tempo, que o gatilho sozinho deixaria passar.

create or replace function public.agenda_uma_ativa_por_pessoa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_outra record;
begin
  if not new.active or new.imprevistos then
    return new;
  end if;

  select a.name, po.full_name as dono, pr.full_name as pessoa
    into v_outra
    from public.agendas a
    left join public.profiles po on po.id = a.owner_id
    left join public.profiles pr on pr.id = a.responsible_id
   where a.tenant_id = new.tenant_id
     and a.responsible_id = new.responsible_id
     and a.active
     and not a.imprevistos
     and a.id <> new.id
   limit 1;

  if found then
    raise exception '% já tem a agenda ativa "%"%. Cada pessoa tem uma agenda de rotina ativa só: edite essa agenda ou inative-a antes.',
      coalesce(v_outra.pessoa, 'Esta pessoa'),
      v_outra.name,
      case when v_outra.dono is not null and v_outra.dono is distinct from v_outra.pessoa
           then ', montada por ' || v_outra.dono else '' end
      using errcode = '23505';
  end if;
  return new;
end;
$$;

-- só o gatilho chama
revoke execute on function public.agenda_uma_ativa_por_pessoa() from public, anon, authenticated;

drop trigger if exists agendas_uma_ativa_por_pessoa on public.agendas;
create trigger agendas_uma_ativa_por_pessoa
  before insert or update of active, responsible_id, imprevistos on public.agendas
  for each row execute function public.agenda_uma_ativa_por_pessoa();

create unique index if not exists agendas_uma_ativa_por_pessoa_idx
  on public.agendas (tenant_id, responsible_id)
  where active and not imprevistos;
