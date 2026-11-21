-- Ausência de horas que atravessa a meia-noite (LUIZ, 21/11/2026).
--
-- O turno da noite começa num dia e termina no outro: quem passou mal às 20:16
-- num turno que acaba às 02:47 fica ausente "das 20:16 às 02:47". As três travas
-- exigiam o fim maior que o início e recusavam esse lançamento.
--
-- Regra nova: o "Até" menor que o "Ausente das" é do dia seguinte. Horários
-- iguais continuam recusados (zero hora ou 24 horas não é ausência parcial).
-- O dia do lançamento segue sendo o dia em que o turno começou.
--
-- As duas funções são editadas no ponto exato, a partir da definição que está no
-- banco, e a migração falha se o trecho não for encontrado: reescrevê-las
-- inteiras aqui arriscaria desfazer o que mudou nelas depois da última cópia.

alter table public.absenteismo_lancamentos
  drop constraint if exists absenteismo_horas_coerentes;
alter table public.absenteismo_lancamentos
  add constraint absenteismo_horas_coerentes check (
    (hours_start is null and hours_end is null)
    or (hours_start is not null and hours_end is not null and hours_end <> hours_start)
  );

do $$
declare
  v_def text;
  v_novo text;
begin
  -- relatório do DP: a coluna de horas soma 24h quando o fim é do dia seguinte
  v_def := pg_get_functiondef('public.absenteismo_relatorio(uuid, date, date, uuid[])'::regprocedure);
  v_novo := replace(v_def,
    'to_char(l.hours_end - l.hours_start, ''HH24:MI'')',
    'to_char(case when l.hours_end > l.hours_start then l.hours_end - l.hours_start'
      || ' else l.hours_end - l.hours_start + interval ''24 hours'' end, ''HH24:MI'')');
  if v_novo = v_def then
    raise exception 'absenteismo_relatorio: trecho do cálculo de horas não encontrado';
  end if;
  execute v_novo;

  -- importação de histórico: mesma regra da tela
  v_def := pg_get_functiondef('public.absenteismo_importar(uuid, jsonb, boolean)'::regprocedure);
  v_novo := replace(replace(v_def,
    'if v_parcial and v_ate <= v_das then',
    'if v_parcial and v_ate = v_das then'),
    'O horário Até precisa ser maior que o Das.',
    'Os horários Das e Até não podem ser iguais.');
  if v_novo = v_def or position('v_ate = v_das' in v_novo) = 0 then
    raise exception 'absenteismo_importar: trecho da validação de horas não encontrado';
  end if;
  execute v_novo;
end $$;

revoke execute on function public.absenteismo_relatorio(uuid, date, date, uuid[]) from public, anon;
revoke execute on function public.absenteismo_importar(uuid, jsonb, boolean) from public, anon;

notify pgrst, 'reload schema';
