// Builds the public website into ./_site:
// - copies only files that belong on the web (never schema, functions, app sources),
// - prerenders the upcoming events into index.html (crawlable, instant first paint),
// - generates SEO pages in the site design: one page per event, date pages
//   (heute / wochenende / diese Woche), genre pages, a venue directory and one page per venue,
// - restyles the legal pages and the 404 page with the same design,
// - writes sitemap.xml and robots.txt.
//
// Usage: SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… node scripts/build-site.mjs
// Optional: SITE_VERSION_DATE, SITE_VERSION_RUN, SITE_VERSION_COMMIT (set by CI).
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalVenue } from "../lib/venues.mjs";

const root = process.cwd();
const outputDirectory = join(root, "_site");
const siteUrl = "https://wasgeht-ab.de";
const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const EVENTS_PER_PAGE = 12;
const TIME_ZONE = "Europe/Berlin";
const DEFAULT_IMAGE = `${siteUrl}/assets/og-image.jpg`;

if (!supabaseUrl || !publishableKey) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");
}

// Files and folders that are published. Everything else in the repository stays private.
const staticEntries = [
  "app.js",
  "analytics.js",
  "site.js",
  "vendor",
  "wasgeht-ab-logo.svg",
  "assets/logo.png",
  "assets/favicon",
  "favicon.ico",
  "site.webmanifest",
  "assets/og-image.jpg",
  "CNAME",
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
const fullDayFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeZone: TIME_ZONE });
const dateKeyFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const weekdayFormat = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short" });
const calendarFormat = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short" });
const shortDayFormat = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, day: "numeric", month: "long" });
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
const looksLikeAddress = (value) => /\d/.test(String(value || "")) || /^ort noch offen$/i.test(String(value || "").trim());

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
eventsUrl.searchParams.set("select", "id,title,type,genre,starts_at,end_datetime,place,venue,address,price,poster,art,description,image_url,source_url,sort_order,updated_at,created_at");
eventsUrl.searchParams.set("is_public", "eq.true");
eventsUrl.searchParams.set("status", "eq.published");
eventsUrl.searchParams.set("starts_at", "not.is.null");
eventsUrl.searchParams.set("or", `(starts_at.gte.${recentCutoff},end_datetime.gte.${now.toISOString()})`);
eventsUrl.searchParams.set("order", "starts_at.asc");

const response = await fetch(eventsUrl, { headers: { apikey: publishableKey } });
if (!response.ok) {
  throw new Error(`Could not load public events: HTTP ${response.status} ${await response.text()}`);
}
const events = (await response.json()).map((event) => ({ ...event, venue: canonicalVenue(event.venue) }));

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
    startKey: dateKey(event.starts_at),
    endKey: event.end_datetime ? dateKey(event.end_datetime) : dateKey(event.starts_at),
    lastmod: new Date(event.updated_at || event.created_at || now).toISOString(),
  };
});

// Venues with at least one upcoming event get their own page (searches like "Kalif Storch Programm").
const venueGroups = new Map();
for (const entry of eventEntries) {
  const name = String(entry.event.venue || "").trim();
  if (!name || looksLikeAddress(name)) continue;
  const slug = slugify(name);
  if (!slug) continue;
  if (!venueGroups.has(slug)) venueGroups.set(slug, { slug, names: new Map(), addresses: new Map(), entries: [] });
  const group = venueGroups.get(slug);
  group.names.set(name, (group.names.get(name) || 0) + 1);
  if (entry.event.address) group.addresses.set(entry.event.address, (group.addresses.get(entry.event.address) || 0) + 1);
  group.entries.push(entry);
}
const mostCommon = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || (/[A-ZÄÖÜ]/.test(b[0][0]) ? 1 : -1))[0]?.[0];
const venues = [...venueGroups.values()].map((group) => ({
  slug: group.slug,
  name: mostCommon(group.names),
  address: mostCommon(group.addresses) || null,
  entries: group.entries,
  path: `/erfurt/locations/${group.slug}/`,
  pageUrl: `${siteUrl}/erfurt/locations/${group.slug}/`,
})).sort((a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name, "de"));
const venueBySlug = new Map(venues.map((venue) => [venue.slug, venue]));
const venueFor = (event) => venueBySlug.get(slugify(event.venue || ""));

