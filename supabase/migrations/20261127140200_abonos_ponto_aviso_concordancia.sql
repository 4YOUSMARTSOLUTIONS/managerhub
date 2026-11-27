-- Concordância no aviso de "Retirar do ponto" (LUIZ, 27/11/2026): "Compensação
-- ... foi cancelada depois de lançada", "Abono ... foi cancelado depois de lançado".
do $$
declare
  v_def text;
  a text := $q$v_rotulo || ' foi cancelado depois de lançado no ponto. Retire do sistema de ponto e confirme em Abonos e compensações.'$q$;
begin
  v_def := pg_get_functiondef('public.absenteismo_avisar_ponto()'::regprocedure);
  if (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 then
    raise exception 'absenteismo_avisar_ponto mudou: âncora não confere';
  end if;
  execute replace(v_def, a, $q$v_rotulo || case when new.tratamento = 'compensacao'
                    then ' foi cancelada depois de lançada no ponto.'
                    else ' foi cancelado depois de lançado no ponto.' end
        || ' Retire do sistema de ponto e confirme em Abonos e compensações.'$q$);
end $$;
revoke execute on function public.absenteismo_avisar_ponto() from public, anon, authenticated;
