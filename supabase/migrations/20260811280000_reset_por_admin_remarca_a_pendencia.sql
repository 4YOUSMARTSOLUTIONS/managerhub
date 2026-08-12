-- O reset de senha por administrador volta a exigir a troca no acesso seguinte.
--
-- Sem isto o reset seria a porta dos fundos permanente da regra: o admin define
-- uma senha que ele conhece, entrega ao colaborador, e o colaborador nunca mais
-- é cobrado a ter uma senha só dele. É exatamente o cenário que a troca
-- obrigatória existe para fechar, só que renovado a cada suporte prestado.
--
-- Remendo a partir do banco (molde da 20260807162000), e não reescrita à mão,
-- porque a função já sofreu um remendo automático antes (a 20260804034636
-- elevou o mínimo de 6 para 8 caracteres em massa) e o que está no arquivo
-- original já não é o que está no banco.
do $do$
declare
  v_def text;
  v_novo text;
  c_de constant text := $q$    set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now()$q$;
  c_para constant text := $q$    set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now(),
        raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                            || jsonb_build_object('must_change_password', true)$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_set_password';

  if (length(v_def) - length(replace(v_def, c_de, ''))) / length(c_de) <> 1 then
    raise exception 'admin_set_password: trecho do update de senha não está exatamente uma vez no corpo';
  end if;

  v_novo := replace(v_def, c_de, c_para);
  execute v_novo;
end
$do$;

revoke execute on function public.admin_set_password(uuid, text) from public, anon;