const latest = (entries) => entries.reduce((max, entry) => (entry.lastmod > max ? entry.lastmod : max), "") || now.toISOString();
const sitemapUrls = [];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
for (const entry of staticEntries) {
  await cp(join(root, entry), join(outputDirectory, entry), { recursive: true });
}
// IndexNow key file (lets Bing, DuckDuckGo & co. accept URL change notifications).
for (const file of await readdir(root)) {
  if (/^[0-9a-f]{32}\.txt$/.test(file)) await cp(join(root, file), join(outputDirectory, file));
}

// Legal pages must never go live with unfilled placeholders.
for (const legalPage of ["impressum/index.html", "datenschutz/index.html"]) {
  const content = await readFile(join(root, legalPage), "utf8");
  if (/\[\[(AUSFÜLLEN|PRÜFEN)/.test(content) && process.env.ALLOW_PLACEHOLDERS !== "1") {
    throw new Error(`${legalPage} still contains [[AUSFÜLLEN/PRÜFEN]] placeholders. Fill them in before deploying (ALLOW_PLACEHOLDERS=1 only for local test builds).`);
  }
}

// ---------------------------------------------------------------------------
// Shared design: the homepage stylesheet is reused for every generated page.

let indexHtml = await readFile(join(root, "index.html"), "utf8");
const versionTag = (process.env.SITE_VERSION_COMMIT || String(now.getTime())).slice(0, 12);
const homepageCss = indexHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const cspMeta = indexHtml.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/)?.[0];
const themeScript = indexHtml.match(/<script>try\{[\s\S]*?<\/script>/)?.[0];
if (!homepageCss || !cspMeta || !themeScript) throw new Error("index.html: stylesheet, CSP or theme script not found");

const staticPageCss = `
    body.static-page main { min-height: 50vh; }
    .page-head { padding: 30px 0 8px; }
    .breadcrumbs { margin: 0 0 24px; color: var(--muted); font-size: 11px; letter-spacing: .02em; }
    .breadcrumbs a:hover { color: var(--blue); }
    .page-head h1 { max-width: 900px; margin: 0 0 18px; font-size: clamp(40px, 6.4vw, 82px); line-height: .9; letter-spacing: -.075em; font-weight: 900; }
    .page-head h1 em { color: var(--orange); font-style: normal; }
    .page-intro { max-width: 640px; margin: 0; color: var(--body-copy); font-size: 15px; line-height: 1.6; }
    .page-updated { margin: 12px 0 0; color: var(--muted); font-size: 11px; }
    .chip-links { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0 0; }
    .chip-links a { padding: 9px 15px; border: 1px solid rgba(126,107,132,.2); border-radius: 999px; background: var(--control-glass); font-size: 12px; font-weight: 700; backdrop-filter: blur(12px); }
    .chip-links a:hover { background: var(--control-active); }
    .chip-links a[aria-current="page"] { background: var(--surprise-glass); color: #fff; }
    .static-cards .event-card { position: relative; }
    .static-cards .event-link::after { position: absolute; inset: 0; content: ""; }
    .section-title { margin: 0 0 16px; font-size: clamp(24px, 3vw, 36px); line-height: 1; letter-spacing: -.055em; }
    .static-copy { max-width: 760px; margin: 52px 0 0; color: var(--body-copy); font-size: 14px; line-height: 1.65; }
    .static-copy h2 { margin: 26px 0 8px; color: var(--ink); font-size: 20px; letter-spacing: -.03em; }
    .static-copy a, .detail-facts a, .legal-content a { text-decoration: underline; text-underline-offset: 3px; }
    .event-detail { align-items: start; }
    .event-detail .event-poster { height: auto; aspect-ratio: 4 / 3; margin: 0; }
    .event-detail h1 { margin: 0 0 20px; font-size: clamp(36px, 5vw, 64px); line-height: .93; letter-spacing: -.07em; }
    .detail-facts { display: grid; gap: 9px; margin: 0 0 22px; padding: 0; list-style: none; color: var(--body-copy); font-size: 14px; line-height: 1.45; }
    .detail-facts strong { display: inline-block; min-width: 72px; color: var(--ink); }
    .event-detail .detail-description { margin: 0 0 26px; }
    .detail-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .detail-actions .surprise { padding: 14px 20px; }
    .venue-directory { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
    .venue-directory a { display: flex; justify-content: space-between; gap: 12px; padding: 16px 18px; border: 1px solid rgba(126,107,132,.18); border-radius: 20px; background: var(--event-glass); box-shadow: var(--event-shadow); font-weight: 800; letter-spacing: -.02em; }
    .venue-directory a:hover { transform: translateY(-3px); }
    .venue-directory span { color: var(--muted); font-size: 12px; font-weight: 700; }
    .legal-panel { display: block; }
    .legal-content { max-width: 760px; color: var(--body-copy); font-size: 14px; line-height: 1.7; }
    .legal-content h2 { margin: 30px 0 8px; color: var(--ink); font-size: 20px; letter-spacing: -.03em; }
    .legal-content h3 { margin: 22px 0 6px; color: var(--ink); font-size: 16px; }
    .legal-content .eyebrow { display: none; }
    .legal-content h1 { display: none; }
    @media (max-width: 820px) {
      body.static-page .nav-links { display: none; }
      body.static-page .nav-actions > a.submit-link { display: inline-flex; }
    }
    @media (max-width: 640px) {
      body.static-page a.submit-link { display: inline-flex; padding: 10px 14px; font-size: 11px; }
      .event-detail { padding: 22px 18px; }
    }
`;
// The stylesheet lives in /assets/, so the logo mask needs an absolute path.
await writeOutput("assets/site.css", `${homepageCss.replaceAll('url("wasgeht-ab-logo.svg")', 'url("/wasgeht-ab-logo.svg")')}\n${staticPageCss}`);

const genrePages = [
  { slug: "rave", genre: "party", label: "Partys & Raves", title: "Partys & Raves in Erfurt", seoTitle: "Partys & Raves in Erfurt – Clubnächte, Techno & mehr", description: "Partys, Raves und Clubnächte in Erfurt: alle kommenden Termine von Techno bis 80er-Party – täglich aktualisiert.", intro: "Techno im Club, Indie-Abend, 80er-Party oder Rave: Hier findest du alle kommenden Partys und Clubnächte in Erfurt auf einen Blick." },
  { slug: "konzerte", genre: "live", label: "Konzerte & Kultur", title: "Konzerte & Kultur in Erfurt", seoTitle: "Konzerte in Erfurt – Live-Musik, Theater & Kultur", description: "Konzerte, Live-Musik, Theater und Kulturveranstaltungen in Erfurt – alle kommenden Termine, täglich aktualisiert.", intro: "Von der kleinen Bühne bis zum großen Saal: Alle kommenden Konzerte, Lesungen mit Musik, Theater- und Kulturabende in Erfurt." },
  { slug: "szene", genre: "szene", label: "Szene & Nerd", title: "Szene- & Nerd-Events in Erfurt", seoTitle: "Szene- & Nerd-Events in Erfurt – Gaming, LARP, Märkte", description: "Trading-Card-Turniere, Gaming, LARP, Flohmärkte und Szene-Treffen in Erfurt – alle kommenden Termine.", intro: "Magic, Yu-Gi-Oh!, Pen & Paper, LARP, Flohmärkte und Szene-Treffen: Alles für Nerds und Subkulturen in Erfurt." },
  { slug: "ruhig", genre: "chill", label: "Ruhige Events", title: "Ruhige Veranstaltungen in Erfurt", seoTitle: "Ruhige Events in Erfurt – Workshops, Lesungen & Ausstellungen", description: "Workshops, Lesungen, Ausstellungen und entspannte Veranstaltungen in Erfurt – alle kommenden Termine.", intro: "Lieber entspannt? Workshops, Lesungen, Ausstellungen, Quiz- und Spieleabende in Erfurt." },
];
const genreLanding = Object.fromEntries(genrePages.map((page) => [page.genre, page]));

const todayKey = dateKey(now);
const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekdayFormat.format(now)) + 1;
const sundayKey = addDays(todayKey, 7 - weekday);
const weekendStart = weekday >= 5 ? todayKey : addDays(sundayKey, -2);
const inRange = (entry, from, to) => entry.startKey <= to && entry.endKey >= from;

const navChips = [
  { path: "/erfurt/", label: "Alle Events" },
  { path: "/erfurt/heute/", label: "Heute" },
  { path: "/erfurt/wochenende/", label: "Wochenende" },
  { path: "/erfurt/diese-woche/", label: "Diese Woche" },
  ...genrePages.map((page) => ({ path: `/erfurt/${page.slug}/`, label: page.label })),
  { path: "/erfurt/locations/", label: "Clubs & Locations" },
];

const footerSeoLinks = '<nav class="wrap footer-seo" aria-label="Events in Erfurt"><a href="/erfurt/heute/">Heute in Erfurt</a><a href="/erfurt/wochenende/">Wochenende</a><a href="/erfurt/diese-woche/">Diese Woche</a><a href="/erfurt/rave/">Partys &amp; Raves</a><a href="/erfurt/konzerte/">Konzerte</a><a href="/erfurt/szene/">Szene &amp; Nerd</a><a href="/erfurt/ruhig/">Ruhige Events</a><a href="/erfurt/locations/">Clubs &amp; Locations</a></nav>';

function renderPage({ title, description, canonical, image, eventId, jsonLd, body, robots, ogType = "website" }) {
  return `<!doctype html>
<html lang="de" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${cspMeta}
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="theme-color" content="#2d2b30">
  ${themeScript}
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">${robots ? `
  <meta name="robots" content="${robots}">` : ""}${canonical ? `
  <link rel="canonical" href="${canonical}">` : ""}
  <link rel="icon" href="/favicon.ico?v=2" sizes="48x48">
  <link rel="icon" href="/assets/favicon/favicon.svg?v=2" type="image/svg+xml">
  <link rel="icon" href="/assets/favicon/icon-192.png?v=2" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="/assets/favicon/apple-touch-icon.png?v=2">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="stylesheet" href="/assets/site.css?v=${versionTag}">
  <script src="/site.js?v=${versionTag}"></script>
  <meta property="og:site_name" content="wasgeht">
  <meta property="og:locale" content="de_DE">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="${ogType}">${canonical ? `
  <meta property="og:url" content="${canonical}">` : ""}
  <meta property="og:image" content="${escapeHtml(image || DEFAULT_IMAGE)}">
  <meta name="twitter:card" content="summary_large_image">${eventId ? `
  <meta name="wasgeht-event-id" content="${escapeHtml(eventId)}">` : ""}
  <script src="/analytics.js" defer></script>${jsonLd ? `
  <script type="application/ld+json">${escapeJson(jsonLd)}</script>` : ""}
</head>
<body class="static-page">
  <div class="ambient-bg" aria-hidden="true">
    <div class="ambient-orb ambient-orb--rose"></div>
    <div class="ambient-orb ambient-orb--lilac"></div>
  </div>
  <div class="topline"><div class="wrap"><span><i class="live-dot"></i>Deine Events, endlich an einem Ort</span></div></div>
  <header class="wrap nav">
    <a class="brand" href="/" aria-label="wasgeht Startseite"><span class="brand-mark" role="img" aria-label="wasgeht-ab.de"></span></a>
    <nav class="nav-links" aria-label="Hauptnavigation">
      <a href="/#events">Events entdecken</a>
      <a href="/erfurt/heute/">Heute</a>
      <a href="/erfurt/wochenende/">Dieses Wochenende</a>
      <a href="/erfurt/locations/">Locations</a>
    </nav>
    <div class="nav-actions"><a class="submit-link" href="/#veranstalter">Event eintragen ↗</a></div>
  </header>
  <main>
${body}
  </main>
  <footer class="footer">
    <div class="wrap footer-main">
      <a class="brand" href="/" aria-label="wasgeht Startseite"><span class="brand-mark" role="img" aria-label="wasgeht-ab.de"></span></a>
      <div class="footer-links"><a href="/#events">Events entdecken</a><a href="/#veranstalter">Event eintragen</a><a href="mailto:waslos@wasgeht-ab.de">Kontakt</a><a href="/impressum/">Impressum</a><a href="/datenschutz/">Datenschutz</a></div>
      <span class="copyright">© ${now.getFullYear()} wasgeht · Erfurt, Thüringen</span>
    </div>
    ${footerSeoLinks}
  </footer>
</body>
</html>
`;
}

const breadcrumbHtml = (crumbs) => `<nav class="breadcrumbs" aria-label="Brotkrumen">${crumbs
  .map((crumb, index) => (index === crumbs.length - 1 ? `<span aria-current="page">${escapeHtml(crumb.name)}</span>` : `<a href="${crumb.item.replace(siteUrl, "")}">${escapeHtml(crumb.name)}</a>`))
  .join(" › ")}</nav>`;
const breadcrumbSchema = (crumbs) => ({
  "@type": "BreadcrumbList",
  itemListElement: crumbs.map((crumb, index) => ({ "@type": "ListItem", position: index + 1, name: crumb.name, item: crumb.item })),
});
const chipsHtml = (currentPath) => `<nav class="chip-links" aria-label="Eventübersichten">${navChips
  .map((chip) => `<a href="${chip.path}"${chip.path === currentPath ? ' aria-current="page"' : ""}>${escapeHtml(chip.label)}</a>`).join("")}</nav>`;
const updatedLine = `<p class="page-updated">Aktualisiert am ${escapeHtml(fullDayFormat.format(now))}</p>`;

// Event card: identical markup to the homepage (app.js).
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
const cardGrid = (entries) => `<div class="event-grid static-cards">${entries.map(renderCard).join("")}
      </div>`;

const eventSchemaFor = ({ event, pageUrl }) => {
  const imageUrl = safeHttpUrl(event.image_url);
  const sourceUrl = safeHttpUrl(event.source_url);
  const venue = venueFor(event);
  const price = numericPrice(event.price);
  const street = event.address ? String(event.address).split(",")[0].trim() : null;
  const postalCode = String(event.address || "").match(/\b\d{5}\b/)?.[0];
  return {
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
      ...(venue ? { url: venue.pageUrl } : {}),
      address: {
        "@type": "PostalAddress",
        ...(street ? { streetAddress: street } : {}),
        ...(postalCode ? { postalCode } : {}),
        addressLocality: event.place === "nearby" ? "Umgebung von Erfurt" : "Erfurt",
        addressRegion: "Thüringen",
        addressCountry: "DE",
      },
    },
    organizer: {
      "@type": "Organization",
      name: event.venue,
      ...(sourceUrl ? { url: new URL(sourceUrl).origin } : {}),
    },
    description: event.description || `${event.title} in ${event.venue}, ${locality(event)}.`,
    url: pageUrl,
    image: [imageUrl || DEFAULT_IMAGE],
    ...(sourceUrl ? { sameAs: sourceUrl } : {}),
    ...(price !== null ? { offers: { "@type": "Offer", price, priceCurrency: "EUR", url: sourceUrl || pageUrl } } : {}),
  };
};

