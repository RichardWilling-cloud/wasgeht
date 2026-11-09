// Builds the public website into ./_site:
// - copies only files that belong on the web (never schema, functions, app sources),
// - prerenders the upcoming events into index.html (crawlable, instant first paint),
// - generates static SEO pages per event and landing pages under /erfurt/,
// - writes sitemap.xml and robots.txt.
//
// Usage: SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… node scripts/build-site.mjs
// Optional: SITE_VERSION_DATE, SITE_VERSION_RUN, SITE_VERSION_COMMIT (set by CI).
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = process.cwd();
const outputDirectory = join(root, "_site");
const siteUrl = "https://wasgeht-ab.de";
const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const EVENTS_PER_PAGE = 12;
const TIME_ZONE = "Europe/Berlin";

if (!supabaseUrl || !publishableKey) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");
}

// Files and folders that are published. Everything else in the repository stays private.
const staticEntries = [
  "app.js",
  "analytics.js",
  "vendor",
  "wasgeht-ab-logo.svg",
  "assets/logo.png",
  "assets/icon.png",
  "CNAME",
  "404.html",
  "impressum",
  "datenschutz",
];

// ---------------------------------------------------------------------------
// Helpers

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const escapeJson = (value) => JSON.stringify(value)
  .replaceAll("<", "\\u003c")
  .replaceAll(" ", "\\u2028")
  .replaceAll(" ", "\\u2029");

const slugify = (value) => String(value ?? "")
  .replace(/ß/g, "ss")
  .normalize("NFKD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 90)
  .replace(/-+$/g, "");

const truncate = (value, length) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= length) return text;
  const cut = text.slice(0, length - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), length * 0.6)).trim()}…`;
};

const safeHttpUrl = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

const longDateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeStyle: "short", timeZone: TIME_ZONE });
const dateKeyFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const weekdayFormat = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short" });
const calendarFormat = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short" });
const timeFormat = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });

const formatLongDate = (value) => longDateFormat.format(new Date(value));
const dateKey = (value) => dateKeyFormat.format(new Date(value));
const addDays = (key, days) => {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
// Same label format as app.js, so the prerendered cards match the live ones.
const formatCardDate = (value, now) => {
  const date = new Date(value);
  const isToday = dateKey(date) === dateKey(now);
  return `${isToday ? "Heute · " : ""}${calendarFormat.format(date)} · ${timeFormat.format(date)}`;
};

const numericPrice = (value) => {
  const text = String(value ?? "");
  if (/\b(eintritt frei|kostenlos|gratis|free)\b/i.test(text)) return "0";
  const match = text.replace(",", ".").match(/\d+(?:\.\d{1,2})?/);
  return match ? Number(match[0]).toFixed(2) : null;
};

const locality = (event) => (event.place === "nearby" ? "Umgebung von Erfurt" : "Erfurt");

async function writeOutput(relativePath, content) {
  const target = join(outputDirectory, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

// ---------------------------------------------------------------------------
// Data

const now = new Date();
const recentCutoff = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
const eventsUrl = new URL(`${supabaseUrl}/rest/v1/events`);
eventsUrl.searchParams.set("select", "id,title,type,genre,starts_at,end_datetime,place,venue,price,poster,art,description,image_url,source_url,sort_order,updated_at,created_at");
eventsUrl.searchParams.set("is_public", "eq.true");
eventsUrl.searchParams.set("status", "eq.published");
eventsUrl.searchParams.set("starts_at", "not.is.null");
eventsUrl.searchParams.set("or", `(starts_at.gte.${recentCutoff},end_datetime.gte.${now.toISOString()})`);
eventsUrl.searchParams.set("order", "starts_at.asc");

const response = await fetch(eventsUrl, { headers: { apikey: publishableKey } });
if (!response.ok) {
  throw new Error(`Could not load public events: HTTP ${response.status} ${await response.text()}`);
}
const events = await response.json();

const usedSlugs = new Set();
const eventEntries = events.map((event) => {
  const baseSlug = slugify(event.title) || "event";
  const daySlug = dateKey(event.starts_at);
  let slug = `${baseSlug}-${daySlug}`;
  for (let suffix = 2; usedSlugs.has(slug); suffix += 1) slug = `${baseSlug}-${daySlug}-${suffix}`;
  usedSlugs.add(slug);
  return {
    event,
    slug,
    path: `/event/${slug}/`,
    pageUrl: `${siteUrl}/event/${slug}/`,
    lastmod: new Date(event.updated_at || event.created_at || now).toISOString(),
  };
});

const latest = (entries) => entries.reduce((max, entry) => (entry.lastmod > max ? entry.lastmod : max), "") || now.toISOString();
const sitemapUrls = [];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
for (const entry of staticEntries) {
  await cp(join(root, entry), join(outputDirectory, entry), { recursive: true });
}

// Legal pages must never go live with unfilled placeholders.
for (const legalPage of ["impressum/index.html", "datenschutz/index.html"]) {
  const content = await readFile(join(root, legalPage), "utf8");
  if (/\[\[(AUSFÜLLEN|PRÜFEN)/.test(content) && process.env.ALLOW_PLACEHOLDERS !== "1") {
    throw new Error(`${legalPage} still contains [[AUSFÜLLEN/PRÜFEN]] placeholders. Fill them in before deploying (ALLOW_PLACEHOLDERS=1 only for local test builds).`);
  }
}

// ---------------------------------------------------------------------------
// Shared page chrome for generated pages (no scripts → very strict CSP)

// Only the first-party analytics script runs on generated pages.
const generatedPageCsp = "default-src 'none'; script-src 'self'; connect-src https://zvhvofgpizwhtxmcnghm.supabase.co; img-src 'self' https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

const genrePages = [
  { slug: "rave", genre: "party", title: "Raves & Partys in Erfurt", description: "Raves, Clubnächte und Partys in Erfurt – aktuelle Termine auf wasgeht." },
  { slug: "konzerte", genre: "live", title: "Konzerte & Live-Events in Erfurt", description: "Konzerte, Live-Musik und Kulturveranstaltungen in Erfurt entdecken." },
  { slug: "szene", genre: "szene", title: "Szene-Events in Erfurt", description: "Märkte, Nerd-, Gothic-, LARP- und weitere Szene-Events in Erfurt." },
  { slug: "ruhig", genre: "chill", title: "Ruhige Veranstaltungen in Erfurt", description: "Lesungen, Workshops und entspannte Veranstaltungen in Erfurt." },
];
const genreLanding = Object.fromEntries(genrePages.map((page) => [page.genre, page]));

const headBlock = ({ title, description, canonical, ogType, image, eventId }) => `
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${generatedPageCsp}">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/assets/icon.png" type="image/png">
  <meta property="og:site_name" content="wasgeht">
  <meta property="og:locale" content="de_DE">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${escapeHtml(image || `${siteUrl}/assets/logo.png`)}">
  <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">${eventId ? `
  <meta name="wasgeht-event-id" content="${escapeHtml(eventId)}">` : ""}
  <script src="/analytics.js" defer></script>`;

