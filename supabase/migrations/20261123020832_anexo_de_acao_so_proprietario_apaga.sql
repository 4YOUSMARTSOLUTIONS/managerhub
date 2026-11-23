-- Arquivo de anexo de ação: só o proprietário da empresa (ou o super admin) apaga.
--
-- A policy anterior aceitava qualquer membro da empresa, sem olhar a ação. Com a
-- chave pública do navegador, um funcionário apagava anexo de ação alheia.
--
-- O único ponto do app que remove arquivo deste bucket é `deleteAction`, restrito
-- ao proprietário como a policy `actions_delete`. O painel da demanda só abre o anexo.
-- A regra não depende da linha em `action_attachments` de propósito: o arquivo é
-- removido DEPOIS do delete da ação, quando o cascade já levou essa linha.
drop policy if exists action_attach_delete on storage.objects;
create policy action_attach_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'action-attachments'
  and public.has_tenant_role(((storage.foldername(name))[1])::uuid, '{owner}'::public.member_role[])
);