// ---------------------------------------------------------------------------
// Event pages

for (const entry of eventEntries) {
  const { event, path, pageUrl } = entry;
  const imageUrl = safeHttpUrl(event.image_url);
  const sourceUrl = safeHttpUrl(event.source_url);
  const description = event.description || `${event.title} in ${event.venue}, ${locality(event)}.`;
  const genrePage = genreLanding[event.genre];
  const venue = venueFor(event);
  const crumbs = [
    { name: "wasgeht", item: `${siteUrl}/` },
    { name: "Events in Erfurt", item: `${siteUrl}/erfurt/` },
    ...(genrePage ? [{ name: genrePage.label, item: `${siteUrl}/erfurt/${genrePage.slug}/` }] : []),
    { name: event.title, item: pageUrl },
  ];
  // Related events: same venue first, then same genre – strong internal linking.
  const related = [
    ...(venue ? venue.entries : []),
    ...eventEntries.filter((other) => other.event.genre === event.genre),
  ].filter((other, index, list) => other !== entry && list.indexOf(other) === index).slice(0, 8);
  const poster = Math.max(1, Math.min(8, Number(event.poster) || 1));
  const art = String(event.art || event.title).split(/\n|<br\s*\/?>/i).map(escapeHtml).join("<br>");
  const day = shortDayFormat.format(new Date(event.starts_at));
  const body = `
    <section class="wrap page-head">${breadcrumbHtml(crumbs)}</section>
    <section class="wrap">
      <article class="organizer-panel event-detail">
        <div class="event-poster poster-${poster}${imageUrl ? " has-image" : ""}">
          ${imageUrl ? `<img class="event-poster-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(event.title)}" decoding="async" referrerpolicy="no-referrer">` : ""}
          <span class="poster-label">${escapeHtml(event.type || "Event")}</span>
          <div class="poster-fallback"><div class="poster-type">${art}</div></div>
        </div>
        <div class="organizer-copy">
          <p class="eyebrow">${escapeHtml(event.type || "EVENT")} · ${escapeHtml(locality(event))}</p>
          <h1>${escapeHtml(event.title)}</h1>
          <ul class="detail-facts">
            <li><strong>Wann</strong> <time datetime="${escapeHtml(new Date(event.starts_at).toISOString())}">${escapeHtml(formatLongDate(event.starts_at))} Uhr</time>${event.end_datetime && dateKey(event.end_datetime) !== dateKey(event.starts_at) ? ` bis ${escapeHtml(fullDayFormat.format(new Date(event.end_datetime)))}` : ""}</li>
            <li><strong>Wo</strong> ${venue ? `<a href="${venue.path}">${escapeHtml(event.venue)}</a>` : escapeHtml(event.venue)}${event.address && !String(event.venue).includes(String(event.address).split(",")[0]) ? `, ${escapeHtml(event.address)}` : ""}</li>
            <li><strong>Eintritt</strong> ${escapeHtml(event.price || "Preis unbekannt")}</li>
          </ul>
          <p class="detail-description">${escapeHtml(description)}</p>
          <div class="detail-actions">
            ${sourceUrl ? `<a class="surprise" href="${escapeHtml(sourceUrl)}" rel="noopener noreferrer">Originalquelle &amp; Tickets ↗</a>` : ""}
            <a class="submit-link" href="/#events">Alle Events in Erfurt</a>
          </div>
        </div>
      </article>
    </section>
    ${related.length ? `<section class="wrap events">
      <h2 class="section-title">${venue && venue.entries.length > 1 ? `Mehr im ${escapeHtml(venue.name)} &amp; ähnliche Events` : "Ähnliche Events in Erfurt"}</h2>
      ${cardGrid(related)}
    </section>` : ""}`;
  await writeOutput(`${path.slice(1)}index.html`, renderPage({
    title: truncate(`${event.title} – ${event.venue}, ${day} | Events Erfurt`, 90),
    description: truncate(`${day}, ${timeFormat.format(new Date(event.starts_at))} Uhr im ${event.venue}: ${description}`, 158),
    canonical: pageUrl,
    image: imageUrl,
    eventId: event.id,
    jsonLd: { "@context": "https://schema.org", "@graph": [eventSchemaFor(entry), breadcrumbSchema(crumbs)] },
    body,
  }));
}

