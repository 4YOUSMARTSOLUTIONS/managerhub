revoke execute on function public.can_edit_checklist(uuid, uuid) from public;
revoke execute on function public.can_view_checklist(public.checklists) from public;
grant execute on function public.can_edit_checklist(uuid, uuid) to authenticated;
grant execute on function public.can_view_checklist(public.checklists) to authenticated;
