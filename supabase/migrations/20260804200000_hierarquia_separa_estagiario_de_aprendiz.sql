-- Estagiário e Aprendiz são coisas diferentes, e Aprendiz fica ABAIXO.
--
-- A semente juntou os dois num nível só ("Aprendiz/Estagiário"), o que apaga uma
-- distinção real: estágio e aprendizagem têm regimes, faixas e trajetórias
-- distintas, e no organograma o aprendiz está um degrau abaixo do estagiário.
--
-- É RENOMEAÇÃO, não apagar e recriar. O id da linha sobrevive, então quem já
-- estivesse classificado como "Aprendiz/Estagiário" passa a constar como
-- "Estagiário" em vez de ficar sem hierarquia. Hoje ninguém está classificado,
-- mas a migração não pode depender disso: ela roda de novo em toda base nova.
update public.hierarchy_levels h
   set name = 'Estagiário'
 where h.name = 'Aprendiz/Estagiário'
   -- não renomeia se a empresa já tiver um "Estagiário": o UNIQUE(tenant, name)
   -- rejeitaria, e a migração inteira falharia por causa de uma empresa
   and not exists (
     select 1 from public.hierarchy_levels h2
      where h2.tenant_id = h.tenant_id and h2.name = 'Estagiário');

-- Aprendiz entra logo abaixo. Se houver algum nível depois de Estagiário, usa o
-- ponto médio para cair entre os dois; se Estagiário for o último (o caso da
-- semente), é o passo normal de 10.
insert into public.hierarchy_levels (tenant_id, name, rank)
select h.tenant_id, 'Aprendiz',
       coalesce(
         (select (h.rank + min(h2.rank)) / 2
            from public.hierarchy_levels h2
           where h2.tenant_id = h.tenant_id and h2.rank > h.rank),
         h.rank + 10)
from public.hierarchy_levels h
where h.name = 'Estagiário'
on conflict (tenant_id, name) do nothing;
