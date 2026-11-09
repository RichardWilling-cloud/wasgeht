import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const recipient = Deno.env.get("EVENT_SUGGESTION_RECIPIENT") || "waslos@wasgeht-ab.de";
const sender = Deno.env.get("EVENT_SUGGESTION_SENDER") || "wasgeht <noreply@wasgeht-ab.de>";
const allowedOrigins = ["https://wasgeht-ab.de", "https://www.wasgeht-ab.de", "http://localhost:8000"];
// Only freshly created suggestions trigger a mail; protects against replaying old IDs.
const MAX_SUGGESTION_AGE_MS = 15 * 60 * 1000;

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

Deno.serve(async (request) => {
  const respond = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(request) });
  }
  if (request.method !== "POST") return respond({ error: "Only POST is supported" }, 405);
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !resendApiKey) {
    return respond({ error: "Suggestion notification is not configured" }, 503);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return respond({ error: "Authentication required" }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return respond({ error: "Authentication required" }, 401);

  const { suggestionId } = await request.json().catch(() => ({}));
  if (typeof suggestionId !== "string" || !/^[0-9a-f-]{36}$/i.test(suggestionId)) {
    return respond({ error: "suggestionId is required" }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  // Atomically claim the notification: only the first call for a fresh, pending,
  // own suggestion gets a row back. Repeated calls cannot send further e-mails.
  const { data: suggestion, error: claimError } = await adminClient
    .from("event_suggestions")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", suggestionId)
    .eq("submitted_by", user.id)
    .eq("status", "pending")
    .is("notified_at", null)
    .gte("created_at", new Date(Date.now() - MAX_SUGGESTION_AGE_MS).toISOString())
    .select("id, title, starts_at, venue, source_url, description")
    .maybeSingle();
  if (claimError) {
    console.error("Could not claim suggestion notification:", claimError);
    return respond({ error: "Notification could not be prepared" }, 500);
  }
  if (!suggestion) return respond({ sent: false, reason: "already notified or not found" }, 200);

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: sender,
      to: [recipient],
      subject: `Neuer Event-Vorschlag: ${String(suggestion.title).replace(/[\r\n]+/g, " ")}`,
      text: [
        `Titel: ${suggestion.title}`,
        `Datum: ${suggestion.starts_at}`,
        `Location: ${suggestion.venue}`,
        `Quelle: ${suggestion.source_url}`,
        `Beschreibung: ${suggestion.description || "-"}`,
        `Vorschlag-ID: ${suggestion.id}`,
      ].join("\n"),
    }),
  });
  if (!emailResponse.ok) {
    console.error("Resend rejected suggestion notification:", await emailResponse.text());
    // Release the claim so a retry is possible.
    await adminClient.from("event_suggestions").update({ notified_at: null }).eq("id", suggestion.id);
    return respond({ error: "Notification could not be sent" }, 502);
  }
  return respond({ sent: true });
});