const footerLinks = `<p class="legal"><a href="${siteUrl}/impressum/">Impressum</a> · <a href="${siteUrl}/datenschutz/">Datenschutz</a></p>`;

// ---------------------------------------------------------------------------
// Event pages

for (const { event, path, pageUrl } of eventEntries) {
  const imageUrl = safeHttpUrl(event.image_url);
  const sourceUrl = safeHttpUrl(event.source_url);
  const description = event.description || `${event.title} in ${event.venue}, ${locality(event)}.`;
  const price = numericPrice(event.price);
  const genrePage = genreLanding[event.genre];
  const eventSchema = {
    "@type": "Event",
    "@id": `${pageUrl}#event`,
    name: event.title,
    startDate: new Date(event.starts_at).toISOString(),
    ...(event.end_datetime ? { endDate: new Date(event.end_datetime).toISOString() } : {}),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: event.venue,
      address: { "@type": "PostalAddress", addressLocality: locality(event), addressRegion: "Thüringen", addressCountry: "DE" },
    },
    description,
    url: pageUrl,
    ...(imageUrl ? { image: [imageUrl] } : {}),
    ...(sourceUrl ? { sameAs: sourceUrl } : {}),
    ...(price !== null ? { offers: { "@type": "Offer", price, priceCurrency: "EUR", url: sourceUrl || pageUrl } } : {}),
  };
  const breadcrumb = [
    { name: "wasgeht", item: `${siteUrl}/` },
    { name: "Events in Erfurt", item: `${siteUrl}/erfurt/` },
    ...(genrePage ? [{ name: genrePage.title, item: `${siteUrl}/erfurt/${genrePage.slug}/` }] : []),
    { name: event.title, item: pageUrl },
  ];
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      eventSchema,
      {
        "@type": "BreadcrumbList",
        itemListElement: breadcrumb.map((crumb, index) => ({ "@type": "ListItem", position: index + 1, ...crumb })),
      },
    ],
  };
  const title = `${event.title} – ${calendarFormat.format(new Date(event.starts_at))} in Erfurt | wasgeht`;
  const html = `<!doctype html>
<html lang="de">
<head>${headBlock({ title, description: truncate(description, 155), canonical: pageUrl, ogType: "website", image: imageUrl, eventId: event.id })}
  <script type="application/ld+json">${escapeJson(schema)}</script>
  <style>
    :root { color-scheme: light; font-family: Helvetica, Arial, sans-serif; color: #2d252c; background: #f3edf0; }
    body { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
    a { color: inherit; } .eyebrow { letter-spacing: .12em; font-size: 12px; font-weight: 700; }
    article { padding: 28px; border: 1px solid rgba(255,255,255,.8); border-radius: 28px; background: rgba(255,255,255,.52); }
    img { display: block; width: 100%; height: auto; max-height: 520px; object-fit: cover; border-radius: 20px; margin: 22px 0; }
    .meta { color: #6b6069; line-height: 1.7; } p { line-height: 1.7; } .legal { margin-top: 40px; font-size: 12px; color: #6b6069; }
  </style>
</head>
<body>
  <nav aria-label="Brotkrumen"><p><a href="${siteUrl}/">← Alle Events in Erfurt</a>${genrePage ? ` · <a href="${siteUrl}/erfurt/${genrePage.slug}/">${escapeHtml(genrePage.title.replace(" in Erfurt", ""))}</a>` : ""}</p></nav>
  <main>
    <article>
      <p class="eyebrow">${escapeHtml(event.type || "EVENT")}</p>
      <h1>${escapeHtml(event.title)}</h1>
      ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(event.title)}" referrerpolicy="no-referrer" decoding="async">` : ""}
      <p class="meta"><strong><time datetime="${escapeHtml(new Date(event.starts_at).toISOString())}">${escapeHtml(formatLongDate(event.starts_at))}</time></strong>${event.end_datetime ? ` bis ${escapeHtml(formatLongDate(event.end_datetime))}` : ""}<br>${escapeHtml(event.venue)} · ${escapeHtml(locality(event))}<br>${escapeHtml(event.price || "Preis unbekannt")}</p>
      <p>${escapeHtml(description)}</p>
      ${sourceUrl ? `<p><a href="${escapeHtml(sourceUrl)}" rel="noopener noreferrer">Originalquelle öffnen ↗</a></p>` : ""}
    </article>
  </main>
  ${footerLinks}
