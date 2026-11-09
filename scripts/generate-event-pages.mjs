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

const numericPrice = (value) => {
  const match = String(value ?? "").replace(",", ".").match(/\d+(?:\.\d{1,2})?/);
  return match ? Number(match[0]).toFixed(2) : null;
};

const genrePages = [
  { slug: "rave", genre: "party", title: "Raves & Partys in Erfurt", description: "Raves, Clubnächte und Partys in Erfurt – aktuelle Termine auf wasgeht." },
  { slug: "konzerte", genre: "live", title: "Konzerte & Live-Events in Erfurt", description: "Konzerte, Live-Musik und Kulturveranstaltungen in Erfurt entdecken." },
  { slug: "szene", genre: "szene", title: "Szene-Events in Erfurt", description: "Märkte, Nerd-, Gothic-, LARP- und weitere Szene-Events in Erfurt." },
  { slug: "ruhig", genre: "chill", title: "Ruhige Veranstaltungen in Erfurt", description: "Lesungen, Workshops und entspannte Veranstaltungen in Erfurt." },
];

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
const eventEntries = events.map((event) => {
  const baseSlug = slugify(event.title) || "event";
  const dateSlug = new Date(event.starts_at).toISOString().slice(0, 10);
  let slug = `${baseSlug}-${dateSlug}`;
  let suffix = 2;
  while (usedSlugs.has(slug)) slug = `${baseSlug}-${dateSlug}-${suffix++}`;
  usedSlugs.add(slug);
  return { event, slug, pageUrl: `${siteUrl}/event/${slug}/` };
});

for (const { event, slug, pageUrl } of eventEntries) {
  const image = event.image_url ? `<img src="${escapeHtml(event.image_url)}" alt="${escapeHtml(event.title)}">` : "";
  const description = event.description || `${event.title} in ${event.venue}, Erfurt.`;
  const eventSchema = {
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
    ...(numericPrice(event.price) ? {
      offers: {
        "@type": "Offer",
        price: numericPrice(event.price),
        priceCurrency: "EUR",
        url: pageUrl,
        availability: "https://schema.org/InStock",
      },
    } : {}),
  };
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      eventSchema,
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "wasgeht", item: `${siteUrl}/` },
        { "@type": "ListItem", position: 2, name: "Events in Erfurt", item: `${siteUrl}/erfurt/` },
        { "@type": "ListItem", position: 3, name: event.title, item: pageUrl },
      ],
      },
    ],
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

const landingPageStyle = `
  :root { color-scheme: light; font-family: Helvetica, Arial, sans-serif; color: #2d252c; background: #f3edf0; }
  body { max-width: 1000px; margin: 0 auto; padding: 32px 20px 64px; }
  a { color: inherit; } .eyebrow { letter-spacing: .12em; font-size: 12px; font-weight: 700; }
  .event-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; }
  article { padding: 20px; border: 1px solid rgba(255,255,255,.8); border-radius: 24px; background: rgba(255,255,255,.52); }
  article h2 { margin: 8px 0; font-size: 20px; } .meta { color: #6b6069; line-height: 1.6; } p { line-height: 1.7; }
  .links { display: flex; flex-wrap: wrap; gap: 12px; margin: 24px 0; } .links a { padding: 10px 14px; border-radius: 999px; background: rgba(255,255,255,.65); }
`;

const renderLandingPage = async ({ path, title, description, pageEvents, intro }) => {
  const pageUrl = `${siteUrl}/${path}/`;
  const cards = pageEvents.length
    ? pageEvents.map(({ event, pageUrl: eventUrl }) => `
      <article>
        <p class="eyebrow">${escapeHtml(event.type || "EVENT")}</p>
        <h2><a href="${eventUrl}">${escapeHtml(event.title)}</a></h2>
        <p class="meta">${escapeHtml(formatDate(event.starts_at))}<br>${escapeHtml(event.venue)} · ${escapeHtml(event.place === "nearby" ? "Umgebung von Erfurt" : "Erfurt")}</p>
        <a href="${eventUrl}">Details ansehen ↗</a>
      </article>`).join("")
    : "<p>Aktuell sind keine passenden Veranstaltungen veröffentlicht.</p>";
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": pageUrl,
    name: title,
    description,
    url: pageUrl,
    isPartOf: { "@id": `${siteUrl}/#website` },
    about: { "@type": "City", name: "Erfurt" },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: pageEvents.map(({ pageUrl: eventUrl }, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: eventUrl,
      })),
    },
  };
  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | wasgeht</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${pageUrl}">
  <meta property="og:title" content="${escapeHtml(title)} | wasgeht">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website"><meta property="og:url" content="${pageUrl}">
  <script type="application/ld+json">${escapeJson(schema)}</script>
  <style>${landingPageStyle}</style>
</head>
<body>
  <p><a href="${siteUrl}/">← wasgeht Startseite</a></p>
  <p class="eyebrow">EVENTS IN ERFURT</p>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(intro)}</p>
  <nav class="links" aria-label="Weitere Eventübersichten">
    <a href="${siteUrl}/erfurt/">Alle Events</a>
    ${genrePages.map((genrePage) => `<a href="${siteUrl}/erfurt/${genrePage.slug}/">${escapeHtml(genrePage.title.replace(" in Erfurt", ""))}</a>`).join("")}
    <a href="${siteUrl}/erfurt/wochenende/">Dieses Wochenende</a>
  </nav>
  <main class="event-grid">${cards}</main>
</body>
</html>`;
  const directory = join(outputDirectory, ...path.split("/"));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.html"), html);
  urls.push({ loc: pageUrl, lastmod: new Date().toISOString(), changefreq: "daily", priority: "0.9" });
};

await renderLandingPage({
  path: "erfurt",
  title: "Events in Erfurt",
  description: "Alle aktuellen Veranstaltungen, Raves, Konzerte und Szene-Events in Erfurt auf einen Blick.",
  pageEvents: eventEntries,
  intro: "Was geht in Erfurt? Hier findest du die aktuellen öffentlichen Veranstaltungen der Stadt und Umgebung – täglich aktualisiert.",
});
for (const genrePage of genrePages) {
  await renderLandingPage({
    path: `erfurt/${genrePage.slug}`,
    title: genrePage.title,
    description: genrePage.description,
    pageEvents: eventEntries.filter(({ event }) => event.genre === genrePage.genre),
    intro: genrePage.description,
  });
}

const today = new Date();
const weekendEvents = eventEntries.filter(({ event }) => {
  const eventDate = new Date(event.starts_at);
  return eventDate >= today && eventDate.getTime() <= today.getTime() + (8 * 24 * 60 * 60 * 1000);
});
await renderLandingPage({
  path: "erfurt/wochenende",
  title: "Events am Wochenende in Erfurt",
  description: "Raves, Konzerte und Veranstaltungen am Wochenende in Erfurt.",
  pageEvents: weekendEvents,
  intro: "Finde aktuelle Veranstaltungen für dein Wochenende in Erfurt. Die Übersicht wird automatisch mit den veröffentlichten Events aktualisiert.",
});

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
