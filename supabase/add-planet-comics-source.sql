-- Fügt ausschließlich Planet Comics Cafe als aktive Eventquelle hinzu.
-- Bestehende Quellen und deren Status bleiben unverändert.
insert into public.sources (city, source_type, source_name, url, query_text, is_active)
select 'Erfurt', 'website', 'Planet Comics Cafe',
       'https://planetcomicserfurt.de/events/', null, true
where not exists (
  select 1
  from public.sources
  where city = 'Erfurt'
    and source_name = 'Planet Comics Cafe'
);
