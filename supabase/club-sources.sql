alter table public.events
  add column if not exists source_name text;

alter table public.events_archive
  add column if not exists source_name text;

update public.sources
set is_active = false,
    updated_at = now()
where city = 'Erfurt';

update public.sources as existing
set city = seed.city,
    source_type = seed.source_type,
    url = seed.url,
    query_text = null,
    is_active = true,
    updated_at = now()
from (values
  ('Erfurt', 'website', 'Kalifstorch', 'https://www.kalifstorch.com'),
  ('Erfurt', 'website', 'Retronom', 'https://www.retronom.net/category/events/'),
  ('Erfurt', 'website', 'Kickerkeller', 'https://klubhaus-kickerkeller.de/termine.php'),
  ('Erfurt', 'website', 'Klanggerüst', 'https://klanggeruest.de/events'),
  ('Erfurt', 'website', 'AJZ', 'https://ajz-erfurt.com/veranstaltungen'),
  ('Erfurt', 'website', 'Museumskeller', 'https://hsd-erfurt.de'),
  ('Erfurt', 'website', 'triebwerk', 'https://triebwerk.club'),
  ('Erfurt', 'website', 'Frau Korte', 'https://fraukorte.de'),
  ('Erfurt', 'website', 'CKB', 'https://cafe-kunst-bar.com/veranstaltungen/'),
  ('Erfurt', 'website', 'franz mehlhose', 'https://franz-mehlhose.de'),
  ('Erfurt', 'website', 'Jazz Club', 'https://www.jazzclub-erfurt.de'),
  ('Erfurt', 'website', 'Zughafen', 'https://zughafen.de/events/'),
  ('Erfurt', 'website', 'jederkann', 'https://www.jederkann.online/veranstaltungen/'),
  ('Erfurt', 'website', 'Planet Comics Cafe', 'https://planetcomicserfurt.de/events/')
) as seed(city, source_type, source_name, url)
where existing.city = seed.city
  and existing.source_name = seed.source_name;

insert into public.sources (city, source_type, source_name, url, query_text, is_active)
select seed.city, seed.source_type, seed.source_name, seed.url, null, true
from (values
  ('Erfurt', 'website', 'Kalifstorch', 'https://www.kalifstorch.com'),
  ('Erfurt', 'website', 'Retronom', 'https://www.retronom.net/category/events/'),
  ('Erfurt', 'website', 'Kickerkeller', 'https://klubhaus-kickerkeller.de/termine.php'),
  ('Erfurt', 'website', 'Klanggerüst', 'https://klanggeruest.de/events'),
  ('Erfurt', 'website', 'AJZ', 'https://ajz-erfurt.com/veranstaltungen'),
  ('Erfurt', 'website', 'Museumskeller', 'https://hsd-erfurt.de'),
  ('Erfurt', 'website', 'triebwerk', 'https://triebwerk.club'),
  ('Erfurt', 'website', 'Frau Korte', 'https://fraukorte.de'),
  ('Erfurt', 'website', 'CKB', 'https://cafe-kunst-bar.com/veranstaltungen/'),
  ('Erfurt', 'website', 'franz mehlhose', 'https://franz-mehlhose.de'),
  ('Erfurt', 'website', 'Jazz Club', 'https://www.jazzclub-erfurt.de'),
  ('Erfurt', 'website', 'Zughafen', 'https://zughafen.de/events/'),
  ('Erfurt', 'website', 'jederkann', 'https://www.jederkann.online/veranstaltungen/'),
  ('Erfurt', 'website', 'Planet Comics Cafe', 'https://planetcomicserfurt.de/events/')
) as seed(city, source_type, source_name, url)
where not exists (
  select 1
  from public.sources as existing
  where existing.city = seed.city
    and existing.source_name = seed.source_name
);
