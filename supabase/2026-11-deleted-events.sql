-- Merkliste gelöschter Events: Was ein Admin löscht oder verwirft, darf der
-- nächtliche Import nicht wieder einfügen. Einmal im SQL Editor ausführen (idempotent).

create table if not exists public.deleted_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) <= 200),
  description text check (char_length(description) <= 1000),
  venue text check (char_length(venue) <= 200),
  starts_at timestamptz,
  source_url text,
  source_name text,
  deleted_at timestamptz not null default now()
);

create index if not exists deleted_events_starts_idx on public.deleted_events (starts_at);

alter table public.deleted_events enable row level security;
revoke all on public.deleted_events from anon, authenticated;
grant select, insert, delete on public.deleted_events to authenticated;

drop policy if exists "Admins manage deleted events" on public.deleted_events;
create policy "Admins manage deleted events"
  on public.deleted_events
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Aufbewahrung: Einträge 30 Tage nach dem Eventdatum entfernen.
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
  delete from public.deleted_events where coalesce(starts_at, deleted_at) < now() - interval '30 days';
  -- Statistik: Rohdaten 90 Tage; Tages-Salts sofort nach Tagesende löschen,
  -- damit Besucher-Hashes verschiedener Tage nicht verknüpfbar sind.
  delete from public.analytics_events where created_at < now() - interval '90 days';
  delete from public.analytics_salts where day < (now() at time zone 'Europe/Berlin')::date;
end;
$$;

revoke all on function public.purge_old_records() from public, anon, authenticated;
