-- Bounded aggregate progress lookup for up to 50,000 retained receipt references.
alter function public.company_import_progress(uuid,text,uuid) set statement_timeout = '50s';
notify pgrst, 'reload schema';
