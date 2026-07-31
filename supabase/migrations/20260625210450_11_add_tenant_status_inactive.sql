
-- Adiciona o status "desativada" (acesso encerrado) às empresas
alter type public.tenant_status add value if not exists 'inactive';

