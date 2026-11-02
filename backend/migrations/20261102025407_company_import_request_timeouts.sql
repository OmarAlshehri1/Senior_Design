-- Large, bounded import snapshots can exceed the inherited 8s REST timeout.
-- Keep the exemption on service-only import RPCs, below the 60s backend timeout.
alter function public.store_company_import(uuid,text,jsonb) set statement_timeout = '50s';
alter function public.get_company_import(uuid,text,uuid) set statement_timeout = '50s';
alter function public.preview_company_import(uuid,text,uuid,jsonb) set statement_timeout = '50s';
alter function public.confirm_company_import(uuid,text,uuid,text,text) set statement_timeout = '50s';
notify pgrst, 'reload schema';
