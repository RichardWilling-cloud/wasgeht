"use strict";

// The performance-lite class and the saved theme are applied by the small inline
// script in <head> so the first paint already matches; read the result here.
const performanceLite = document.documentElement.classList.contains("performance-lite");

(function initSiteVersion() {
  // The build step writes the deployed version directly into the label.
  const versionLabel = document.getElementById("siteVersionLabel");
  if (!versionLabel || versionLabel.dataset.commit) return;
  versionLabel.textContent = "Lokal · nicht veröffentlicht";
  versionLabel.title = "Diese Version ist noch nicht über GitHub Pages veröffentlicht.";
})();

let events = [];

const SUPABASE_URL = "https://zvhvofgpizwhtxmcnghm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_8tGj45KNbpGERTyOtC2Cfg_IiFh9myI";
const SUPABASE_AUTH_STORAGE_KEY = "sb-zvhvofgpizwhtxmcnghm-auth-token";
const SUPABASE_SDK_URL = "vendor/supabase-js-2.119.0.js";
const PUBLIC_EVENT_COLUMNS = "id,title,type,genre,starts_at,end_datetime,place,venue,price,poster,art,description,image_url,source_url,is_public,status,sort_order";
const TIME_ZONE = "Europe/Berlin";
const berlinDateKeyFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const berlinWeekdayFormat = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short" });
const berlinCalendarFormat = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short" });
const berlinTimeFormat = new Intl.DateTimeFormat("de-DE", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
const eventPaths = (() => {
  // Map of event id -> static SEO page, written by the build step.
  try {
    return JSON.parse(document.getElementById("eventPaths")?.textContent || "{}");
  } catch {
    return {};
  }
})();
let supabaseClient = null;
let supabaseReady = null;
let currentDetailEventId = null;
// Cookieless analytics (analytics.js); a no-op locally, on admin devices and when blocked.
const track = (type, data) => {
  try {
    window.wasgehtTrack?.(type, data);
  } catch {
    // analytics must never break the page
  }
};
let signedInUser = null;
let signedInRole = null;
const grid = document.getElementById("eventGrid");
const loadMoreEvents = document.getElementById("loadMoreEvents");
const loadMoreButton = document.getElementById("loadMoreButton");
const count = document.getElementById("resultsCount");
const search = document.getElementById("searchFilter");
const genreFilter = document.getElementById("genreFilter");
const dateFilter = document.getElementById("dateFilter");
const dateRange = document.getElementById("dateRange");
const dateStart = document.getElementById("dateStart");
const dateEnd = document.getElementById("dateEnd");
const placeFilter = document.getElementById("placeFilter");
const toast = document.getElementById("toast");
const themeToggle = document.getElementById("themeToggle");
const menuButton = document.getElementById("menuButton");
const mainNavigation = document.getElementById("mainNavigation");
const mainNav = document.querySelector(".nav");
const themeMeta = document.querySelector('meta[name="theme-color"]');
const heroArt = document.querySelector(".hero-art");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealObserver = !reduceMotion && "IntersectionObserver" in window
  ? new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 })
  : null;
let toastTimer;
const importSummary = document.getElementById("importSummary");
const reviewQueueList = document.getElementById("reviewQueueList");
const dryRunToggle = document.getElementById("dryRunToggle");
const runImportButton = document.getElementById("runImportButton");
const pauseImportButton = document.getElementById("pauseImportButton");
const resetImportProgressButton = document.getElementById("resetImportProgressButton");
let pauseImportAfterBatch = false;
let continueImportAutomatically = false;
let importRetriesWithoutProgress = 0;
const eventsPerPage = 12;
let visibleEventLimit = eventsPerPage;

function observeRevealElements(root = document) {
  const selector = root === document
    ? ".event-card, #veranstalter .organizer-panel"
    : ".event-card";
  root.querySelectorAll(selector).forEach((element) => {
    if (element.classList.contains("scroll-reveal")) return;
    element.classList.add("scroll-reveal");
    if (revealObserver) revealObserver.observe(element);
    else element.classList.add("is-visible");
  });
}

if (!performanceLite && !reduceMotion && window.matchMedia("(pointer: fine)").matches) {
  let pointerFrame = 0;
  heroArt.addEventListener("pointermove", (event) => {
    const bounds = heroArt.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2));
    const y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2));
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = requestAnimationFrame(() => {
      heroArt.style.setProperty("--disc-x", `${-x * 11}px`);
      heroArt.style.setProperty("--disc-y", `${-y * 9}px`);
      heroArt.style.setProperty("--sticker-x", `${x * 8}px`);
      heroArt.style.setProperty("--sticker-y", `${y * 7}px`);
      heroArt.style.setProperty("--cross-x", `${-x * 5}px`);
      heroArt.style.setProperty("--cross-y", `${-y * 4}px`);
      heroArt.style.setProperty("--ring-shift", `${x * 7}px`);
      heroArt.style.setProperty("--ring-shift-reverse", `${-x * 7}px`);
      pointerFrame = 0;
    });
  });
  heroArt.addEventListener("pointerleave", () => {
    ["--disc-x", "--disc-y", "--sticker-x", "--sticker-y", "--cross-x", "--cross-y", "--ring-shift", "--ring-shift-reverse"]
      .forEach((property) => heroArt.style.setProperty(property, "0px"));
  });

  let scrollFrame = 0;
  const updateScrollMotion = () => {
    const bounds = heroArt.getBoundingClientRect();
    const progress = (window.innerHeight - bounds.top) / (window.innerHeight + bounds.height);
    const drift = Math.max(-16, Math.min(16, (progress - 0.5) * 32));
    heroArt.style.setProperty("--scroll-drift", `${drift}px`);
    scrollFrame = 0;
  };
  window.addEventListener("scroll", () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(updateScrollMotion);
  }, { passive: true });
  updateScrollMotion();
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.setAttribute("aria-label", isDark ? "Helles Design einschalten" : "Dunkles Design einschalten");
  themeToggle.title = isDark ? "Zum hellen Design wechseln" : "Zum dunklen Design wechseln";
  themeToggle.querySelector(".theme-icon").textContent = isDark ? "☼" : "☾";
  themeToggle.querySelector(".theme-label").textContent = isDark ? "Hellmodus" : "Nachtmodus";
  themeMeta.content = isDark ? "#2d2b30" : "#f3edf0";
}

let savedTheme = "dark";
try {
  savedTheme = localStorage.getItem("wasgeht-theme") === "light" ? "light" : "dark";
} catch (error) {
  console.warn("Das gespeicherte Design konnte nicht geladen werden.", error);
}
applyTheme(savedTheme);
themeToggle.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  try {
    localStorage.setItem("wasgeht-theme", nextTheme);
  } catch (error) {
    console.warn("Die Designauswahl konnte nicht gespeichert werden.", error);
  }
});

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function normalizeImageUrl(value, baseUrl = window.location.href) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), baseUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function berlinDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : berlinDateKeyFormat.format(date);
}

function addDaysToKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Returns the inclusive [from, to] day range (YYYY-MM-DD, Europe/Berlin) for a date filter.
function dateFilterRange(filter, now = new Date()) {
  const todayKey = berlinDateKey(now);
  if (filter === "today") return [todayKey, todayKey];
  if (filter === "week") return [todayKey, addDaysToKey(todayKey, 6)];
  if (filter === "weekend") {
    const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(berlinWeekdayFormat.format(now)) + 1;
    const sundayKey = addDaysToKey(todayKey, 7 - weekday);
    return [weekday >= 5 ? todayKey : addDaysToKey(sundayKey, -2), sundayKey];
  }
  if (filter === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(dateStart.value)) {
    const endKey = /^\d{4}-\d{2}-\d{2}$/.test(dateEnd.value) ? dateEnd.value : dateStart.value;
    return endKey < dateStart.value ? [endKey, dateStart.value] : [dateStart.value, endKey];
  }
  return null;
}

function compareEvents(a, b) {
  const order = (a.sort_order ?? 0) - (b.sort_order ?? 0);
  if (order) return order;
  return String(a.starts_at || "").localeCompare(String(b.starts_at || ""));
}

function renderEvents() {
  const query = search.value.trim().toLocaleLowerCase("de");
  const range = dateFilterRange(dateFilter.value);
  const filtered = events.filter((event) => {
    if ((event.status || "published") !== "published" || event.is_public !== true) return false;
    const matchesGenre = genreFilter.value === "all" || event.genre === genreFilter.value;
    // Multi-day events (e.g. exhibitions) match every day they are running.
    const matchesDate = !range || (event.startKey && event.startKey <= range[1] && (event.endKey || event.startKey) >= range[0]);
    const matchesPlace = placeFilter.value === "all" || event.place === placeFilter.value;
    const matchesQuery = !query || `${event.title} ${event.type} ${event.venue}`.toLocaleLowerCase("de").includes(query);
    return matchesGenre && matchesDate && matchesPlace && matchesQuery;
  }).sort(compareEvents);

  const visible = filtered.slice(0, visibleEventLimit);
  count.textContent = filtered.length > visible.length
    ? `${visible.length} von ${filtered.length} Veranstaltungen`
    : `${filtered.length} ${filtered.length === 1 ? "Veranstaltung" : "Veranstaltungen"}`;
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state"><strong>Hier ist gerade noch Platz.</strong>Probier einen anderen Filter oder such nach etwas anderem.</div>';
    loadMoreEvents.hidden = true;
    return;
  }

  grid.innerHTML = visible.map((event) => {
    const imageUrl = normalizeImageUrl(event.image_url, event.source_url || window.location.href);
    const eventPath = typeof eventPaths[event.id] === "string" && eventPaths[event.id].startsWith("/event/") ? eventPaths[event.id] : "";
    // Cards with a static event page expose a real link (crawlable, keyboard accessible);
    // a plain click still opens the detail dialog.
    const cardAttributes = eventPath ? "" : ` tabindex="0" role="button" aria-label="${escapeHTML(event.title)} öffnen"`;
    const titleHtml = eventPath
      ? `<a class="event-link" href="${escapeHTML(eventPath)}">${escapeHTML(event.title)}</a>`
      : escapeHTML(event.title);
    return `
      <article class="event-card" data-event-id="${escapeHTML(event.id || "")}"${cardAttributes}>
        <div class="event-poster poster-${Math.max(1, Math.min(8, Number(event.poster) || 1))}${imageUrl ? " has-image" : ""}">
          ${imageUrl ? `<img class="event-poster-image" src="${escapeHTML(imageUrl)}" alt="${escapeHTML(event.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}
          <span class="poster-label">${escapeHTML(event.type)}</span>
          <div class="poster-fallback"><div class="poster-type">${String(event.art || event.title).split(/\n|<br\s*\/?>/i).map(escapeHTML).join("<br>")}</div></div>
          <span class="poster-date">${escapeHTML(String(event.date || "").split(" · ")[0])}</span>
        </div>
        <div class="event-info">
          <div class="event-meta"><span class="tag">${escapeHTML(event.type)}</span><time datetime="${escapeHTML(event.starts_at || "")}">${escapeHTML(event.date)}</time></div>
          <h3>${titleHtml}</h3>
          <div class="event-bottom"><span class="event-location">↗ ${escapeHTML(event.venue)}</span><span class="price">${escapeHTML(event.price)}</span></div>
        </div>
      </article>`;
  }).join("");
  loadMoreEvents.hidden = visible.length >= filtered.length;
  grid.querySelectorAll(".poster-type").forEach((posterType) => {
    let fontSize = Number.parseFloat(getComputedStyle(posterType).fontSize);
    while (posterType.scrollWidth > posterType.clientWidth + 1 && fontSize > 14) {
      fontSize -= 1;
      posterType.style.fontSize = `${fontSize}px`;
    }
  });
  grid.querySelectorAll(".event-poster-image").forEach((image) => {
    image.addEventListener("error", () => {
      image.closest(".event-poster").classList.remove("has-image");
      image.remove();
    }, { once: true });
  });
  observeRevealElements(grid);
}

function openEventDetails(event) {
  if (!event) return;
  if (signedInRole === "admin") {
    openEventEditor(adminEventRecords.find((record) => record.id === event.id) || event);
    return;
  }
  currentDetailEventId = event.id || null;
  track("event_open", { event_id: event.id });
  detailTitle.textContent = event.title;
  const imageUrl = normalizeImageUrl(event.image_url, event.source_url || window.location.href);
  detailPoster.hidden = !imageUrl;
  if (imageUrl) {
    detailPoster.src = imageUrl;
    detailPoster.onerror = () => {
      detailPoster.hidden = true;
    };
  }
  detailMeta.innerHTML = [
    event.date,
    event.venue,
    event.price,
    event.type,
  ].filter(Boolean).map((value) => `<span>${escapeHTML(value)}</span>`).join("");
  detailDescription.textContent = event.description || "Keine weitere Beschreibung vorhanden.";
  const sourceUrl = normalizeImageUrl(event.source_url);
  detailSourceLink.hidden = !sourceUrl;
  if (sourceUrl) detailSourceLink.href = sourceUrl;
  detailDialog.showModal();
}

function findEventById(id) {
  return events.find((event) => event.id === id);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

const authDialog = document.getElementById("authDialog");
const authForm = document.getElementById("authForm");
const authMessage = document.getElementById("authMessage");
const adminDialog = document.getElementById("adminDialog");
const adminEventList = document.getElementById("adminEventList");
const suggestionQueueList = document.getElementById("suggestionQueueList");
const adminEventSearch = document.getElementById("adminEventSearch");
const eventDialog = document.getElementById("eventDialog");
const detailDialog = document.getElementById("detailDialog");
const detailTitle = document.getElementById("detailTitle");
const detailPoster = document.getElementById("detailPoster");
const detailMeta = document.getElementById("detailMeta");
const detailDescription = document.getElementById("detailDescription");
const detailSourceLink = document.getElementById("detailSourceLink");
const suggestionDialog = document.getElementById("suggestionDialog");
const suggestionForm = document.getElementById("suggestionForm");
let adminEventRecords = [];
let isRegisterMode = false;

async function openSuggestionDialog() {
  if (!signedInUser && (hasStoredSession() || supabaseClient)) {
    await ensureSupabase().catch(() => null);
  }
  if (!signedInUser) {
    openAuthDialog();
    return;
  }
  suggestionForm.reset();
  document.getElementById("suggestionMessage").textContent = "";
  suggestionDialog.showModal();
}

async function submitSuggestion(event) {
  event.preventDefault();
  const message = document.getElementById("suggestionMessage");
  const submitButton = suggestionForm.querySelector('button[type="submit"]');
  if (!supabaseClient || !signedInUser) {
    message.textContent = "Bitte melde dich zuerst an.";
    return;
  }
  if (document.getElementById("suggestionWebsite").value) return;
  const startsAt = new Date(document.getElementById("suggestionDate").value);
  if (Number.isNaN(startsAt.getTime())) {
    message.textContent = "Bitte gib ein gültiges Datum mit Uhrzeit an.";
    return;
  }
  submitButton.disabled = true;
  const { data: suggestion, error } = await supabaseClient.from("event_suggestions").insert({
    submitted_by: signedInUser.id,
    title: document.getElementById("suggestionTitleInput").value.trim(),
    starts_at: startsAt.toISOString(),
    venue: document.getElementById("suggestionVenue").value.trim(),
    source_url: document.getElementById("suggestionSourceUrl").value.trim(),
    description: document.getElementById("suggestionDescription").value.trim(),
  }).select("id").single();
  submitButton.disabled = false;
  if (error) {
    message.textContent = error.code === "42501"
      ? "Heute wurden bereits zu viele Vorschläge von diesem Account gesendet."
      : `Vorschlag konnte nicht gesendet werden: ${error.message}`;
    return;
  }
  const { error: notificationError } = await supabaseClient.functions.invoke("notify-event-suggestion", {
    body: { suggestionId: suggestion?.id },
  });
  if (notificationError) console.warn("Event suggestion notification failed:", notificationError);
  suggestionDialog.close();
  showToast("Danke! Dein Vorschlag wird geprüft.");
}

function updateAuthMode() {
  document.getElementById("authTitle").textContent = isRegisterMode ? "Dein neuer Account." : "Schön, dass du da bist.";
  document.getElementById("authDescription").textContent = isRegisterMode
    ? "Erstelle deinen kostenlosen wasgeht Account."
    : "Melde dich an oder erstelle deinen kostenlosen Account.";
  document.getElementById("authSubmit").textContent = isRegisterMode ? "Account erstellen" : "Anmelden";
  document.getElementById("authModeToggle").textContent = isRegisterMode
    ? "Schon registriert? Anmelden"
    : "Neu hier? Account erstellen";
  document.getElementById("confirmPasswordField").hidden = !isRegisterMode;
  document.getElementById("authConfirmPassword").required = isRegisterMode;
  document.getElementById("authPassword").autocomplete = isRegisterMode ? "new-password" : "current-password";
  authMessage.textContent = "";
}

function openAuthDialog() {
  isRegisterMode = false;
  updateAuthMode();
  authDialog.showModal();
  // Start loading the auth SDK while the user types.
  ensureSupabase().catch(() => {
    authMessage.textContent = "Die Anmeldung ist gerade nicht erreichbar. Bitte versuche es später erneut.";
  });
}

function formatEventDate(isoDate) {
  if (!isoDate) return "Datum offen";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const isToday = berlinDateKey(date) === berlinDateKey(new Date());
  return `${isToday ? "Heute · " : ""}${berlinCalendarFormat.format(date)} · ${berlinTimeFormat.format(date)}`;
}

// Legacy column kept for the database/app; the website filters by real date ranges.
function getDateGroup(isoDate) {
  if (!isoDate) return "all";
  const eventKey = berlinDateKey(isoDate);
  for (const group of ["today", "weekend", "week"]) {
    const [from, to] = dateFilterRange(group);
    if (eventKey >= from && eventKey <= to) return group;
  }
  return "all";
}

function toLocalDateTimeInput(value) {
  const date = value ? new Date(value) : new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

// Public events are read straight from the REST API with the publishable key, so the
// list does not wait for (or require) the Supabase SDK. Row-level security still applies.
async function loadPublicEvents() {
  const recentCutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();
  const url = new URL(`${SUPABASE_URL}/rest/v1/events`);
  url.searchParams.set("select", PUBLIC_EVENT_COLUMNS);
  url.searchParams.set("is_public", "eq.true");
  url.searchParams.set("status", "eq.published");
  url.searchParams.set("or", `(starts_at.gte.${recentCutoff},end_datetime.gte.${nowIso})`);
  url.searchParams.set("order", "sort_order.asc,starts_at.asc");
  let data;
  try {
    const response = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (error) {
    console.warn("Events could not be loaded:", error);
    if (!events.length && !grid.querySelector(".event-card")) {
      grid.innerHTML = '<div class="empty-state"><strong>Events gerade nicht erreichbar.</strong>Bitte versuche es später erneut.</div>';
      count.textContent = "";
    }
    showToast("Events konnten gerade nicht aktualisiert werden.");
    return;
  }
  events = data.map((record) => ({
    id: record.id,
    title: record.title,
    type: record.type,
    genre: record.genre,
    starts_at: record.starts_at,
    end_datetime: record.end_datetime,
    startKey: berlinDateKey(record.starts_at),
    endKey: record.end_datetime ? berlinDateKey(record.end_datetime) : "",
    date: formatEventDate(record.starts_at),
    place: record.place,
    venue: record.venue,
    price: record.price || "Eintritt frei",
    poster: record.poster,
    art: record.art || record.title,
    description: record.description || "",
    image_url: record.image_url,
    source_url: record.source_url,
    is_public: record.is_public,
    status: record.status || "published",
    sort_order: record.sort_order
  }));
  renderEvents();
}

async function refreshAuthState(session) {
  const nextUser = session?.user ?? null;
  // SIGNED_IN is re-emitted e.g. when a tab regains focus; skip the role lookup then.
  if (nextUser && signedInUser && nextUser.id === signedInUser.id && signedInRole) {
    signedInUser = nextUser;
    return;
  }
  signedInUser = nextUser;
  signedInRole = null;
  document.getElementById("accountButton").hidden = Boolean(signedInUser);
  document.getElementById("logoutButton").hidden = !signedInUser;
  document.getElementById("deleteAccountButton").hidden = !signedInUser;
  document.getElementById("adminButton").hidden = true;
  if (signedInUser && supabaseClient) {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("id", signedInUser.id)
      .maybeSingle();
    if (error) {
      showToast(`Account-Rolle konnte nicht geladen werden: ${error.message}`);
    } else {
      signedInRole = data?.role || "user";
      document.getElementById("adminButton").hidden = signedInRole !== "admin";
      // Never count the operator's own visits: opt this device out permanently.
      if (signedInRole === "admin") window.wasgehtSetTrackingOptOut?.(true);
    }
  }
  if (signedInUser && authDialog.open) authDialog.close();
}

function loadSupabaseSdk() {
  if (window.supabase?.createClient) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SUPABASE_SDK_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Supabase SDK konnte nicht geladen werden."));
    document.head.append(script);
  });
}

// The auth SDK (~200 KB) is only loaded when it is actually needed: an existing
// session, an auth redirect (e-mail confirmation) or a click on a login feature.
function ensureSupabase() {
  if (!supabaseReady) {
    supabaseReady = (async () => {
      await loadSupabaseSdk();
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      supabaseClient.auth.onAuthStateChange((authEvent, session) => {
        if (authEvent === "INITIAL_SESSION" || authEvent === "TOKEN_REFRESHED") return;
        // Defer: Supabase recommends not awaiting other client calls inside this callback.
        setTimeout(() => void refreshAuthState(session), 0);
      });
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) showToast(`Anmeldestatus konnte nicht geladen werden: ${error.message}`);
      await refreshAuthState(data?.session ?? null);
      return supabaseClient;
    })().catch((error) => {
      supabaseReady = null;
      supabaseClient = null;
      showToast(error.message || "Die Anmeldung ist gerade nicht verfügbar.");
      throw error;
    });
  }
  return supabaseReady;
}

function hasStoredSession() {
  try {
    return Boolean(localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY));
  } catch {
    return false;
  }
}

function hasAuthRedirect() {
  return /(?:^|[#&?])(?:access_token|refresh_token|code|token_hash|error_description)=/.test(`${window.location.hash}&${window.location.search}`);
}

async function deleteOwnAccount() {
  if (!supabaseClient || !signedInUser) return;
  const confirmed = window.confirm("Deinen Account und alle damit verbundenen Daten (Profil, Event-Vorschläge) endgültig löschen? Das kann nicht rückgängig gemacht werden.");
  if (!confirmed) return;
  const { error } = await supabaseClient.rpc("delete_own_account");
  if (error) {
    showToast(`Account konnte nicht gelöscht werden: ${error.message}`);
    return;
  }
  await supabaseClient.auth.signOut({ scope: "local" }).catch(() => {});
  await refreshAuthState(null);
  showToast("Dein Account wurde gelöscht.");
}

function renderAdminEvents(records) {
  adminEventRecords = records;
  const query = adminEventSearch.value.trim().toLocaleLowerCase("de");
  const visibleRecords = records.filter((record) =>
    !query || [
      record.title,
      record.type,
      record.genre,
      record.venue,
      record.city,
      record.source_name,
      record.source_url,
    ].filter(Boolean).join(" ").toLocaleLowerCase("de").includes(query)
  );
  if (!visibleRecords.length) {
    adminEventList.innerHTML = '<p class="dialog-message">Noch keine Events vorhanden. Lege das erste Event an.</p>';
    return;
  }
  adminEventList.innerHTML = visibleRecords.map((record) => `
    <article class="admin-event-row">
      <div class="admin-event-name">
        <strong>${escapeHTML(record.title)}</strong>
        <span>${(record.sort_order ?? 0) < 0 ? "📌 Angepinnt · " : ""}${record.is_public ? "Öffentlich" : "Privat"} · ${escapeHTML(record.venue)} · ${escapeHTML(formatEventDate(record.starts_at))}</span>
        ${renderEventSource(record)}
      </div>
      <div class="admin-event-actions">
        <button type="button" data-admin-action="toggle-pin" data-event-id="${escapeHTML(record.id)}" aria-pressed="${(record.sort_order ?? 0) < 0}" title="Angepinnte Events stehen ganz oben, der Rest ist chronologisch">${(record.sort_order ?? 0) < 0 ? "Lösen" : "Anpinnen"}</button>
        <button type="button" data-admin-action="toggle-public" data-event-id="${escapeHTML(record.id)}">${record.is_public ? "Verbergen" : "Veröffentlichen"}</button>
        <button type="button" data-admin-action="edit" data-event-id="${escapeHTML(record.id)}">Bearbeiten</button>
        <button class="delete-event" type="button" data-admin-action="delete" data-event-id="${escapeHTML(record.id)}">Löschen</button>
      </div>
    </article>`).join("");
}

function renderEventSource(record) {
  const sourceUrl = normalizeImageUrl(record.source_url);
  let sourceName = String(record.source_name || "").trim();
  if (!sourceName && sourceUrl) sourceName = new URL(sourceUrl).hostname;
  if (!sourceName) return "";
  return sourceUrl
    ? `<a class="admin-source-link" href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer">Quelle: ${escapeHTML(sourceName)} ↗</a>`
    : `<span>Quelle: ${escapeHTML(sourceName)}</span>`;
}

async function loadAdminEvents() {
  if (!supabaseClient || signedInRole !== "admin") {
    showToast("Der Admin-Bereich ist nur für berechtigte Accounts verfügbar.");
    return;
  }
  const { data, error } = await supabaseClient
    .from("events")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("starts_at", { ascending: true, nullsFirst: false });
  if (error) {
    showToast(`Admin-Events konnten nicht geladen werden: ${error.message}`);
    return;
  }
  renderAdminEvents(data);
  await loadReviewQueue();
  await loadSuggestionQueue();
  void loadAnalytics();
}

const statsLabels = {
  genre: { label: "Genre", values: { party: "Party & Rave", live: "Live & Kultur", szene: "Szene & Nerd", chill: "Ruhiger" } },
  date: { label: "Wann", values: { today: "Heute", weekend: "Wochenende", week: "Diese Woche", custom: "Bestimmtes Datum" } },
  place: { label: "Wo", values: { city: "Erfurt", nearby: "Umgebung" } },
  custom_date: { label: "Zeitraum", values: {} },
};

function statsList(title, rows, renderRow) {
  const items = rows.length
    ? rows.map((row) => `<li style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid var(--line);font-size:12px">${renderRow(row)}</li>`).join("")
    : '<li style="font-size:12px;color:var(--muted)">Noch keine Daten.</li>';
  return `<div><strong style="display:block;margin:14px 0 4px;font-size:12px">${escapeHTML(title)}</strong><ol style="margin:0;padding:0;list-style:none">${items}</ol></div>`;
}

async function loadAnalytics() {
  const container = document.getElementById("statsContent");
  document.getElementById("trackingOptOut").checked = window.wasgehtTrackingOptedOut?.() ?? false;
  if (!supabaseClient || signedInRole !== "admin") return;
  container.textContent = "Statistik wird geladen …";
  const { data, error } = await supabaseClient.rpc("analytics_summary", { p_days: Number(document.getElementById("statsRange").value) || 30 });
  if (error) {
    container.textContent = `Statistik konnte nicht geladen werden: ${error.message}`;
    return;
  }
  const minutes = Math.floor((data.avg_seconds || 0) / 60);
  const seconds = (data.avg_seconds || 0) % 60;
  const kpi = (value, label) => `<div style="padding:12px;border-radius:14px;background:var(--dialog-field-glass)"><strong style="display:block;font-size:22px">${escapeHTML(value)}</strong><span style="font-size:11px;color:var(--muted)">${escapeHTML(label)}</span></div>`;
  const maxDaily = Math.max(1, ...data.daily.map((day) => day.visitors));
  const daily = data.daily.length
    ? `<div style="display:flex;align-items:flex-end;gap:3px;height:70px;margin-top:14px" aria-label="Besucher pro Tag">${data.daily.map((day) =>
      `<span title="${escapeHTML(day.day)}: ${day.visitors} Besucher, ${day.pageviews} Aufrufe" style="flex:1;min-width:3px;height:${Math.max(4, Math.round((day.visitors / maxDaily) * 100))}%;border-radius:4px 4px 0 0;background:var(--blue)"></span>`).join("")}</div>`
    : "";
  const filterLabel = (row) => {
    const meta = statsLabels[row.name] || { label: row.name, values: {} };
    return `${escapeHTML(meta.label)}: ${escapeHTML(meta.values[row.value] || row.value)}`;
  };
  const devices = Object.entries(data.devices || {}).map(([device, views]) => ({ device, views })).sort((a, b) => b.views - a.views);
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px">
      ${kpi(data.visitors, "Besucher (pro Tag gezählt)")}
      ${kpi(data.pageviews, "Seitenaufrufe")}
      ${kpi(`${minutes}:${String(seconds).padStart(2, "0")} min`, "Ø Verweildauer")}
      ${kpi(data.source_clicks, "Klicks zur Originalquelle")}
    </div>
    ${daily}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px 18px">
      ${statsList("Beliebteste Events", data.top_events, (row) => `<span>${escapeHTML(row.title)}</span><span title="${row.opens} Detail-Öffnungen, ${row.page_views} Eventseiten-Aufrufe">${row.total}</span>`)}
      ${statsList("Meistgenutzte Filter", data.top_filters, (row) => `<span>${filterLabel(row)}</span><span>${row.uses}</span>`)}
      ${statsList("Suchbegriffe", data.top_searches, (row) => `<span>${escapeHTML(row.term)}</span><span>${row.uses}</span>`)}
      ${statsList("Herkunft (Verweise)", data.top_referrers, (row) => `<span>${escapeHTML(row.host)}</span><span>${row.visits}</span>`)}
      ${statsList("Meistbesuchte Seiten", data.top_pages, (row) => `<span>${escapeHTML(row.path)}</span><span>${row.views}</span>`)}
      ${statsList("Geräte", devices, (row) => `<span>${escapeHTML({ mobile: "Smartphone", tablet: "Tablet", desktop: "Computer" }[row.device] || row.device)}</span><span>${row.views}</span>`)}
    </div>`;
}

async function loadSuggestionQueue() {
  const { data, error } = await supabaseClient
    .from("event_suggestions")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) {
    suggestionQueueList.innerHTML = `<p class="dialog-message">Vorschläge konnten nicht geladen werden: ${escapeHTML(error.message)}</p>`;
    return;
  }
  if (!data?.length) {
    suggestionQueueList.innerHTML = '<p class="dialog-message">Keine neuen Vorschläge.</p>';
    return;
  }
  suggestionQueueList.innerHTML = data.map((record) => `
    <article class="admin-event-row">
      <div class="admin-event-name">
        <strong>${escapeHTML(record.title)}</strong>
        <span>${escapeHTML(formatEventDate(record.starts_at))} · ${escapeHTML(record.venue)}</span>
        <a class="admin-source-link" href="${escapeHTML(record.source_url)}" target="_blank" rel="noopener noreferrer">Originalquelle ↗</a>
      </div>
      <div class="admin-event-actions">
        <button type="button" data-suggestion-action="edit" data-suggestion-id="${escapeHTML(record.id)}">Übernehmen</button>
        <button class="delete-event" type="button" data-suggestion-action="reject" data-suggestion-id="${escapeHTML(record.id)}">Verwerfen</button>
      </div>
    </article>`).join("");
}

async function handleSuggestionAction(action, suggestionId) {
  const { data, error } = await supabaseClient
    .from("event_suggestions")
    .select("*")
    .eq("id", suggestionId)
    .maybeSingle();
  if (error || !data) {
    showToast("Vorschlag konnte nicht geladen werden.");
    return;
  }
  if (action === "reject") {
    const { error: rejectError } = await supabaseClient
      .from("event_suggestions")
      .update({ status: "rejected" })
      .eq("id", suggestionId);
    if (rejectError) {
      showToast(`Vorschlag konnte nicht verworfen werden: ${rejectError.message}`);
      return;
    }
  } else {
    openEventEditor({
      title: data.title,
      starts_at: data.starts_at,
      venue: data.venue,
      source_url: data.source_url,
      description: data.description,
      status: "needs_review",
    });
    return;
  }
  await loadSuggestionQueue();
}

function renderReviewQueue(records) {
  if (!records.length) {
    reviewQueueList.innerHTML = '<p class="dialog-message">Keine Events warten auf Freigabe.</p>';
    return;
  }

  reviewQueueList.innerHTML = records.map((record) => `
    <article class="admin-event-row">
      <div class="admin-event-name">
        <strong>${escapeHTML(record.title)}</strong>
        <span>${escapeHTML(record.source_type || "manual")} · ${escapeHTML(record.city || "Erfurt")} · ${escapeHTML(formatEventDate(record.start_datetime || record.starts_at))}</span>
        ${renderEventSource(record)}
      </div>
      <div class="admin-event-actions">
        <button type="button" data-review-action="approve" data-event-id="${escapeHTML(record.id)}">Freigeben</button>
        <button type="button" data-review-action="edit" data-event-id="${escapeHTML(record.id)}">Bearbeiten</button>
        <button class="delete-event" type="button" data-review-action="reject" data-event-id="${escapeHTML(record.id)}">Verwerfen</button>
      </div>
    </article>`).join("");
}

async function loadReviewQueue() {
  if (!supabaseClient || signedInRole !== "admin") {
    reviewQueueList.innerHTML = '<p class="dialog-message">Admin-Rechte nötig.</p>';
    return;
  }

  const { data, error } = await supabaseClient
    .from("events")
    .select("*")
    .eq("status", "needs_review")
    .order("created_at", { ascending: false });
  if (error) {
    reviewQueueList.innerHTML = `<p class="dialog-message">Zur-Prüfung-Liste konnte nicht geladen werden: ${escapeHTML(error.message)}</p>`;
    return;
  }
  renderReviewQueue(data || []);
}

async function handleReviewAction(action, eventId) {
  if (!supabaseClient || signedInRole !== "admin") return;
  const { data, error } = await supabaseClient.from("events").select("*").eq("id", eventId).maybeSingle();
  if (error || !data) {
    showToast("Event für die Prüfung konnte nicht geladen werden.");
    return;
  }

  if (action === "approve" && !(data.starts_at || data.start_datetime)) {
    // Never publish an event without a date; let the admin add it first.
    showToast("Dieses Event hat noch kein Datum – bitte im Editor ergänzen.");
    openEventEditor(data);
    return;
  }

  if (action === "approve") {
    const { error: updateError } = await supabaseClient
      .from("events")
      .update({ status: "published", is_public: true, updated_at: new Date().toISOString() })
      .eq("id", eventId);
    if (updateError) {
      showToast(`Freigabe fehlgeschlagen: ${updateError.message}`);
      return;
    }
  }

  if (action === "reject") {
    const { error: rejectError } = await supabaseClient.from("events").delete().eq("id", eventId);
    if (rejectError) {
      showToast(`Event konnte nicht verworfen werden: ${rejectError.message}`);
      return;
    }
  }

  if (action === "edit") {
    openEventEditor(data);
    return;
  }

  await loadPublicEvents();
  await loadAdminEvents();
  showToast(action === "approve" ? "Event wurde freigegeben." : "Event wurde verworfen.");
}

function openEventEditor(record = null) {
  document.getElementById("eventForm").reset();
  document.getElementById("eventDialogTitle").textContent = record ? "Event bearbeiten" : "Event erstellen";
  document.getElementById("eventId").value = record?.id || "";
  document.getElementById("eventTitle").value = record?.title || "";
  document.getElementById("eventType").value = record?.type || "";
  document.getElementById("eventGenre").value = record?.genre || "party";
  const eventDate = record?.starts_at || record?.start_datetime;
  document.getElementById("eventDate").value = record && !eventDate ? "" : toLocalDateTimeInput(eventDate);
  document.getElementById("eventPlace").value = record?.place || "city";
  document.getElementById("eventVenue").value = record?.venue || "";
  document.getElementById("eventPrice").value = record?.price || "";
  document.getElementById("eventPoster").value = String(record?.poster || 1);
  document.getElementById("eventImageUrl").value = record?.image_url || "";
  document.getElementById("eventSourceUrl").value = record?.source_url || "";
  document.getElementById("eventArt").value = (record?.art || "").replace(/<br\s*\/?>/gi, "\n");
  document.getElementById("eventDescription").value = record?.description || "";
  document.getElementById("eventIsPublic").checked = record?.is_public ?? true;
  document.getElementById("eventMessage").textContent = "";
  eventDialog.showModal();
}

async function saveEvent(event) {
  event.preventDefault();
  if (!supabaseClient || signedInRole !== "admin") {
    showToast("Zum Speichern benötigst du Admin-Rechte.");
    return;
  }
  const eventId = document.getElementById("eventId").value;
  const startsAt = new Date(document.getElementById("eventDate").value);
  if (Number.isNaN(startsAt.getTime())) {
    document.getElementById("eventMessage").textContent = "Bitte gib ein gültiges Datum mit Uhrzeit an.";
    return;
  }
  const imageUrlInput = document.getElementById("eventImageUrl").value.trim();
  const imageUrl = normalizeImageUrl(imageUrlInput);
  if (imageUrlInput && !imageUrl) {
    document.getElementById("eventMessage").textContent = "Bitte gib eine gültige Bild-URL mit http oder https ein.";
    return;
  }
  const payload = {
    title: document.getElementById("eventTitle").value.trim(),
    type: document.getElementById("eventType").value.trim(),
    genre: document.getElementById("eventGenre").value,
    starts_at: startsAt.toISOString(),
    place: document.getElementById("eventPlace").value,
    venue: document.getElementById("eventVenue").value.trim(),
    price: document.getElementById("eventPrice").value.trim() || "Eintritt frei",
    poster: Number(document.getElementById("eventPoster").value),
    image_url: imageUrl,
    source_url: document.getElementById("eventSourceUrl").value.trim() || null,
    art: document.getElementById("eventArt").value.trim(),
    description: document.getElementById("eventDescription").value.trim(),
    is_public: document.getElementById("eventIsPublic").checked,
    date_group: getDateGroup(startsAt.toISOString()),
    // Keep the import/archive column in sync, otherwise a stale start_datetime
    // could archive an edited event too early.
    start_datetime: startsAt.toISOString(),
    // Saving in the editor counts as an admin review; without this, edited
    // "needs_review" events stayed invisible even when marked public.
    status: "published",
    updated_at: new Date().toISOString()
  };
  let request;
  if (eventId) {
    request = supabaseClient.from("events").update(payload).eq("id", eventId);
  } else {
    // sort_order 0 = chronological like imported events; ↑/↓ can still pin it.
    request = supabaseClient.from("events").insert({ ...payload, sort_order: 0 });
  }
  const { error } = await request;
  if (error) {
    document.getElementById("eventMessage").textContent = `Speichern fehlgeschlagen: ${error.message}`;
    return;
  }
  eventDialog.close();
  await loadPublicEvents();
  await loadAdminEvents();
  showToast(eventId ? "Event wurde gespeichert." : "Event wurde erstellt.");
}

async function handleAdminEventAction(action, eventId, button) {
  if (!supabaseClient || signedInRole !== "admin") return;
  const { data: records, error: loadError } = await supabaseClient
    .from("events")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("starts_at", { ascending: true, nullsFirst: false });
  if (loadError) {
    showToast(`Events konnten nicht geladen werden: ${loadError.message}`);
    return;
  }
  const index = records.findIndex((record) => record.id === eventId);
  const record = records[index];
  if (!record) {
    showToast("Dieses Event wurde nicht gefunden.");
    await loadAdminEvents();
    return;
  }
  if (action === "edit") {
    openEventEditor(record);
    return;
  }
  if (action === "toggle-pin") {
    // sort_order < 0 = pinned to the top; 0 = chronological (default for all events).
    const { error } = await supabaseClient.from("events").update({ sort_order: (record.sort_order ?? 0) < 0 ? 0 : -1 }).eq("id", eventId);
    if (error) {
      showToast(`Anpinnen fehlgeschlagen: ${error.message}`);
      return;
    }
    await loadPublicEvents();
    await loadAdminEvents();
    return;
  }
  if (action === "toggle-public") {
    const { error } = await supabaseClient.from("events").update({ is_public: !record.is_public }).eq("id", eventId);
    if (error) {
      showToast(`Sichtbarkeit konnte nicht geändert werden: ${error.message}`);
      return;
    }
    await loadPublicEvents();
    await loadAdminEvents();
    return;
  }
  if (action === "delete" && window.confirm(`„${record.title}“ wirklich löschen?`)) {
    button.disabled = true;
    const { error } = await supabaseClient.from("events").delete().eq("id", eventId);
    if (error) {
      button.disabled = false;
      showToast(`Event konnte nicht gelöscht werden: ${error.message}`);
      return;
    }
    await loadPublicEvents();
    await loadAdminEvents();
    showToast("Event wurde gelöscht.");
  }
}

async function runImport(isAutomaticContinuation = false) {
  if (!supabaseClient || signedInRole !== "admin") {
    showToast("Der KI-Import ist nur für Admins verfügbar.");
    return;
  }

  if (!isAutomaticContinuation) {
    pauseImportAfterBatch = false;
    importRetriesWithoutProgress = 0;
  }
  runImportButton.disabled = true;
  resetImportProgressButton.disabled = true;
  runImportButton.textContent = "Import läuft…";
  pauseImportButton.hidden = false;
  pauseImportButton.disabled = false;
  pauseImportButton.textContent = "Nach diesem Teil pausieren";
  importSummary.textContent = "KI-Import läuft…";
  const dryRun = !!dryRunToggle.checked;
  const batchStorageKey = `wasgeht-import-offset-${dryRun ? "dry-run" : "live"}`;
  let batchOffset = 0;
  try {
    batchOffset = Number(localStorage.getItem(batchStorageKey)) || 0;
  } catch (error) {
    console.warn("Could not read the event import batch position:", error);
  }

  try {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
      importSummary.textContent = "Import fehlgeschlagen: Keine gültige Session für den Admin-Import.";
      showToast("Import fehlgeschlagen: Keine gültige Session.");
      return;
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/run-event-import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        city: "Erfurt",
        dryRun,
        maxEvents: 8,
        batchOffset
      })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = result?.error || `HTTP ${response.status}`;
      importSummary.textContent = `Import fehlgeschlagen: ${message}`;
      showToast(`Import fehlgeschlagen: ${message}`);
      return;
    }

    const errorCount = Array.isArray(result.errors) ? result.errors.length : 0;
    const errorDetails = (result.errors || [])
      .map((item) => `${item.source || "Import"}: ${item.message}`)
      .join(" · ");
    const warningDetails = (result.warnings || []).join(" · ");
    const nextOffset = Number(result.next_batch_offset) || 0;
    const totalCandidates = Number(result.total_candidates) || 0;
    if (nextOffset > batchOffset) importRetriesWithoutProgress = 0;
    else if (result.has_more) importRetriesWithoutProgress += 1;
    const batchSummary = totalCandidates
      ? ` Batch ${Math.min(batchOffset + 1, totalCandidates)}–${nextOffset} von ${totalCandidates}${nextOffset === batchOffset && result.has_more ? " · wegen API-Limit später erneut versuchen" : result.has_more ? " · nächster Teil bereit" : " · vollständig"}.`
      : "";
    try {
      if (result.has_more) localStorage.setItem(batchStorageKey, String(nextOffset));
      else localStorage.removeItem(batchStorageKey);
    } catch (error) {
      console.warn("Could not save the event import batch position:", error);
    }
    const stoppedAtRateLimit = result.has_more && nextOffset === batchOffset && importRetriesWithoutProgress >= 3;
    importSummary.textContent = `Ergebnis: ${result.new ?? 0} neu, ${result.updated ?? 0} aktualisiert, ${result.unchanged ?? 0} unverändert, ${result.archived ?? 0} archiviert, ${result.needs_review ?? 0} zur Prüfung, ${errorCount} Quellen-/Verarbeitungsfehler.${batchSummary}${result.has_more && !stoppedAtRateLimit ? " Der nächste Teil startet automatisch; Tab geöffnet lassen." : stoppedAtRateLimit ? " Wegen wiederholtem API-Limit pausiert; später erneut starten." : ""}${warningDetails ? ` Hinweis: ${warningDetails}` : ""}${errorDetails ? ` ${errorDetails}` : ""}`;
    showToast(`Import abgeschlossen: ${result.new ?? 0} neu, ${result.updated ?? 0} aktualisiert.`);
    await loadPublicEvents();
    await loadAdminEvents();
    continueImportAutomatically = result.has_more === true
      && !pauseImportAfterBatch
      && importRetriesWithoutProgress < 3;
  } catch (exception) {
    importSummary.textContent = `Import fehlgeschlagen: ${exception.message}`;
    showToast(`Import fehlgeschlagen: ${exception.message}`);
  } finally {
    if (continueImportAutomatically) {
      continueImportAutomatically = false;
      runImportButton.disabled = true;
      void (async () => {
        for (let seconds = 60; seconds > 0; seconds -= 1) {
          if (pauseImportAfterBatch) break;
          runImportButton.textContent = `Weiter in ${seconds}s …`;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (pauseImportAfterBatch) {
          importSummary.textContent += " Import pausiert. Erneut starten setzt beim nächsten Teil fort.";
          runImportButton.disabled = false;
          resetImportProgressButton.disabled = false;
          runImportButton.textContent = "KI-Import starten";
          pauseImportButton.hidden = true;
          return;
        }
        void runImport(true);
      })();
    } else {
      runImportButton.disabled = false;
      resetImportProgressButton.disabled = false;
      runImportButton.textContent = "KI-Import starten";
      pauseImportButton.hidden = true;
    }
  }
}

document.getElementById("accountButton").addEventListener("click", openAuthDialog);
menuButton.addEventListener("click", () => {
  const isOpen = mainNav.classList.toggle("menu-open");
  menuButton.setAttribute("aria-expanded", String(isOpen));
  menuButton.setAttribute("aria-label", isOpen ? "Menü schließen" : "Menü öffnen");
});
mainNavigation.addEventListener("click", (event) => {
  if (!event.target.closest("a")) return;
  mainNav.classList.remove("menu-open");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Menü öffnen");
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !mainNav.classList.contains("menu-open")) return;
  mainNav.classList.remove("menu-open");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Menü öffnen");
});
document.getElementById("authModeToggle").addEventListener("click", () => {
  isRegisterMode = !isRegisterMode;
  authForm.reset();
  updateAuthMode();
});
document.getElementById("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await ensureSupabase();
  } catch {
    authMessage.textContent = "Die Anmeldung ist gerade nicht erreichbar. Bitte versuche es später erneut.";
    return;
  }
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  let result;
  if (isRegisterMode) {
    if (password !== document.getElementById("authConfirmPassword").value) {
      authMessage.textContent = "Die Passwörter stimmen nicht überein.";
      return;
    }
    result = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: new URL(window.location.pathname, window.location.origin).toString()
      }
    });
  } else {
    result = await supabaseClient.auth.signInWithPassword({ email, password });
  }
  if (result.error) {
    authMessage.textContent = `Anmeldung fehlgeschlagen: ${result.error.message}`;
    return;
  }
  if (isRegisterMode && !result.data.session) {
    authMessage.textContent = "Fast geschafft — bestätige deine E-Mail-Adresse über den zugesandten Link.";
  } else {
    authMessage.textContent = isRegisterMode ? "Dein Account wurde erstellt." : "Du bist angemeldet.";
    if (result.data.session) await refreshAuthState(result.data.session);
  }
});
document.getElementById("logoutButton").addEventListener("click", async () => {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    showToast(`Abmelden fehlgeschlagen: ${error.message}`);
    return;
  }
  showToast("Du wurdest abgemeldet.");
});
document.getElementById("adminButton").addEventListener("click", async () => {
  await loadAdminEvents();
  if (signedInRole === "admin") adminDialog.showModal();
});
document.getElementById("createEventButton").addEventListener("click", () => openEventEditor());
adminEventSearch.addEventListener("input", () => renderAdminEvents(adminEventRecords));
grid.addEventListener("click", (event) => {
  const eventLink = event.target.closest("a.event-link");
  // Modifier/middle clicks open the static event page as a normal link.
  if (eventLink && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
  if (!eventLink && event.target.closest("a, button")) return;
  const card = event.target.closest("[data-event-id]");
  const record = card && findEventById(card.dataset.eventId);
  // Prerendered cards are clickable before the live data arrives: then just follow the link.
  if (!record) return;
  event.preventDefault();
  openEventDetails(record);
});
grid.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (event.target.closest("a")) return;
  const card = event.target.closest("[data-event-id]");
  if (!card) return;
  event.preventDefault();
  openEventDetails(findEventById(card.dataset.eventId));
});
runImportButton.addEventListener("click", () => void runImport());
resetImportProgressButton.addEventListener("click", () => {
  if (runImportButton.disabled) {
    showToast("Bitte den Import zuerst pausieren und den laufenden Batch beenden lassen.");
    return;
  }
  if (!confirm("Den gespeicherten Fortschritt für Testlauf und echten Import zurücksetzen? Der nächste Lauf beginnt wieder bei Event 1.")) {
    return;
  }
  try {
    localStorage.removeItem("wasgeht-import-offset-live");
    localStorage.removeItem("wasgeht-import-offset-dry-run");
    importRetriesWithoutProgress = 0;
    importSummary.textContent = "Importfortschritt zurückgesetzt. Testlauf und echter Import beginnen beim nächsten Start wieder am Anfang.";
    showToast("Importfortschritt wurde zurückgesetzt.");
  } catch (error) {
    importSummary.textContent = `Importfortschritt konnte nicht zurückgesetzt werden: ${error.message}`;
    showToast(`Importfortschritt konnte nicht zurückgesetzt werden: ${error.message}`);
  }
});
pauseImportButton.addEventListener("click", () => {
  pauseImportAfterBatch = true;
  pauseImportButton.disabled = true;
  pauseImportButton.textContent = "Pausieren …";
});
adminEventList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-admin-action]");
  if (button) void handleAdminEventAction(button.dataset.adminAction, button.dataset.eventId, button);
});
reviewQueueList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-review-action]");
  if (button) void handleReviewAction(button.dataset.reviewAction, button.dataset.eventId);
});
suggestionQueueList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-suggestion-action]");
  if (button) void handleSuggestionAction(button.dataset.suggestionAction, button.dataset.suggestionId);
});
document.getElementById("eventForm").addEventListener("submit", saveEvent);
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});
[authDialog, adminDialog, eventDialog, suggestionDialog, detailDialog].forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

dateFilter.addEventListener("change", () => {
  if (dateFilter.value !== "all") track("filter", { filter_name: "date", filter_value: dateFilter.value });
  dateRange.hidden = dateFilter.value !== "custom";
  if (dateFilter.value !== "custom") {
    dateStart.value = "";
    dateEnd.value = "";
  }
  visibleEventLimit = eventsPerPage;
  renderEvents();
});
[genreFilter, placeFilter].forEach((control) => control.addEventListener("change", () => {
  if (control.value !== "all") track("filter", { filter_name: control === genreFilter ? "genre" : "place", filter_value: control.value });
  visibleEventLimit = eventsPerPage;
  renderEvents();
}));
[dateStart, dateEnd].forEach((control) => control.addEventListener("change", () => {
  if (dateStart.value) track("filter", { filter_name: "custom_date", filter_value: `${dateStart.value}–${dateEnd.value || dateStart.value}` });
  visibleEventLimit = eventsPerPage;
  renderEvents();
}));
let searchTimer;
let searchTrackTimer;
search.addEventListener("input", () => {
  window.clearTimeout(searchTrackTimer);
  // Count a search term only once the user has stopped typing.
  searchTrackTimer = window.setTimeout(() => {
    const term = search.value.trim();
    if (term.length >= 3) track("search", { filter_value: term.slice(0, 60) });
  }, 1500);
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    visibleEventLimit = eventsPerPage;
    renderEvents();
  }, 120);
});
loadMoreButton.addEventListener("click", () => {
  track("load_more");
  visibleEventLimit += eventsPerPage;
  renderEvents();
});
document.getElementById("searchButton").addEventListener("click", () => {
  renderEvents();
  grid.scrollIntoView({ behavior: "smooth", block: "start" });
});
document.getElementById("surpriseButton").addEventListener("click", () => {
  const visibleEvents = [...grid.querySelectorAll(".event-card")];
  if (!visibleEvents.length) {
    showToast("Mit diesen Filtern ist gerade nichts dabei — probier's nochmal!");
    return;
  }
  const chosen = visibleEvents[Math.floor(Math.random() * visibleEvents.length)];
  track("surprise", { event_id: chosen.dataset.eventId || null });
  chosen.scrollIntoView({ behavior: "smooth", block: "center" });
  chosen.animate([{ transform: "scale(1)" }, { transform: "scale(1.035)" }, { transform: "scale(1)" }], { duration: 550 });
  showToast(`Dein Zufallstipp: ${chosen.querySelector("h3").textContent}`);
});
document.getElementById("addEventButton").addEventListener("click", () => void openSuggestionDialog());
document.getElementById("deleteAccountButton").addEventListener("click", () => void deleteOwnAccount());
detailSourceLink.addEventListener("click", () => track("source_click", { event_id: currentDetailEventId }));
document.getElementById("statsRange").addEventListener("change", () => void loadAnalytics());
document.getElementById("trackingOptOut").addEventListener("change", (event) => {
  window.wasgehtSetTrackingOptOut?.(event.target.checked);
  showToast(event.target.checked ? "Dieses Gerät wird nicht mitgezählt." : "Dieses Gerät wird wieder mitgezählt.");
});
suggestionForm.addEventListener("submit", submitSuggestion);
observeRevealElements();
void loadPublicEvents();
if (hasStoredSession() || hasAuthRedirect()) void ensureSupabase().catch(() => {});
