-- ---------------------------------------------------------------------------
-- RH deixa de ser perfil (2ª parte de 2), com o app novo já no ar.
--
-- Quem ainda tem o perfil 'hr' já tem a marca `is_hr` (20261106160000). Fica
-- com o perfil que a chefia pede: Gestor se alguém responde a ele, Funcionário
-- se não. E o valor 'hr' deixa de ser aceito em memberships. O enum continua
-- com ele, porque o histórico de vigências (`membership_history`) guarda o
-- perfil de cada época e precisa continuar legível.
-- ---------------------------------------------------------------------------

update public.memberships m
   set is_hr = true,
       role = case
         when exists (select 1 from public.memberships s
                       where s.tenant_id = m.tenant_id and s.manager_id = m.user_id)
           then 'team_lead'::public.member_role
         else 'member'::public.member_role
       end
 where m.role = 'hr';

-- o histórico de vigências e a sincronia de treinamentos são triggers
-- diferidos: rodam agora, senão o ALTER TABLE abaixo recusa a tabela
set constraints all immediate;

alter table public.memberships drop constraint if exists memberships_role_sem_rh;
alter table public.memberships
  add constraint memberships_role_sem_rh check (role <> 'hr')
  not valid;
alter table public.memberships validate constraint memberships_role_sem_rh;

comment on constraint memberships_role_sem_rh on public.memberships is
  'RH é a marca is_hr, não perfil (06/11/2026). O valor hr só sobrevive no histórico.';