// ---------------------------------------------------------------------------
// Collection pages (date, genre, venue)

async function renderCollectionPage({ path, h1, seoTitle, description, intro, entries, crumbName, extraCopy = "", emptyText }) {
  const pageUrl = `${siteUrl}/${path}/`;
  const crumbs = [
    { name: "wasgeht", item: `${siteUrl}/` },
    ...(path === "erfurt" ? [] : [{ name: "Events in Erfurt", item: `${siteUrl}/erfurt/` }]),
    ...(path.startsWith("erfurt/locations/") ? [{ name: "Clubs & Locations", item: `${siteUrl}/erfurt/locations/` }] : []),
    { name: crumbName, item: pageUrl },
  ];
  const body = `
    <section class="wrap page-head">
      ${breadcrumbHtml(crumbs)}
      <p class="eyebrow">EVENTS IN ERFURT</p>
      <h1>${h1}</h1>
      <p class="page-intro">${escapeHtml(intro)}</p>
      ${updatedLine}
      ${chipsHtml(`/${path}/`)}
    </section>
    <section class="wrap events">
      <div class="results-line"><span>${entries.length} ${entries.length === 1 ? "Veranstaltung" : "Veranstaltungen"}</span></div>
      ${entries.length ? cardGrid(entries) : `<div class="event-grid"><div class="empty-state"><strong>Hier ist gerade noch Platz.</strong>${escapeHtml(emptyText || "Aktuell sind keine passenden Veranstaltungen eingetragen.")} <a href="/#events">Alle Events ansehen</a></div></div>`}
      ${extraCopy}
    </section>`;
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": pageUrl,
        name: seoTitle,
        description,
        url: pageUrl,
        inLanguage: "de-DE",
        isPartOf: { "@id": `${siteUrl}/#website` },
        about: { "@type": "City", name: "Erfurt" },
        dateModified: latest(entries),
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: entries.length,
          itemListElement: entries.slice(0, 100).map(({ pageUrl: eventUrl }, index) => ({ "@type": "ListItem", position: index + 1, url: eventUrl })),
        },
      },
      breadcrumbSchema(crumbs),
    ],
  };
  await writeOutput(`${path}/index.html`, renderPage({ title: `${seoTitle} | wasgeht`, description, canonical: pageUrl, jsonLd: schema, body }));
  sitemapUrls.push({ loc: pageUrl, lastmod: latest(entries) });
}

