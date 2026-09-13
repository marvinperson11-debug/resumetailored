/**
 * Career-site subdomain helpers — pure, dependency-free, and edge-safe (imported
 * by middleware.ts). Maps {slug}.resumetailored.com → the career site for that
 * slug. The slug in `career_sites` is the single source of truth; there is no
 * subdomain column.
 */

export const ROOT_DOMAIN = "resumetailored.com";

/** Hosts/labels that must never map to a career site — apex tooling + product
 *  areas. `www`/`app` route normally; the rest are reserved so a slug can't
 *  shadow them. */
export const RESERVED_SUBDOMAINS = new Set<string>([
  "www",
  "app",
  "api",
  "mail",
  "admin",
  "dashboard",
  "careers",
  "jobs",
  "employer",
  "support",
  "help",
  "billing",
  "status",
  "docs",
  "blog",
]);

/**
 * Given a request host, return the career-site subdomain to render, or `null`
 * to route normally. Only a single-level, non-reserved `*.resumetailored.com`
 * host maps to a career site. The apex, `www`/`app`, reserved labels, deeper
 * labels, and every non-production host (Railway/Netlify/localhost/custom)
 * route normally.
 */
export function careerSubdomainFromHost(rawHost: string | null | undefined): string | null {
  if (!rawHost) return null;
  const host = rawHost.split(",")[0].split(":")[0].trim().toLowerCase(); // first value, strip port
  const suffix = "." + ROOT_DOMAIN;
  if (!host.endsWith(suffix)) return null; // apex (no leading dot) and other domains route normally
  const label = host.slice(0, -suffix.length);
  if (!label || label.includes(".")) return null; // empty or multi-level → normal routing
  if (RESERVED_SUBDOMAINS.has(label)) return null;
  return label;
}

/** Career-site slug format: 1–40 chars, lowercase alnum + internal hyphens,
 *  and not a reserved label. */
export function isValidSlug(s: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s) && !RESERVED_SUBDOMAINS.has(s);
}

/** Normalize free text into a candidate slug (same rules as the store). */
export function normalizeSlug(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** The public subdomain URL for a slug, e.g. https://walmart.resumetailored.com */
export function careerSubdomainUrl(slug: string): string {
  return `https://${slug}.${ROOT_DOMAIN}`;
}
