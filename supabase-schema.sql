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
