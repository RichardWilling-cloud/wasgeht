// Cookieless first-party analytics for wasgeht-ab.de (see /datenschutz/).
// Nothing is stored on the visitor's device. Admin devices opt out automatically
// (localStorage flag "wasgeht-no-track", set after an admin login).
(() => {
  "use strict";
  const ENDPOINT = "https://zvhvofgpizwhtxmcnghm.supabase.co/functions/v1/track";
  const isLiveSite = location.hostname === "wasgeht-ab.de" || location.hostname === "www.wasgeht-ab.de";

  const readOptOut = () => {
    try {
      return localStorage.getItem("wasgeht-no-track") === "1";
    } catch {
      return false;
    }
  };
  let disabled = !isLiveSite || readOptOut() || navigator.webdriver === true || navigator.globalPrivacyControl === true;

  const viewId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
  const device = matchMedia("(max-width: 640px)").matches ? "mobile" : matchMedia("(max-width: 1024px)").matches ? "tablet" : "desktop";

  function send(type, data = {}) {
    if (disabled) return;
    const body = JSON.stringify({ type, view_id: viewId, path: location.pathname, device, ...data });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }))) return;
    } catch {
      // fall through to fetch
    }
    fetch(ENDPOINT, { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(() => {});
  }

  // Visible time on the page, reported when the tab is hidden or closed.
  let visibleSince = document.visibilityState === "visible" ? performance.now() : null;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && visibleSince !== null) {
      const seconds = Math.round((performance.now() - visibleSince) / 1000);
      visibleSince = null;
      if (seconds > 0) send("leave", { seconds: Math.min(seconds, 7200) });
    } else if (document.visibilityState === "visible" && visibleSince === null) {
      visibleSince = performance.now();
    }
  });

  let referrerHost = null;
  try {
    const referrer = new URL(document.referrer);
    if (referrer.hostname !== location.hostname) referrerHost = referrer.hostname;
  } catch {
    // no or invalid referrer
  }
  const eventId = document.querySelector('meta[name="wasgeht-event-id"]')?.content || null;
  send("pageview", { referrer_host: referrerHost, event_id: eventId });

  window.wasgehtTrack = send;
  window.wasgehtSetTrackingOptOut = (optOut) => {
    try {
      if (optOut) localStorage.setItem("wasgeht-no-track", "1");
      else localStorage.removeItem("wasgeht-no-track");
    } catch {
      // storage blocked: opt-out only for this page view
    }
    disabled = optOut || !isLiveSite;
  };
  window.wasgehtTrackingOptedOut = readOptOut;
})();
