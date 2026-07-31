-- categoria de checklist descontinuada: os casos (Relato de anomalia, DTO) viram módulos próprios
alter table public.checklists drop column if exists category_id;
drop table if exists public.checklist_categories;