const venueLinksCopy = venues.length ? `<div class="static-copy"><h2>Clubs &amp; Locations in Erfurt</h2><p>${venues.slice(0, 30).map((venue) => `<a href="${venue.path}">${escapeHtml(venue.name)}</a>`).join(" · ")}</p></div>` : "";

await renderCollectionPage({
  path: "erfurt",
  h1: "Events in <em>Erfurt</em>",
  seoTitle: "Events in Erfurt – Partys, Konzerte & Veranstaltungen",
  description: `Alle ${eventEntries.length} kommenden Events in Erfurt: Partys, Raves, Konzerte, Szene-Events und Workshops – täglich aktualisiert.`,
  intro: "Was geht in Erfurt? Alle kommenden öffentlichen Veranstaltungen der Stadt und Umgebung – täglich aus den Programmen der Clubs, Bars und Kulturorte zusammengetragen.",
  entries: eventEntries,
  crumbName: "Events in Erfurt",
  extraCopy: venueLinksCopy,
});

await renderCollectionPage({
  path: "erfurt/heute",
  h1: "Was ist <em>heute</em> los in Erfurt?",
  seoTitle: `Was ist heute los in Erfurt? Events am ${shortDayFormat.format(now)}`,
  description: `Events heute in Erfurt (${fullDayFormat.format(now)}): Partys, Konzerte, Workshops und mehr – alle Veranstaltungen des Tages auf einen Blick.`,
  intro: `Alle Veranstaltungen in Erfurt am ${fullDayFormat.format(now)} – von der Ausstellung am Nachmittag bis zur Party in der Nacht.`,
  entries: eventEntries.filter((entry) => inRange(entry, todayKey, todayKey)),
  crumbName: "Heute",
  emptyText: "Heute ist (noch) nichts eingetragen – schau aufs Wochenende!",
  extraCopy: venueLinksCopy,
});

