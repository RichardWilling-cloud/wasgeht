-- Run this script in Supabase SQL Editor.
-- After registering your account, promote it to admin from the SQL Editor:
-- update public.profiles set role = 'admin' where email = 'you@example.com';

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  type text not null check (char_length(type) between 1 and 40),
  genre text not null check (genre in ('party', 'live', 'szene', 'chill')),
  starts_at timestamptz not null,
  date_group text not null default 'all' check (date_group in ('today', 'weekend', 'week', 'all')),
  place text not null check (place in ('city', 'nearby')),
  venue text not null check (char_length(venue) between 1 and 120),
  price text not null default 'Eintritt frei' check (char_length(price) <= 50),
  poster smallint not null default 1 check (poster between 1 and 8),
  art text not null default '' check (char_length(art) <= 100),
  description text not null default '' check (char_length(description) <= 500),
  is_public boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.event_suggestions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  starts_at timestamptz not null,
  venue text not null check (char_length(venue) between 1 and 120),
  source_url text not null check (source_url ~* '^https?://'),
  description text not null default '' check (char_length(description) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists event_suggestions_status_idx
  on public.event_suggestions (status, created_at desc);

alter table public.event_suggestions enable row level security;

create or replace function public.can_submit_event_suggestion()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) < 5
  from public.event_suggestions
  where submitted_by = (select auth.uid())
    and created_at > now() - interval '24 hours';
$$;

revoke all on function public.can_submit_event_suggestion() from public;
grant execute on function public.can_submit_event_suggestion() to authenticated;

revoke all on public.event_suggestions from anon, authenticated;
grant insert on public.event_suggestions to authenticated;
grant select, update, delete on public.event_suggestions to authenticated;

create index if not exists events_public_order_idx
  on public.events (is_public, sort_order, starts_at);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists "Users submit event suggestions" on public.event_suggestions;
create policy "Users submit event suggestions"
  on public.event_suggestions
  for insert
  to authenticated
  with check (
    submitted_by = (select auth.uid())
    and (select public.can_submit_event_suggestion())
  );

