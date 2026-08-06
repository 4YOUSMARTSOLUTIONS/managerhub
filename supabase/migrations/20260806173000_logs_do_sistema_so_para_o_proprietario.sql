-- Logs do sistema restritos ao proprietário, por enquanto.
--
-- A tela passou a exigir role 'owner', mas fechar só a tela seria esconder o
-- menu: a policy liberava owner, admin E manager, e a chave pública está no
-- bundle do navegador. Qualquer um dos 10 gestores continuaria lendo o log
-- inteiro chamando o PostgREST direto.
--
-- E o log não é pouca coisa: o audit_trigger grava o de→para de TODA alteração
-- da empresa, então ali passam salário, CPF, telefone, remuneração variável e
-- fechamento de metas de gente que o leitor não gerencia.
--
-- Quando a tela ganhar recorte próprio (o gestor vendo só a cadeia dele), esta
-- policy volta a abrir, com o escopo escrito aqui dentro.
--
-- my_role_tenant_ids já traz o desvio do super admin de plataforma
-- (`where public.is_super_admin()`), então o proprietário da plataforma segue
-- alcançando as empresas que administra.

alter policy "audit_admin_select" on public.audit_logs
  using (tenant_id in (select public.my_role_tenant_ids('{owner}'::public.member_role[])));

-- o nome dizia "admin" e a regra agora é só o dono; nome mentindo em policy é
-- exatamente o tipo de coisa que faz a próxima pessoa afrouxar sem perceber
alter policy "audit_admin_select" on public.audit_logs rename to audit_owner_select;