await renderCollectionPage({
  path: "erfurt/wochenende",
  h1: "Was geht am <em>Wochenende</em>?",
  seoTitle: "Events am Wochenende in Erfurt – Partys, Konzerte & mehr",
  description: `Was geht am Wochenende in Erfurt? Partys, Konzerte und Veranstaltungen von ${shortDayFormat.format(new Date(`${weekendStart}T12:00:00Z`))} bis ${shortDayFormat.format(new Date(`${sundayKey}T12:00:00Z`))}.`,
  intro: "Freitag bis Sonntag in Erfurt: alle Partys, Konzerte, Märkte und Veranstaltungen für dein Wochenende.",
  entries: eventEntries.filter((entry) => inRange(entry, weekendStart, sundayKey)),
  crumbName: "Wochenende",
  extraCopy: venueLinksCopy,
});

await renderCollectionPage({
  path: "erfurt/diese-woche",
  h1: "Events <em>diese Woche</em> in Erfurt",
  seoTitle: "Events diese Woche in Erfurt – alle Termine der nächsten 7 Tage",
  description: "Alle Veranstaltungen in Erfurt in den nächsten sieben Tagen: Partys, Konzerte, Szene-Events und Workshops.",
  intro: "Die nächsten sieben Tage in Erfurt: Plane deine Woche mit allen Partys, Konzerten, Workshops und Szene-Events.",
  entries: eventEntries.filter((entry) => inRange(entry, todayKey, addDays(todayKey, 6))),
  crumbName: "Diese Woche",
  extraCopy: venueLinksCopy,
});

