-- Dados pessoais do perfil por RPC, nao por leitura direta da tabela.
--
-- A RLS nao tem granularidade de COLUNA: a policy profiles_self_select libera a
-- LINHA do colega, e com a linha vem cpf, phone e birth_date. Como a
-- NEXT_PUBLIC_SUPABASE_ANON_KEY esta no bundle do navegador, qualquer funcionario
-- chama o PostgREST direto e le a base de CPFs inteira. Reproduzido: um usuario de
-- papel "member" enxerga cpf e data de nascimento de 986 colegas. A restricao a
-- owner/admin existia so na tela.
--
-- A correcao e privilegio de COLUNA (migracao seguinte). Estas duas funcoes sao o
-- caminho autorizado para quem PODE ler. Esta migracao e aditiva: sozinha, nao
-- muda nada no comportamento do app.

-- ---------- os proprios dados (tela "Meu perfil") ----------
-- Sem parametro de proposito: sem superficie, sem como pedir a linha alheia.
create or replace function public.meu_perfil_pessoal()
returns table (cpf text, phone text, birth_date date, gender gender_type)
language sql stable security definer set search_path to 'public'
as $function$
  select p.cpf, p.phone, p.birth_date, p.gender
  from public.profiles p
  where (select auth.uid()) is not null
    and p.id = (select auth.uid());
$function$;

-- ---------- ficha dos funcionarios da empresa (tela de Configuracoes) ----------
create or replace function public.tenant_dados_pessoais(p_tenant uuid default null)
returns table (id uuid, cpf text, phone text, birth_date date, gender gender_type)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_tenant uuid := coalesce(p_tenant, public.my_active_tenant());
begin
  -- guarda real no corpo: nao adianta passar a empresa alheia
  if v_tenant is null
     or not public.has_tenant_role(v_tenant, array['owner','admin']::member_role[]) then
    raise exception 'Sem permissão';
  end if;

  -- so quem tem vinculo com ESTA empresa
  return query
    select p.id, p.cpf, p.phone, p.birth_date, p.gender
    from public.profiles p
    join public.memberships m on m.user_id = p.id and m.tenant_id = v_tenant;
end;
$function$;

-- Chamadas pelo app COM a sessao do usuario (dependem de auth.uid()), entao
-- authenticated fica. anon sai.
revoke execute on function public.meu_perfil_pessoal() from public, anon;
revoke execute on function public.tenant_dados_pessoais(uuid) from public, anon;
grant execute on function public.meu_perfil_pessoal() to authenticated;
grant execute on function public.tenant_dados_pessoais(uuid) to authenticated;
