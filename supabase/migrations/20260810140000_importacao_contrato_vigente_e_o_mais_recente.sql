-- Importação em lote: o contrato VIGENTE é o mais recente, não o que vier por último no arquivo.
--
-- Uma pessoa tem um vínculo por empresa, então duas linhas com o mesmo CPF
-- (transferência de unidade, recontratação) disputam o MESMO registro e cada
-- uma reescreve a anterior. A regra que separava "contrato atual" de "contrato
-- anterior" olhava só a data de ADMISSÃO: a linha só virava histórico se a
-- admissão dela fosse anterior à do cadastro. Com admissões iguais, que é o
-- caso de quem troca de unidade mantendo a data, nenhuma das duas era
-- reconhecida como anterior, as duas viravam "recontratação", e quem vencia
-- era simplesmente a ÚLTIMA LINHA DO ARQUIVO.
--
-- O estrago: uma linha DEMITIDA derrubava um contrato ABERTO. DANIEL ANTONIO
-- DA SILVA tinha matrícula ativa na MATRIZ e matrícula demitida na FILIAL, e
-- terminou inativo com o contrato vivo no histórico. Mesma coisa com ERNANDO
-- PEREIRA NUNES. Em PEDRO JUNIO PAIVA AMARAL, com as duas linhas demitidas,
-- ficou vigente a de demissão mais ANTIGA.
--
-- A regra passa a ordenar os dois contratos, e o mais antigo é que vai para o
-- histórico. Um contrato A é mais antigo que B quando:
--
--   1. a admissão de A é anterior à de B; ou, com admissões iguais ou
--      indefinidas,
--   2. A está encerrado e B está aberto (demissão nunca derruba contrato
--      aberto); ou
--   3. os dois estão encerrados e A foi encerrado antes.
--
-- Assim o resultado deixa de depender da ordem das linhas no arquivo: as duas
-- ordens convergem para o mesmo cadastro vigente.
--
-- O corpo é remendado a partir do que está no banco (molde da 20260807162000):
-- a função tem centenas de linhas e uma cópia à mão seria a chance de perder
-- alguma delas em silêncio.
do $do$
declare
  v_def text;
  v_new text;

  c_cond_velha constant text := $q$if v_adm is not null and v_existing_adm is not null and v_adm < v_existing_adm then$q$;
  c_cond_nova constant text := $q$if (v_adm is not null and v_existing_adm is not null and v_adm < v_existing_adm)
             or ((v_adm is null or v_existing_adm is null or v_adm = v_existing_adm)
                 and ((v_dismissed is not null and v_ex_dis is null)
                      or (v_dismissed is not null and v_ex_dis is not null and v_dismissed < v_ex_dis))) then$q$;

  c_msg1_velha constant text := $q$'motivo', 'Contrato anterior (admissão ' || to_char(v_adm, 'DD/MM/YYYY') ||$q$;
  c_msg1_nova constant text := $q$'motivo', 'Contrato encerrado (matrícula ' || v_code || coalesce(', admissão ' || to_char(v_adm, 'DD/MM/YYYY'), '') || coalesce(', demissão ' || to_char(v_dismissed, 'DD/MM/YYYY'), '') ||$q$;

  c_msg2_velha constant text := $q$') guardado no histórico. Cadastro atual mantido (admissão ' || to_char(v_existing_adm, 'DD/MM/YYYY') ||$q$;
  c_msg2_nova constant text := $q$') guardado no histórico. Cadastro atual mantido (matrícula ' || coalesce(v_existing_code, 'sem matrícula') || coalesce(', admissão ' || to_char(v_existing_adm, 'DD/MM/YYYY'), '') ||$q$;

  c_msg3_velha constant text := $q$', código ' || coalesce(v_existing_code, 'sem código') || ').');$q$;
  c_msg3_nova constant text := $q$').');$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_import_employees';

  -- cada trecho tem de existir UMA vez: zero significa que o corpo mudou de
  -- forma e o remendo cairia no lugar errado; mais de uma, que casaria demais
  if (length(v_def) - length(replace(v_def, c_cond_velha, ''))) / length(c_cond_velha) <> 1
     or (length(v_def) - length(replace(v_def, c_msg1_velha, ''))) / length(c_msg1_velha) <> 1
     or (length(v_def) - length(replace(v_def, c_msg2_velha, ''))) / length(c_msg2_velha) <> 1
     or (length(v_def) - length(replace(v_def, c_msg3_velha, ''))) / length(c_msg3_velha) <> 1 then
    raise exception 'admin_import_employees: trechos esperados não estão exatamente uma vez no corpo';
  end if;

  v_new := replace(v_def, c_cond_velha, c_cond_nova);
  v_new := replace(v_new, c_msg1_velha, c_msg1_nova);
  v_new := replace(v_new, c_msg2_velha, c_msg2_nova);
  v_new := replace(v_new, c_msg3_velha, c_msg3_nova);

  execute v_new;
end
$do$;

revoke execute on function public.admin_import_employees(jsonb, text) from public, anon;
