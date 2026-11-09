-- Sicherheits- und Datenschutz-Update (November 2026).
-- Einmal im Supabase SQL Editor ausführen. Das Script ist idempotent.
-- Danach die Function `notify-event-suggestion` neu deployen (sie nutzt `notified_at`).

-- 1. Nutzer können ihren Account selbst löschen (DSGVO Art. 17).
--    Profil und Event-Vorschläge werden per ON DELETE CASCADE entfernt,
--    events.created_by wird per FK auf NULL gesetzt; im Archiv wird der Bezug ebenfalls entfernt.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  update public.events_archive set created_by = null where created_by = current_user_id;
  delete from auth.users where id = current_user_id;
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- 2. Benachrichtigungen zu Event-Vorschlägen nur einmal versenden
--    (vorher konnte die Function für denselben Vorschlag beliebig oft E-Mails auslösen).
alter table public.event_suggestions
  add column if not exists notified_at timestamptz;

-- 3. Direkt eingereichte private Events (Mobile-App) auf 5 je 24 Stunden begrenzen,
--    analog zu den Event-Vorschlägen. Admins sind über ihre eigene Policy nicht betroffen.
create or replace function public.can_submit_private_event()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) < 5
  from public.events
  where created_by = (select auth.uid())
    and created_at > now() - interval '24 hours';
$$;

revoke all on function public.can_submit_private_event() from public;
grant execute on function public.can_submit_private_event() to authenticated;

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
    and (select public.can_submit_private_event())
  );

-- 4a. Cookielose Reichweitenmessung (eigene Statistik, keine Drittanbieter).
--     Besucher werden pro Tag über sha256(Tages-Salt + IP + User-Agent) gezählt.
--     IP-Adressen werden nie gespeichert; der Salt wird täglich gelöscht.
create table if not exists public.analytics_salts (
  day date primary key,
  salt text not null
);

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  day date not null default (now() at time zone 'Europe/Berlin')::date,
  visitor_hash text not null,
  view_id uuid not null,
  type text not null check (type in ('pageview', 'leave', 'event_open', 'source_click', 'filter', 'search', 'surprise', 'load_more')),
  path text check (char_length(path) <= 200),
  referrer_host text check (char_length(referrer_host) <= 120),
  device text check (device in ('mobile', 'tablet', 'desktop')),
  event_id uuid,
  filter_name text check (char_length(filter_name) <= 20),
  filter_value text check (char_length(filter_value) <= 60),
  seconds integer check (seconds between 0 and 7200)
);

create index if not exists analytics_events_created_idx on public.analytics_events (created_at);
create index if not exists analytics_events_type_idx on public.analytics_events (type, created_at);

alter table public.analytics_salts enable row level security;
alter table public.analytics_events enable row level security;
revoke all on public.analytics_salts, public.analytics_events from anon, authenticated;

