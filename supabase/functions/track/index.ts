// Cookieless first-party analytics endpoint for wasgeht-ab.de.
// Receives small beacons from /analytics.js and stores them via public.track_event().
// The visitor IP is only used (together with a daily rotating salt) to build an
// anonymous per-day hash inside the database; it is never stored.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const allowedOrigins = new Set(["https://wasgeht-ab.de", "https://www.wasgeht-ab.de"]);
const allowedTypes = new Set(["pageview", "leave", "event_open", "source_click", "filter", "search", "surprise", "load_more"]);
const allowedFilters = new Set(["genre", "date", "place", "custom_date"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const botPattern = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|monitor|curl|wget|python|axios|node-fetch/i;
const client = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } }) : null;

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://wasgeht-ab.de",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    Vary: "Origin",
  };
  const done = (status = 204) => new Response(null, { status, headers });

  if (request.method === "OPTIONS") return done();
  if (request.method !== "POST") return done(405);
  if (!client) return done(503);
  // Only beacons sent by the website itself are counted.
  if (!allowedOrigins.has(origin)) return done(403);
  const userAgent = request.headers.get("user-agent") || "";
  if (!userAgent || botPattern.test(userAgent)) return done();

  const raw = await request.text();
  if (raw.length > 2000) return done(413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return done(400);
  }

  const type = String(body.type || "");
  const viewId = String(body.view_id || "");
  if (!allowedTypes.has(type) || !uuidPattern.test(viewId)) return done(400);
  const path = text(body.path, 200);
  const eventId = typeof body.event_id === "string" && uuidPattern.test(body.event_id) ? body.event_id : null;
  const filterName = typeof body.filter_name === "string" && allowedFilters.has(body.filter_name) ? body.filter_name : null;
  const referrerHost = typeof body.referrer_host === "string" && /^[a-z0-9.-]{1,120}$/i.test(body.referrer_host)
    ? body.referrer_host.toLowerCase().replace(/^www\./, "")
    : null;
  const device = ["mobile", "tablet", "desktop"].includes(String(body.device)) ? String(body.device) : null;
  const seconds = Number.isInteger(body.seconds) ? Math.max(0, Math.min(7200, Number(body.seconds))) : null;
  const filterValue = type === "search"
    ? text(body.filter_value, 60)?.toLocaleLowerCase("de") ?? null
    : text(body.filter_value, 60);
  if (type === "search" && (!filterValue || filterValue.length < 3)) return done(400);

  const ip = (request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]
    || "").trim();

  const { error } = await client.rpc("track_event", {
    p_type: type,
    p_view_id: viewId,
    p_path: path && path.startsWith("/") ? path : null,
    p_referrer_host: referrerHost,
    p_device: device,
    p_event_id: eventId,
    p_filter_name: filterName,
    p_filter_value: filterValue,
    p_seconds: type === "leave" ? seconds : null,
    p_client: `${ip}|${userAgent}`,
  });
  if (error) {
    console.error("Could not store analytics event:", error.message);
    return done(500);
  }
  return done();
});
