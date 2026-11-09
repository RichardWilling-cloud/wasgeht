// Canonical venue names. The same venue appears under different spellings in the
// sources ("Kalifstorch", "HsD (ehem. Gewerkschaftshaus)", "Klubhaus"); one name keeps
// the venue pages, duplicate detection and filters consistent.
// Keep in sync with VENUE_ALIASES in supabase/functions/run-event-import/index.ts.
export const VENUE_ALIASES = [
  [/^kalif\s*storch$/i, "Kalif Storch"],
  [/^(hsd\b.*|haus der sozialen dienste.*)$/i, "HsD – Haus der sozialen Dienste"],
  [/^((klubhaus\s*)?kickerkeller|klubhaus)$/i, "Klubhaus Kickerkeller"],
  [/^triebwerk$/i, "Triebwerk"],
  [/^jederkann$/i, "jederkann"],
  [/^planet comics caf[eé]( erfurt)?$/i, "Planet Comics Café"],
  [/^zughafen( erfurt)?$/i, "Zughafen Erfurt"],
];

export function canonicalVenue(name) {
  const value = String(name ?? "").trim();
  return VENUE_ALIASES.find(([pattern]) => pattern.test(value))?.[1] || value;
}
