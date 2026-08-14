-- Chat interno: busca avançada no histórico centralizado.
--
-- SECURITY INVOKER de propósito: a RLS de select de chat_messages já dá o
-- alcance certo a cada um (membro enxerga os próprios canais; a administração
-- enxerga tudo), então a função não precisa, nem deve, ampliar nada. O texto
-- usa o fts generated (portuguese) com websearch_to_tsquery: aspas para frase,
-- OR, e -palavra para excluir, como numa busca de site.

create or replace function public.chat_buscar(
  p_q text,
  p_autor uuid default null,
  p_canal uuid default null,
  p_de date default null,
  p_ate date default null,
  p_lim integer default 30
)
returns table (
  id uuid,
  channel_id uuid,
  author_id uuid,
  body text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select m.id, m.channel_id, m.author_id, m.body, m.created_at
  from public.chat_messages m
  where m.deleted_at is null
    and (btrim(coalesce(p_q, '')) = '' or m.fts @@ websearch_to_tsquery('portuguese', p_q))
    and (p_autor is null or m.author_id = p_autor)
    and (p_canal is null or m.channel_id = p_canal)
    and (p_de is null or m.created_at >= p_de::timestamptz)
    and (p_ate is null or m.created_at < (p_ate + 1)::timestamptz)
  order by m.created_at desc
  limit least(greatest(coalesce(p_lim, 30), 1), 100);
$$;

revoke execute on function public.chat_buscar(text, uuid, uuid, date, date, integer) from public, anon;
grant execute on function public.chat_buscar(text, uuid, uuid, date, date, integer) to authenticated;

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
