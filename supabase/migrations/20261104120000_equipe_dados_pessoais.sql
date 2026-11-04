-- Dados pessoais da EQUIPE, para a planilha que o gestor exporta em "Minha
-- equipe".
--
-- CPF, telefone, nascimento e sexo saíram do alcance de `authenticated` por
-- privilégio de coluna (ver AGENTS.md), e `tenant_dados_pessoais` só atende
-- owner/admin/manager/hr, a empresa inteira. Decisão do LUIZ (04/11/2026): o
-- gestor exporta a planilha de colaboradores da própria hierarquia COM esses
-- dados (e não importa). Esta função entrega só quem está na cadeia de quem
-- chama: o recorte é o de `my_managed_memberships`, a mesma cadeia de "Minha
-- equipe" (até 10 níveis, e só para quem tem papel de Gestor ou acima).

create or replace function public.equipe_dados_pessoais(p_tenant uuid)
returns table (id uuid, cpf text, phone text, birth_date date, gender public.gender_type)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- ver equipe exige o papel, não só o vínculo de gestor no cadastro
  if not public.has_tenant_role(p_tenant, '{owner,admin,manager,team_lead}'::public.member_role[]) then
    raise exception 'Sem permissão';
  end if;

  return query
    select p.id, p.cpf, p.phone, p.birth_date, p.gender
      from public.profiles p
     where p.id in (
       select mm.user_id from public.my_managed_memberships() mm
        where mm.tenant_id = p_tenant);
end;
$$;

revoke execute on function public.equipe_dados_pessoais(uuid) from public, anon;

notify pgrst, 'reload schema';