for (const page of genrePages) {
  await renderCollectionPage({
    path: `erfurt/${page.slug}`,
    h1: escapeHtml(page.title).replace(" in Erfurt", " in <em>Erfurt</em>"),
    seoTitle: page.seoTitle,
    description: page.description,
    intro: page.intro,
    entries: eventEntries.filter(({ event }) => event.genre === page.genre),
    crumbName: page.label,
    extraCopy: venueLinksCopy,
  });
}

// Venue directory + one page per venue.
{
  const pageUrl = `${siteUrl}/erfurt/locations/`;
  const crumbs = [
    { name: "wasgeht", item: `${siteUrl}/` },
    { name: "Events in Erfurt", item: `${siteUrl}/erfurt/` },
    { name: "Clubs & Locations", item: pageUrl },
  ];
  const body = `
    <section class="wrap page-head">
      ${breadcrumbHtml(crumbs)}
      <p class="eyebrow">EVENTS IN ERFURT</p>
      <h1>Clubs &amp; <em>Locations</em></h1>
      <p class="page-intro">Clubs, Bars, Kulturzentren und Veranstaltungsorte in Erfurt mit ihrem aktuellen Programm.</p>
      ${updatedLine}
      ${chipsHtml("/erfurt/locations/")}
    </section>
    <section class="wrap events">
      <ul class="venue-directory">${venues.map((venue) => `<li><a href="${venue.path}">${escapeHtml(venue.name)} <span>${venue.entries.length} ${venue.entries.length === 1 ? "Event" : "Events"}</span></a></li>`).join("")}</ul>
    </section>`;
  await writeOutput("erfurt/locations/index.html", renderPage({
    title: "Clubs & Locations in Erfurt – Programm & Events | wasgeht",
    description: `Programm von ${venues.length} Clubs, Bars und Kulturorten in Erfurt: ${venues.slice(0, 6).map((venue) => venue.name).join(", ")} und mehr.`,
    canonical: pageUrl,
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "CollectionPage", "@id": pageUrl, name: "Clubs & Locations in Erfurt", url: pageUrl, inLanguage: "de-DE", isPartOf: { "@id": `${siteUrl}/#website` } },
        breadcrumbSchema(crumbs),
      ],
    },
    body,
  }));
  sitemapUrls.push({ loc: pageUrl, lastmod: latest(eventEntries) });
}

