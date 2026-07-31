alter table public.tenants alter column openai_model set default 'gpt-4.1-mini';
update public.tenants set openai_model = 'gpt-4.1-mini' where openai_model = 'gpt-5.1-mini';
