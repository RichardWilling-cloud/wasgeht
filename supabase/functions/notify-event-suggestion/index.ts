import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const resendApiKey = Deno.env.get("RESEND_API_KEY");
const recipient = Deno.env.get("EVENT_SUGGESTION_RECIPIENT") || "waslos@wasgeht-ab.de";
const sender = Deno.env.get("EVENT_SUGGESTION_SENDER") || "wasgeht <noreply@wasgeht-ab.de>";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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
  if (typeof suggestionId !== "string") return respond({ error: "suggestionId is required" }, 400);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: suggestion, error: suggestionError } = await adminClient
    .from("event_suggestions")
    .select("id, title, starts_at, venue, source_url, description, submitted_by")
    .eq("id", suggestionId)
    .eq("submitted_by", user.id)
    .maybeSingle();
  if (suggestionError || !suggestion) return respond({ error: "Suggestion not found" }, 404);

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: sender,
      to: [recipient],
      subject: `Neuer Event-Vorschlag: ${suggestion.title}`,
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
    return respond({ error: "Notification could not be sent" }, 502);
  }
  return respond({ sent: true });
});