</body>
</html>
`;
  await writeOutput(`${path.slice(1)}index.html`, html);
}

// ---------------------------------------------------------------------------
// Landing pages under /erfurt/

const landingPageStyle = `
  :root { color-scheme: light; font-family: Helvetica, Arial, sans-serif; color: #2d252c; background: #f3edf0; }
  body { max-width: 1000px; margin: 0 auto; padding: 32px 20px 64px; }
  a { color: inherit; } .eyebrow { letter-spacing: .12em; font-size: 12px; font-weight: 700; }
  .event-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; }
  article { padding: 20px; border: 1px solid rgba(255,255,255,.8); border-radius: 24px; background: rgba(255,255,255,.52); }
  article h2 { margin: 8px 0; font-size: 20px; } .meta { color: #6b6069; line-height: 1.6; } p { line-height: 1.7; }
  .links { display: flex; flex-wrap: wrap; gap: 12px; margin: 24px 0; } .links a { padding: 10px 14px; border-radius: 999px; background: rgba(255,255,255,.65); }
  .legal { margin-top: 40px; font-size: 12px; color: #6b6069; }
`;

async function renderLandingPage({ path, title, description, entries, intro }) {
  const pageUrl = `${siteUrl}/${path}/`;
  const cards = entries.length
    ? entries.map(({ event, pageUrl: eventUrl }) => `
      <article>
        <p class="eyebrow">${escapeHtml(event.type || "EVENT")}</p>
        <h2><a href="${eventUrl}">${escapeHtml(event.title)}</a></h2>
        <p class="meta"><time datetime="${escapeHtml(new Date(event.starts_at).toISOString())}">${escapeHtml(formatLongDate(event.starts_at))}</time><br>${escapeHtml(event.venue)} · ${escapeHtml(locality(event))}</p>
      </article>`).join("")
    : "<p>Aktuell sind keine passenden Veranstaltungen veröffentlicht. Schau bald wieder vorbei!</p>";
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": pageUrl,
    name: title,
    description,
    url: pageUrl,
    inLanguage: "de-DE",
    isPartOf: { "@id": `${siteUrl}/#website` },
    about: { "@type": "City", name: "Erfurt" },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: entries.length,
      itemListElement: entries.map(({ pageUrl: eventUrl }, index) => ({ "@type": "ListItem", position: index + 1, url: eventUrl })),
    },
  };
  const html = `<!doctype html>
<html lang="de">
<head>${headBlock({ title: `${title} | wasgeht`, description, canonical: pageUrl, ogType: "website" })}
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
    ${genrePages.map((page) => `<a href="${siteUrl}/erfurt/${page.slug}/">${escapeHtml(page.title.replace(" in Erfurt", ""))}</a>`).join("")}
    <a href="${siteUrl}/erfurt/wochenende/">Dieses Wochenende</a>
  </nav>
  <main class="event-grid">${cards}</main>
  ${footerLinks}
</body>
</html>
`;
  await writeOutput(`${path}/index.html`, html);
  sitemapUrls.push({ loc: pageUrl, lastmod: latest(entries) });
}

