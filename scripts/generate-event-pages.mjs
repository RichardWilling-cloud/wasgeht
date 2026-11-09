import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const siteUrl = "https://wasgeht-ab.de";
const outputDirectory = join(process.cwd(), "generated-site");

if (!supabaseUrl || !publishableKey) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");
}

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const escapeJson = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");

const slugify = (value) => String(value ?? "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/ß/g, "ss")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 90);

const formatDate = (value) => new Intl.DateTimeFormat("de-DE", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
}).format(new Date(value));

const response = await fetch(
  `${supabaseUrl}/rest/v1/events?select=id,title,type,genre,starts_at,place,venue,price,description,image_url,source_url,is_public,status&is_public=eq.true&status=eq.published&order=starts_at.asc`,
  { headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` } },
);
if (!response.ok) {
  throw new Error(`Could not load public events: HTTP ${response.status} ${await response.text()}`);
}

const events = await response.json();
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(join(outputDirectory, "event"), { recursive: true });

const usedSlugs = new Set();
const urls = [{ loc: `${siteUrl}/`, changefreq: "daily", priority: "1.0" }];

for (const event of events) {
  const baseSlug = slugify(event.title) || "event";
  let slug = `${baseSlug}-${new Date(event.starts_at).toISOString().slice(0, 10)}`;
  let suffix = 2;
  while (usedSlugs.has(slug)) slug = `${baseSlug}-${new Date(event.starts_at).toISOString().slice(0, 10)}-${suffix++}`;
  usedSlugs.add(slug);

  const pageUrl = `${siteUrl}/event/${slug}/`;
  const image = event.image_url ? `<img src="${escapeHtml(event.image_url)}" alt="${escapeHtml(event.title)}">` : "";
  const description = event.description || `${event.title} in ${event.venue}, Erfurt.`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "Event",
    "@id": pageUrl,
    name: event.title,
    startDate: new Date(event.starts_at).toISOString(),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: event.venue,
      address: {
        "@type": "PostalAddress",
        addressLocality: event.place === "nearby" ? "Umgebung von Erfurt" : "Erfurt",
        addressCountry: "DE",
      },
    },
    description,
    url: pageUrl,
    ...(event.image_url ? { image: [event.image_url] } : {}),
    ...(event.source_url ? { sameAs: event.source_url } : {}),
  };
  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(event.title)} in Erfurt | wasgeht</title>
  <meta name="description" content="${escapeHtml(description.slice(0, 155))}">
  <link rel="canonical" href="${pageUrl}">
  <meta property="og:title" content="${escapeHtml(event.title)} in Erfurt | wasgeht">
  <meta property="og:description" content="${escapeHtml(description.slice(0, 200))}">
  <meta property="og:type" content="event">
  <meta property="og:url" content="${pageUrl}">
  ${event.image_url ? `<meta property="og:image" content="${escapeHtml(event.image_url)}">` : ""}
  <script type="application/ld+json">${escapeJson(schema)}</script>
  <style>
    :root { color-scheme: light; font-family: Helvetica, Arial, sans-serif; color: #2d252c; background: #f3edf0; }
    body { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
    a { color: inherit; } .eyebrow { letter-spacing: .12em; font-size: 12px; font-weight: 700; }
    article { padding: 28px; border: 1px solid rgba(255,255,255,.8); border-radius: 28px; background: rgba(255,255,255,.52); }
    img { display: block; width: 100%; max-height: 520px; object-fit: cover; border-radius: 20px; margin: 22px 0; }
    .meta { color: #6b6069; line-height: 1.7; } p { line-height: 1.7; }
  </style>
</head>
<body>
  <p><a href="${siteUrl}/">← Alle Events in Erfurt</a></p>
  <article>
    <p class="eyebrow">${escapeHtml(event.type || "EVENT")}</p>
    <h1>${escapeHtml(event.title)}</h1>
    ${image}
    <p class="meta"><strong>${escapeHtml(formatDate(event.starts_at))}</strong><br>${escapeHtml(event.venue)} · ${escapeHtml(event.place === "nearby" ? "Umgebung von Erfurt" : "Erfurt")}<br>${escapeHtml(event.price || "Eintritt frei")}</p>
    <p>${escapeHtml(description)}</p>
    ${event.source_url ? `<p><a href="${escapeHtml(event.source_url)}" rel="noopener noreferrer">Originalquelle öffnen ↗</a></p>` : ""}
  </article>
</body>
</html>`;
  const directory = join(outputDirectory, "event", slug);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.html"), html);
  urls.push({ loc: pageUrl, lastmod: new Date().toISOString(), changefreq: "daily", priority: "0.8" });
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url>
    <loc>${escapeHtml(url.loc)}</loc>
    ${url.lastmod ? `<lastmod>${url.lastmod}</lastmod>` : ""}
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`).join("\n")}
</urlset>
`;
await writeFile(join(outputDirectory, "sitemap.xml"), sitemap);
await writeFile(join(outputDirectory, "robots.txt"), `User-agent: *
Allow: /
Disallow: /admin
Disallow: /login

Sitemap: ${siteUrl}/sitemap.xml
`);

console.log(`Generated ${events.length} public event pages`);
