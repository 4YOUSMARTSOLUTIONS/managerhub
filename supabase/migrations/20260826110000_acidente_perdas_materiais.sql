-- Perdas materiais do acidente.
--
-- Até agora o registro media só o dano à pessoa (classe, dias de afastamento,
-- CID). O mesmo evento que machuca costuma quebrar: empilhadeira, portão,
-- carga, veículo. Sem esse número, "investir em prevenção" é uma conversa sobre
-- risco abstrato; com ele, vira uma conta ao lado do custo do equipamento.
--
-- O VALOR É OPCIONAL, e isso é decisão de produto: no dia do acidente quase
-- nunca se sabe quanto custou o que quebrou. Exigir o número ali produziria
-- chute, e chute lançado uma vez vira indicador errado para sempre. A
-- descrição, essa sim, é exigida quando se marca que houve perda: sem ela o
-- campo não informa nada a quem ler depois.
alter table public.seg_acidentes
  add column if not exists houve_perdas      boolean not null default false,
  add column if not exists perdas_descricao  text,
  add column if not exists perdas_valor      numeric(12, 2);

-- As três colunas andam juntas: sem a marca não pode sobrar descrição nem valor
-- soltos (dado órfão que ninguém soma), e com a marca a descrição é exigida.
alter table public.seg_acidentes
  drop constraint if exists seg_acidente_perdas_coerentes;

alter table public.seg_acidentes
  add constraint seg_acidente_perdas_coerentes check (
    (houve_perdas and coalesce(btrim(perdas_descricao), '') <> '')
    or (not houve_perdas and perdas_descricao is null and perdas_valor is null)
  );

alter table public.seg_acidentes
  drop constraint if exists seg_acidente_perdas_valor_positivo;

alter table public.seg_acidentes
  add constraint seg_acidente_perdas_valor_positivo
    check (perdas_valor is null or perdas_valor >= 0);

create index if not exists seg_acidentes_perdas_idx
  on public.seg_acidentes (tenant_id, occurred_on desc) where houve_perdas;

-- O painel ganha o total do período.
--
-- Remendo a partir do banco, e não reescrita à mão: `seg_dashboard` tem 9 KB,
-- já foi recriada uma vez (quando ganhou o filtro por tipo) e monta pirâmide,
-- série mensal, por área e por causa. Reescrevê-la inteira para acrescentar três
-- linhas arriscaria desfazer em silêncio qualquer ajuste que ela tenha recebido.
-- O CTE `acidentes` faz `select a.*`, então as colunas novas já chegam lá
-- dentro: só o bloco de saída precisa mudar.
--
-- Três medidas, e não uma: quantos eventos quebraram alguma coisa, quanto disso
-- já foi apurado, e quantos seguem sem valor. Publicar só o somatório esconderia
-- as perdas ainda não precificadas e faria o número parecer menor do que é.
do $do$
declare
  v_def text;
  c_de constant text := $q$      'dias_perdidos', (select coalesce(sum(dias_afastamento), 0) from acidentes),$q$;
  c_para constant text := $q$      'dias_perdidos', (select coalesce(sum(dias_afastamento), 0) from acidentes),
      'com_perdas',       (select count(*) from acidentes where houve_perdas),
      'perdas_valor',     (select coalesce(sum(perdas_valor), 0) from acidentes where houve_perdas),
      'perdas_sem_valor', (select count(*) from acidentes where houve_perdas and perdas_valor is null),$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seg_dashboard';

  if v_def is null then
    raise exception 'seg_dashboard não encontrada';
  end if;
  if (length(v_def) - length(replace(v_def, c_de, ''))) / length(c_de) <> 1 then
    raise exception 'seg_dashboard: a linha de dias perdidos não está exatamente uma vez no corpo';
  end if;

  execute replace(v_def, c_de, c_para);
end
$do$;

-- O `create or replace` devolve os privilégios padrão: revogar de novo.
revoke execute on function public.seg_dashboard(integer, uuid[], public.seg_acidente_tipo) from public, anon;

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_n <> 0 then
    raise exception 'ha % funcoes SECURITY DEFINER alcancaveis por anon', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