await renderLandingPage({
  path: "erfurt",
  title: "Events in Erfurt",
  description: "Alle aktuellen Veranstaltungen, Raves, Konzerte und Szene-Events in Erfurt auf einen Blick.",
  entries: eventEntries,
  intro: "Was geht in Erfurt? Hier findest du die aktuellen öffentlichen Veranstaltungen der Stadt und Umgebung – täglich aktualisiert.",
});
for (const page of genrePages) {
  await renderLandingPage({
    path: `erfurt/${page.slug}`,
    title: page.title,
    description: page.description,
    entries: eventEntries.filter(({ event }) => event.genre === page.genre),
    intro: page.description,
  });
}

// Weekend = Friday to Sunday of the current week (Europe/Berlin), like the filter on the homepage.
const todayKey = dateKey(now);
const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekdayFormat.format(now)) + 1;
const sundayKey = addDays(todayKey, 7 - weekday);
const weekendStart = weekday >= 5 ? todayKey : addDays(sundayKey, -2);
await renderLandingPage({
  path: "erfurt/wochenende",
  title: "Events am Wochenende in Erfurt",
  description: "Raves, Konzerte und Veranstaltungen am Wochenende in Erfurt.",
  entries: eventEntries.filter(({ event }) => {
    const startKey = dateKey(event.starts_at);
    const endKey = event.end_datetime ? dateKey(event.end_datetime) : startKey;
    return startKey <= sundayKey && endKey >= weekendStart;
  }),
  intro: "Finde aktuelle Veranstaltungen für dein Wochenende in Erfurt. Die Übersicht wird automatisch mit den veröffentlichten Events aktualisiert.",
});

// ---------------------------------------------------------------------------
// Homepage: prerender the first page of event cards (same markup as app.js)

const homepageEntries = [...eventEntries].sort((a, b) =>
  ((a.event.sort_order ?? 0) - (b.event.sort_order ?? 0)) || String(a.event.starts_at).localeCompare(String(b.event.starts_at)));