create or replace function public.track_event(
  p_type text, p_view_id uuid, p_path text, p_referrer_host text, p_device text,
  p_event_id uuid, p_filter_name text, p_filter_value text, p_seconds integer, p_client text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Europe/Berlin')::date;
  daily_salt text;
begin
  insert into public.analytics_salts (day, salt)
  values (today, encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (day) do nothing;
  select salt into daily_salt from public.analytics_salts where day = today;
  insert into public.analytics_events (day, visitor_hash, view_id, type, path, referrer_host, device, event_id, filter_name, filter_value, seconds)
  values (today, encode(extensions.digest(daily_salt || coalesce(p_client, ''), 'sha256'), 'hex'), p_view_id, p_type,
          p_path, p_referrer_host, p_device, p_event_id, p_filter_name, p_filter_value, p_seconds);
end;
$$;

revoke all on function public.track_event(text, uuid, text, text, text, uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.track_event(text, uuid, text, text, text, uuid, text, text, integer, text) to service_role;

create or replace function public.analytics_summary(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 90)));
begin
  if not (select public.is_admin()) then
    raise exception 'Admin access required';
  end if;
  return jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 30), 90)),
    'visitors', (select count(distinct (day, visitor_hash)) from public.analytics_events where created_at >= since),
    'pageviews', (select count(*) from public.analytics_events where created_at >= since and type = 'pageview'),
    'avg_seconds', (select coalesce(round(avg(total)), 0) from (
      select sum(seconds) as total from public.analytics_events
      where created_at >= since and type = 'leave' group by view_id) per_view),
    'source_clicks', (select count(*) from public.analytics_events where created_at >= since and type = 'source_click'),
    'daily', (select coalesce(jsonb_agg(daily order by daily.day), '[]'::jsonb) from (
      select day, count(distinct visitor_hash) as visitors, count(*) filter (where type = 'pageview') as pageviews
      from public.analytics_events where created_at >= since group by day) daily),
    'top_events', (select coalesce(jsonb_agg(top), '[]'::jsonb) from (
      select coalesce(e.title, ar.title, 'Gelöschtes Event') as title,
             count(*) filter (where a.type = 'event_open') as opens,
             count(*) filter (where a.type = 'pageview') as page_views,
             count(*) as total
      from public.analytics_events a
      left join public.events e on e.id = a.event_id
      left join public.events_archive ar on ar.id = a.event_id
      where a.created_at >= since and a.event_id is not null and a.type in ('event_open', 'pageview')
      group by 1 order by total desc limit 15) top),
    'top_filters', (select coalesce(jsonb_agg(f), '[]'::jsonb) from (
      select filter_name as name, filter_value as value, count(*) as uses
      from public.analytics_events where created_at >= since and type = 'filter'
      group by 1, 2 order by uses desc limit 15) f),
    'top_searches', (select coalesce(jsonb_agg(q), '[]'::jsonb) from (
      select filter_value as term, count(*) as uses
      from public.analytics_events where created_at >= since and type = 'search'
      group by 1 order by uses desc limit 15) q),
    'top_referrers', (select coalesce(jsonb_agg(r), '[]'::jsonb) from (
      select referrer_host as host, count(*) as visits
      from public.analytics_events where created_at >= since and type = 'pageview' and referrer_host is not null
      group by 1 order by visits desc limit 10) r),
    'top_pages', (select coalesce(jsonb_agg(pg), '[]'::jsonb) from (
      select path, count(*) as views
      from public.analytics_events where created_at >= since and type = 'pageview'
      group by 1 order by views desc limit 10) pg),
    'devices', (select coalesce(jsonb_object_agg(device, views), '{}'::jsonb) from (
      select coalesce(device, 'unbekannt') as device, count(*) as views
      from public.analytics_events where created_at >= since and type = 'pageview' group by 1) d)
  );
end;
$$;

revoke all on function public.analytics_summary(integer) from public, anon;
grant execute on function public.analytics_summary(integer) to authenticated;

-- 4. Datensparsamkeit: Vergangene Events werden täglich archiviert (Job wasgeht-archive-expired-events)
--    und das Archiv nach 30 Tagen gelöscht. Import-Protokolle und erledigte Vorschläge ebenso.
create or replace function public.purge_old_records()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.events_archive where archived_at < now() - interval '30 days';
  delete from public.import_runs where started_at < now() - interval '30 days';
  delete from public.event_suggestions where status <> 'pending' and created_at < now() - interval '30 days';
  -- Statistik: Rohdaten 90 Tage; Tages-Salts sofort nach Tagesende löschen,
  -- damit Besucher-Hashes verschiedener Tage nicht verknüpfbar sind.
  delete from public.analytics_events where created_at < now() - interval '90 days';
  delete from public.analytics_salts where day < (now() at time zone 'Europe/Berlin')::date;
end;
$$;

revoke all on function public.purge_old_records() from public, anon, authenticated;

do $$
declare existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = 'wasgeht-retention-cleanup';
  if existing_job_id is not null then perform cron.unschedule(existing_job_id); end if;
  perform cron.schedule('wasgeht-retention-cleanup', '15 3 * * *', 'select public.purge_old_records();');
end;
$$;

-- 5. Sortierung: Die Pfeile ↑/↓ haben alle Events neu durchnummeriert und so die
--    chronologische Reihenfolge eingefroren. Ersetzt durch „Anpinnen“ (sort_order = -1).
drop function if exists public.move_event(uuid, integer);
update public.events set sort_order = 0 where sort_order > 0;
