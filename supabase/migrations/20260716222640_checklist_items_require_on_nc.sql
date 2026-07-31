alter table public.checklist_items
  add column if not exists require_note_on_nc boolean not null default false,
  add column if not exists require_photo_on_nc boolean not null default false;