const renderCard = ({ event, path }) => {
  const imageUrl = safeHttpUrl(event.image_url);
  const poster = Math.max(1, Math.min(8, Number(event.poster) || 1));
  const cardDate = formatCardDate(event.starts_at, now);
  const art = String(event.art || event.title).split(/\n|<br\s*\/?>/i).map(escapeHtml).join("<br>");
  return `
          <article class="event-card" data-event-id="${escapeHtml(event.id)}">
            <div class="event-poster poster-${poster}${imageUrl ? " has-image" : ""}">
              ${imageUrl ? `<img class="event-poster-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(event.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}
              <span class="poster-label">${escapeHtml(event.type)}</span>
              <div class="poster-fallback"><div class="poster-type">${art}</div></div>
              <span class="poster-date">${escapeHtml(cardDate.split(" · ")[0])}</span>
            </div>
            <div class="event-info">
              <div class="event-meta"><span class="tag">${escapeHtml(event.type)}</span><time datetime="${escapeHtml(event.starts_at)}">${escapeHtml(cardDate)}</time></div>
              <h3><a class="event-link" href="${path}">${escapeHtml(event.title)}</a></h3>
              <div class="event-bottom"><span class="event-location">↗ ${escapeHtml(event.venue)}</span><span class="price">${escapeHtml(event.price || "Eintritt frei")}</span></div>
            </div>
          </article>`;
};

let indexHtml = await readFile(join(root, "index.html"), "utf8");
const replaceOnce = (search, replacement) => {
  if (!indexHtml.includes(search)) throw new Error(`index.html marker not found: ${search}`);
  indexHtml = indexHtml.replace(search, () => replacement);
};

const visibleCount = Math.min(EVENTS_PER_PAGE, homepageEntries.length);
replaceOnce('<span id="resultsCount">Events werden geladen …</span>', `<span id="resultsCount">${homepageEntries.length > visibleCount
  ? `${visibleCount} von ${homepageEntries.length} Veranstaltungen`
  : `${homepageEntries.length} ${homepageEntries.length === 1 ? "Veranstaltung" : "Veranstaltungen"}`}</span>`);
replaceOnce('<div class="event-grid" id="eventGrid"></div>', `<div class="event-grid" id="eventGrid">${homepageEntries.length
  ? homepageEntries.slice(0, EVENTS_PER_PAGE).map(renderCard).join("")
  : '<div class="empty-state"><strong>Hier ist gerade noch Platz.</strong>Probier einen anderen Filter oder such nach etwas anderem.</div>'}
      </div>
      <script type="application/json" id="eventPaths">${escapeJson(Object.fromEntries(eventEntries.map(({ event, path }) => [event.id, path])))}</script>`);
if (homepageEntries.length > EVENTS_PER_PAGE) {
  replaceOnce('<div class="load-more" id="loadMoreEvents" hidden>', '<div class="load-more" id="loadMoreEvents">');
}

// Homepage structured data: list of upcoming events, pointing to their own pages.
const structuredDataMatch = indexHtml.match(/(<script type="application\/ld\+json" id="siteStructuredData">)([\s\S]*?)(<\/script>)/);
if (!structuredDataMatch) throw new Error("index.html structured data block not found");
const structuredData = JSON.parse(structuredDataMatch[2]);
structuredData["@graph"].push({
  "@type": "ItemList",
  "@id": `${siteUrl}/#upcoming-events`,
  name: "Aktuelle Events in Erfurt",
  numberOfItems: homepageEntries.length,
  itemListElement: homepageEntries.slice(0, 50).map(({ pageUrl }, index) => ({ "@type": "ListItem", position: index + 1, url: pageUrl })),
});
indexHtml = indexHtml.replace(structuredDataMatch[0], () => `${structuredDataMatch[1]}${escapeJson(structuredData)}${structuredDataMatch[3]}`);

const { SITE_VERSION_DATE: versionDate, SITE_VERSION_RUN: versionRun, SITE_VERSION_COMMIT: versionCommit } = process.env;
if (versionDate && versionRun && versionCommit) {
  replaceOnce(
    '<span class="site-version" id="siteVersionLabel" title="Website-Version wird geladen">Version wird geladen</span>',
    `<span class="site-version" id="siteVersionLabel" title="Veröffentlichter Commit ${escapeHtml(versionCommit)}" data-commit="${escapeHtml(versionCommit)}">Live · ${escapeHtml(versionDate)} · #${escapeHtml(versionRun)}</span>`,
  );
}
await writeOutput("index.html", indexHtml);
sitemapUrls.unshift({ loc: `${siteUrl}/`, lastmod: latest(eventEntries) });

for (const entry of eventEntries) sitemapUrls.push({ loc: entry.pageUrl, lastmod: entry.lastmod });
sitemapUrls.push({ loc: `${siteUrl}/impressum/` }, { loc: `${siteUrl}/datenschutz/` });

// ---------------------------------------------------------------------------
// sitemap.xml + robots.txt

await writeOutput("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((url) => `  <url>
    <loc>${escapeHtml(url.loc)}</loc>${url.lastmod ? `
    <lastmod>${url.lastmod}</lastmod>` : ""}
  </url>`).join("\n")}
</urlset>
`);
await writeOutput("robots.txt", `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`);

console.log(`Built _site with ${eventEntries.length} event pages, ${genrePages.length + 2} landing pages and ${sitemapUrls.length} sitemap URLs`);
