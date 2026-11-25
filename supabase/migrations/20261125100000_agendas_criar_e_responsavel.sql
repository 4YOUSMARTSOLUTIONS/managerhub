-- Agendas (LUIZ, 25/11/2026): duas coisas.
--
-- 1) CORREÇÃO: ninguém criava agenda desde 18/11/2026 ("new row violates
--    row-level security policy for table agendas", visto com a BEATRIZ). A fase 1
--    de desempenho (20261118120000) trocou a leitura por
--    `id in (select agendas_visiveis())`. O app grava com INSERT ... RETURNING, e
--    o RETURNING exige que a linha NOVA passe na regra de leitura; a função lista
--    as agendas que já existiam quando o comando começou, então a nova nunca
--    estava lá. A gravação em si passava; a devolução do id é que caía, e o
--    comando inteiro era desfeito. Quem cria passa a enxergar a própria agenda
--    direto pela coluna, sem depender da lista.
--
-- 2) REGRA DO RESPONSÁVEL (decisão do LUIZ): a própria pessoa ou alguém da cadeia
--    de quem escolhe (a mesma "equipe" do resto do sistema: manages_user, que
--    exige perfil Gestor/Gerencial e sobe pelo gestor do cadastro). Proprietário,
--    Administrador e DP escolhem qualquer pessoa. Vale ao criar, ao trocar o
--    responsável e na transferência (agenda_transferir passa por aqui também).
--    Quem cria continua livre: qualquer pessoa que abre a tela.
--    Agendas que já existem não são revistas: o gatilho só olha a escolha nova.

drop policy if exists ag_select on public.agendas;
create policy ag_select on public.agendas
  for select
  using (
    (owner_id = (select auth.uid()) and tenant_id in (select public.my_tenant_ids()))
    or id in (select public.agendas_visiveis())
  );

create or replace function public.agenda_checar_responsavel()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_eu uuid := (select auth.uid());
begin
  -- rotina do sistema (cron, service role): sem pessoa para conferir
  if v_eu is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.responsible_id is not distinct from old.responsible_id then
    return new;
  end if;
  if new.responsible_id = v_eu
     or public.has_tenant_role(new.tenant_id, '{owner,admin,hr}'::public.member_role[])
     or public.manages_user(new.responsible_id, new.tenant_id) then
    return new;
  end if;
  raise exception 'Escolha você mesmo ou alguém da sua equipe como responsável. Para outra pessoa, peça ao gestor dela ou ao DP.'
    using errcode = '42501';
end;
$function$;

drop trigger if exists agendas_checar_responsavel on public.agendas;
create trigger agendas_checar_responsavel
  before insert or update of responsible_id on public.agendas
  for each row execute function public.agenda_checar_responsavel();

notify pgrst, 'reload schema';