for (const venue of venues) {
  await renderCollectionPage({
    path: venue.path.slice(1, -1),
    h1: `${escapeHtml(venue.name)} <em>Erfurt</em>`,
    seoTitle: `${venue.name} Erfurt – Programm & Events`,
    description: truncate(`Programm ${venue.name} Erfurt: ${venue.entries.length} kommende ${venue.entries.length === 1 ? "Veranstaltung" : "Veranstaltungen"}${venue.entries[0] ? `, als nächstes „${venue.entries[0].event.title}“ am ${shortDayFormat.format(new Date(venue.entries[0].event.starts_at))}` : ""}.`, 158),
    intro: `Alle kommenden Events im ${venue.name}${venue.address ? ` (${venue.address})` : ", Erfurt"} – Partys, Konzerte und mehr, täglich aus dem offiziellen Programm aktualisiert.`,
    entries: venue.entries,
    crumbName: venue.name,
    extraCopy: venueLinksCopy,
  });
}

// ---------------------------------------------------------------------------
// Legal pages and 404 in the site design

for (const [source, target, crumbName] of [
  ["impressum/index.html", "impressum/index.html", "Impressum"],
  ["datenschutz/index.html", "datenschutz/index.html", "Datenschutz"],
  ["404.html", "404.html", null],
]) {
  const html = await readFile(join(root, source), "utf8");
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "wasgeht";
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] || "";
  const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1] || null;
  const heading = html.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] || title;
  const article = html.match(/<article>([\s\S]*?)<\/article>/)?.[1] || "";
  const crumbs = crumbName ? [{ name: "wasgeht", item: `${siteUrl}/` }, { name: crumbName, item: canonical }] : null;
  const body = `
    <section class="wrap page-head">
      ${crumbs ? breadcrumbHtml(crumbs) : ""}
      <p class="eyebrow">${crumbName ? "RECHTLICHES" : "404"}</p>
      <h1>${heading}</h1>
    </section>
    <section class="wrap events">
      <div class="organizer-panel legal-panel"><div class="legal-content">${article}</div></div>
    </section>`;
  await writeOutput(target, renderPage({
    // Raw <title> text is already HTML-escaped in the source file.
    title: title.replace(/&amp;/g, "&"),
    description: description.replace(/&amp;/g, "&"),
    canonical,
    robots: crumbName ? null : "noindex",
    body,
  }));
}

// ---------------------------------------------------------------------------
// Homepage: prerender the first page of event cards (same markup as app.js)

const homepageEntries = [...eventEntries].sort((a, b) =>
  ((a.event.sort_order ?? 0) - (b.event.sort_order ?? 0)) || String(a.event.starts_at).localeCompare(String(b.event.starts_at)));

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
replaceOnce("<!--VENUE_LINKS-->", venues.length
  ? `<p>Programme der Locations: ${venues.slice(0, 25).map((venue) => `<a href="${venue.path}">${escapeHtml(venue.name)}</a>`).join(" · ")} · <a href="/erfurt/locations/">alle Clubs &amp; Locations</a></p>`
  : "");

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

console.log(`Built _site: ${eventEntries.length} event pages, ${venues.length} venue pages, ${genrePages.length + 4} collection pages, ${sitemapUrls.length} sitemap URLs`);
