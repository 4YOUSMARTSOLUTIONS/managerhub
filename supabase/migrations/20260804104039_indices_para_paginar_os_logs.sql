-- A tela de Logs passa a paginar no BANCO, em vez de trazer os 300 mais recentes e
-- filtrar na memoria. Para isso a consulta precisa de "filtra por empresa + ordena
-- por data" resolvido por UM indice.
--
-- idx_audit_created cobre so a ordenacao, e idx_audit_tenant so o filtro: com 60 mil
-- linhas e mais de uma empresa, o banco teria de escolher um e descartar linhas do
-- outro. Medido: uma varredura da tabela inteira desta empresa leva 1,5 s.
--
-- actor_id entra porque o filtro por usuario e o mais usado depois da data.
--
-- Medido depois, na sessao real:
--   pagina 1 ................. 16 ms
--   contagem total ........... 91 ms
--   filtro "Removeu" ......... 51 ms
--   pagina 601 (offset 30000)  17 ms   <- o indice segura ate o fim do historico
create index if not exists idx_audit_tenant_created
  on public.audit_logs (tenant_id, created_at desc);

create index if not exists idx_audit_actor
  on public.audit_logs (actor_id);

-- action e entity_type tem pouquissimos valores distintos (3 e 8): indice proprio
-- nao ajudaria. Ficam como filtro sobre o conjunto ja reduzido pelo indice acima.
analyze public.audit_logs;