drop policy if exists "Users read own event suggestions" on public.event_suggestions;
create policy "Users read own event suggestions"
  on public.event_suggestions
  for select
  to authenticated
  using (submitted_by = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Admins manage event suggestions" on public.event_suggestions;
create policy "Admins manage event suggestions"
  on public.event_suggestions
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_profile_after_signup on auth.users;
create trigger create_profile_after_signup
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

alter table public.profiles enable row level security;
alter table public.events enable row level security;

drop policy if exists "Users read own profile and admins read all" on public.profiles;
create policy "Users read own profile and admins read all"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Public reads visible events and admins read all" on public.events;
create policy "Public reads visible events and admins read all"
  on public.events
  for select
  to anon, authenticated
  using (is_public or (select public.is_admin()));

drop policy if exists "Admins manage events" on public.events;
create policy "Admins manage events"
  on public.events
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on public.profiles from anon, authenticated;
revoke all on public.events from anon, authenticated;
grant select on public.profiles to authenticated;
grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;

create or replace function public.move_event(p_event_id uuid, p_direction integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_position integer;
  target_position integer;
  total_events integer;
begin
  if not (select public.is_admin()) then
    raise exception 'Admin access required';
  end if;
  if p_direction is null or p_direction not in (-1, 1) then
    raise exception 'Direction must be -1 or 1';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.events.sort_order'));

  select ordinal, event_total
    into current_position, total_events
  from (
    select id,
           row_number() over (order by sort_order, created_at, id)::integer as ordinal,
           count(*) over ()::integer as event_total
    from public.events
  ) ordered
  where id = p_event_id;

  if current_position is null then
    raise exception 'Event not found';
  end if;

  target_position := current_position + p_direction;
  if target_position < 1 or target_position > total_events then
    return;
  end if;

  with ordered as (
    select id,
           row_number() over (order by sort_order, created_at, id)::integer as ordinal
    from public.events
  ),
  reordered as (
    select id,
           case
             when id = p_event_id then target_position
             when ordinal = target_position then current_position
             else ordinal
           end as ordinal
    from ordered
  )
  update public.events as event
  set sort_order = reordered.ordinal
  from reordered
  where event.id = reordered.id;
end;
$$;

revoke all on function public.create_profile_for_new_user() from public, anon, authenticated;
revoke all on function public.move_event(uuid, integer) from public;
grant execute on function public.move_event(uuid, integer) to authenticated;

alter table public.events
  add column if not exists created_by uuid references auth.users (id) on delete set null,
  add column if not exists category text not null default 'Party' check (category in ('Party', 'Rave', 'Konzert', 'Club', 'Festival', 'Workshop', 'Markt', 'LARP', 'Community', 'Kultur', 'Outdoor')),
  add column if not exists tags text[] not null default '{}',
  add column if not exists start_datetime timestamptz,
  add column if not exists end_datetime timestamptz,
  add column if not exists city text,
  add column if not exists location_name text,
  add column if not exists address text,
  add column if not exists source_url text,
  add column if not exists source_name text,
  add column if not exists source_type text not null default 'manual' check (source_type in ('instagram', 'google', 'website', 'manual')),
  add column if not exists image_url text,
  add column if not exists origin text not null default 'organizer' check (origin in ('ai', 'organizer')),
  add column if not exists content_hash text,
  add column if not exists confidence double precision not null default 1 check (confidence >= 0 and confidence <= 1),
  add column if not exists status text not null default 'published' check (status in ('published', 'needs_review')),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists events_created_by_idx on public.events (created_by);

drop policy if exists "Authenticated users submit private events" on public.events;
create policy "Authenticated users submit private events"
  on public.events
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and origin = 'organizer'
    and is_public = false
    and status = 'needs_review'
  );

create table if not exists public.events_archive (
  like public.events including defaults,
  archived_at timestamptz not null default now(),
  archive_reason text not null default 'past_event'
);

alter table public.events_archive
  add column if not exists source_name text;

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  city text not null default 'Erfurt',
  source_type text not null check (source_type in ('website', 'google', 'instagram', 'manual')),
  source_name text not null,
  url text,
  query_text text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_runs (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  dry_run boolean not null default false,
  max_events integer not null default 25,
  source_count integer not null default 0,
  new_events integer not null default 0,
  updated_events integer not null default 0,
  unchanged_events integer not null default 0,
  archived_events integer not null default 0,
  review_events integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

insert into public.sources (city, source_type, source_name, url, query_text, is_active)
select seed.city, seed.source_type, seed.source_name, seed.url, seed.query_text, seed.is_active
from (values
  ('Erfurt', 'website', 'Erfurt Stadt', 'https://www.erfurt-tourismus.de/veranstaltungskalender/', null, true),
  ('Erfurt', 'website', 'Stadtmarketing Erfurt', 'https://www.erfurt-tourismus.de/events-veranstaltungen/', null, false),
  ('Erfurt', 'google', 'Websuche', null, 'Events Erfurt diese Woche', false),
  ('Erfurt', 'instagram', 'Instagram Placeholder', null, null, false)
) as seed(city, source_type, source_name, url, query_text, is_active)
where not exists (
  select 1
  from public.sources existing
  where existing.source_name = seed.source_name
);

update public.sources
set url = 'https://www.erfurt-tourismus.de/veranstaltungskalender/',
    source_type = 'website',
    query_text = null,
    is_active = true,
    updated_at = now()
where source_name = 'Erfurt Stadt';

update public.sources
set is_active = false,
    updated_at = now()
where source_name in ('Stadtmarketing Erfurt', 'Websuche', 'Instagram Placeholder');

alter table public.events
  alter column starts_at drop not null;

create unique index if not exists events_archive_pkey_idx
  on public.events_archive (id);
create index if not exists events_status_idx on public.events (status, is_public, city, start_datetime);
create index if not exists events_source_idx on public.events (source_type, last_seen_at);
create index if not exists sources_city_active_idx on public.sources (city, is_active);
create unique index if not exists events_ai_source_hash_uidx
  on public.events (source_url, content_hash)
  where origin = 'ai' and source_url is not null and content_hash is not null;

alter table public.events_archive enable row level security;
alter table public.sources enable row level security;
alter table public.import_runs enable row level security;

drop policy if exists "Admins manage event sources" on public.sources;
create policy "Admins manage event sources"
  on public.sources
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins manage import runs" on public.import_runs;
create policy "Admins manage import runs"
  on public.import_runs
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins manage event archive" on public.events_archive;
create policy "Admins manage event archive"
  on public.events_archive
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on public.sources, public.import_runs, public.events_archive from anon, authenticated;
grant select, insert, update, delete on public.sources, public.import_runs, public.events_archive to authenticated;

drop policy if exists "Public reads visible events and admins read all" on public.events;
create policy "Public reads visible events and admins read all"
  on public.events
  for select
  to anon, authenticated
  using ((is_public and status = 'published') or (select public.is_admin()));

create or replace function public.archive_expired_events_internal()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  archived_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('public.events.archive'));

  with expired as (
    select id
    from public.events
    where coalesce(end_datetime, start_datetime, starts_at) < now()
  ),
  moved as (
    insert into public.events_archive (
      id, title, type, genre, starts_at, date_group, place, venue, price, poster,
      art, description, is_public, sort_order, created_at, category, tags,
      start_datetime, end_datetime, city, location_name, address, source_url,
      source_name, source_type, image_url, origin, content_hash, confidence, status, updated_at,
      last_seen_at, archived_at, archive_reason
    )
    select
      e.id, e.title, e.type, e.genre, e.starts_at, e.date_group, e.place, e.venue,
      e.price, e.poster, e.art, e.description, e.is_public, e.sort_order, e.created_at,
      e.category, e.tags, e.start_datetime, e.end_datetime, e.city, e.location_name,
      e.address, e.source_url, e.source_name, e.source_type, e.image_url, e.origin, e.content_hash,
      e.confidence, e.status, e.updated_at, e.last_seen_at, now(), 'past_event'
    from public.events e
    join expired x on x.id = e.id
    on conflict (id) do nothing
    returning id
  ),
  deleted as (
    delete from public.events e
    using expired x
    where e.id = x.id
    returning e.id
  )
  select count(*) into archived_count from deleted;

  return archived_count;
end;
$$;

revoke all on function public.archive_expired_events_internal() from public, anon, authenticated;

create or replace function public.archive_expired_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Admin access required';
  end if;
  return public.archive_expired_events_internal();
end;
$$;

revoke all on function public.archive_expired_events() from public, anon;
grant execute on function public.archive_expired_events() to authenticated;

drop function if exists public.runeventimport(text, boolean, integer);

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists vault;

create or replace function public.trigger_daily_event_import()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  cron_secret text;
  request_id bigint;
begin
  if extract(hour from (now() at time zone 'Europe/Berlin')) <> 2 then
    return null;
  end if;

  select decrypted_secret
    into cron_secret
  from vault.decrypted_secrets
  where name = 'wasgeht-cron-import-secret'
  limit 1;

  if cron_secret is null then
    raise exception 'Missing Vault secret: wasgeht-cron-import-secret';
  end if;

  select net.http_post(
    url := 'https://zvhvofgpizwhtxmcnghm.supabase.co/functions/v1/run-event-import',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := '{"city":"Erfurt","fullRun":true}'::jsonb
  )
    into request_id;

  return request_id;
end;
$$;

revoke all on function public.trigger_daily_event_import() from public, anon, authenticated;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'wasgeht-archive-expired-events';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
  perform cron.schedule(
    'wasgeht-archive-expired-events',
    '0 3 * * *',
    'select public.archive_expired_events_internal();'
  );
end;
$$;

do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid
    from cron.job
    where jobname in (
      'wasgeht-daily-event-import-cet',
      'wasgeht-daily-event-import-cest'
    )
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'wasgeht-daily-event-import-cet',
    '0 0 * * *',
    'select public.trigger_daily_event_import();'
  );
  perform cron.schedule(
    'wasgeht-daily-event-import-cest',
    '0 1 * * *',
    'select public.trigger_daily_event_import();'
  );
end;
$$;
