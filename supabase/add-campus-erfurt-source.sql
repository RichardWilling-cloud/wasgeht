-- Ergänzt ausschließlich den Campus-Erfurt-Veranstaltungskalender.
-- Bestehende Quellen und deren Aktivierungsstatus bleiben unverändert.

insert into public.sources (city, source_type, source_name, url, query_text, is_active)
select
  'Erfurt',
  'website',
  'Campus Erfurt',
  'https://www.campus-erfurt.de/veranstaltungskalender1',
  null,
  true
where not exists (
  select 1
  from public.sources
  where city = 'Erfurt'
    and source_name = 'Campus Erfurt'
);
