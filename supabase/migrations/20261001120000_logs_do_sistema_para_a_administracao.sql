-- Logs do sistema: o Administrador passa a ler, junto com o Proprietário.
--
-- A migração 20260806173000 fechou a tela no proprietário porque a policy
-- liberava owner, admin E manager, e a chave pública está no bundle do
-- navegador: qualquer um dos 10 gestores lia o log inteiro chamando o PostgREST
-- direto. O corte foi certo, mas largo demais. Administrador é administração da
-- empresa, não chefia de equipe: ele já alcança salário, CPF e remuneração pelas
-- telas de cadastro, então o log não lhe mostra nada que ele não possa ver.
--
-- Gestor e Gerencial continuam fora, e pelo mesmo motivo de antes: para eles o
-- log mostraria gente que não é da cadeia deles. Quando a tela ganhar recorte
-- próprio, a policy abre com o escopo escrito aqui dentro.
--
-- my_role_tenant_ids já traz o desvio do super admin de plataforma
-- (`where public.is_super_admin()`).
alter policy "audit_owner_select" on public.audit_logs
  using (tenant_id in (select public.my_role_tenant_ids('{owner,admin}'::public.member_role[])));

-- o nome dizia "owner" e a regra agora é a administração inteira; nome mentindo
-- em policy é exatamente o que faz a próxima pessoa afrouxar sem perceber
alter policy "audit_owner_select" on public.audit_logs rename to audit_administracao_select;
