create table if not exists public.vendor_registry_settings (
    singleton boolean primary key default true
        check (singleton),
    is_authoritative boolean not null default false,
    updated_at timestamptz not null default now()
);

insert into public.vendor_registry_settings (
    singleton,
    is_authoritative
)
values (
    true,
    false
)
on conflict (singleton) do nothing;

create table if not exists public.approved_vendors (
    id bigint generated always as identity primary key,
    vendor_id text unique,
    vendor_name text,
    is_active boolean not null default true,
    source_reference text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (
        nullif(btrim(vendor_id), '') is not null
        or nullif(btrim(vendor_name), '') is not null
    ),
    check (
        nullif(btrim(source_reference), '') is not null
    )
);

create unique index if not exists
    approved_vendors_normalized_name_idx
on public.approved_vendors (
    lower(btrim(vendor_name))
)
where
    vendor_name is not null
    and btrim(vendor_name) <> '';

alter table public.vendor_registry_settings
    enable row level security;

alter table public.approved_vendors
    enable row level security;

revoke all
on table public.vendor_registry_settings
from public, anon, authenticated;

revoke all
on table public.approved_vendors
from public, anon, authenticated;

grant select, insert, update, delete
on table public.vendor_registry_settings
to service_role;

grant select, insert, update, delete
on table public.approved_vendors
to service_role;

grant usage, select
on sequence public.approved_vendors_id_seq
to service_role;

insert into public.approved_vendors (
    vendor_id,
    vendor_name,
    source_reference
)
values
    (
        'VND-101',
        'Almarai Dairy Co.',
        'Project-controlled initial vendor master'
    ),
    (
        'VND-102',
        'National Food Products Co. (Americana)',
        'Project-controlled initial vendor master'
    ),
    (
        'VND-103',
        'Al Safi Danone',
        'Project-controlled initial vendor master'
    ),
    (
        'VND-104',
        'Savola Foods (Afia, Al Arabi)',
        'Project-controlled initial vendor master'
    ),
    (
        'VND-105',
        'Halwani Bros Co.',
        'Project-controlled initial vendor master'
    ),
    (
        'VND-106',
        'Al Munajem Cold Stores',
        'Project-controlled initial vendor master'
    ),
    (
        'VND-107',
        'Nada Dairy (Al Othman)',
        'Project-controlled initial vendor master'
    ),
    (
        'VND-108',
        'Saudi Paper Manufacturing',
        'Project-controlled initial vendor master'
    ),
    (
        'VND-109',
        'P&G Saudi Distribution',
        'Project-controlled initial vendor master'
    ),
    (
        'VND-110',
        'Unilever Saudi Arabia',
        'Project-controlled initial vendor master'
    ),
    (
        'VND-111',
        'Al Rabie Saudi Foods',
        'Project-controlled initial vendor master'
    ),
    (
        'VND-112',
        'Modern Bakery (Lusine / Cupcakes)',
        'Project-controlled initial vendor master'
    ),
    (
        'VND-113',
        'Arabian Contracting Logistics',
        'Project-controlled initial vendor master'
    ),
    (
        'VND-114',
        'Gulf Cool Ref Systems',
        'Project-controlled initial vendor master'
    ),
    (
        'VND-115',
        'Obeikan Packaging Solutions',
        'Project-controlled initial vendor master'
    )
on conflict (vendor_id) do update
set
    vendor_name = excluded.vendor_name,
    source_reference = excluded.source_reference,
    updated_at = now();

update public.vendor_registry_settings
set
    is_authoritative = true,
    updated_at = now()
where singleton = true;

create or replace function public.get_ghost_vendor_context(
    transaction_ids text[]
)
returns table (
    transaction_id text,
    registry_authoritative boolean,
    vendor_registered boolean,
    vendor_active boolean
)
language sql
stable
security definer
set search_path = public
as $$
    select
        source.id as transaction_id,
        settings.is_authoritative
            as registry_authoritative,
        matched_vendor.id is not null
            as vendor_registered,
        coalesce(
            matched_vendor.is_active,
            false
        ) as vendor_active
    from public.transactions as source
    cross join public.vendor_registry_settings
        as settings
    left join lateral (
        select
            vendor.id,
            vendor.is_active
        from public.approved_vendors as vendor
        where
            (
                source.vendor_id is not null
                and vendor.vendor_id = source.vendor_id
            )
            or (
                source.vendor_id is null
                and source.vendor_name is not null
                and vendor.vendor_name is not null
                and lower(btrim(vendor.vendor_name))
                    = lower(btrim(source.vendor_name))
            )
        limit 1
    ) as matched_vendor on true
    where
        settings.singleton = true
        and source.id = any(transaction_ids);
$$;

revoke all
on function public.get_ghost_vendor_context(text[])
from public, anon, authenticated;

grant execute
on function public.get_ghost_vendor_context(text[])
to service_role;