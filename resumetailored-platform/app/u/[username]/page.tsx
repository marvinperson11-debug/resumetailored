import type { Metadata } from "next";
import { getProfileByUsername, themeById, type ContactInfo } from "@/lib/shareable-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public, no-auth Shareable Link page — the FREE taste of ResumeTailored that
// funnels visitors toward the Pro Website Creator.

function safe(u: string | undefined, kind: "http" | "mail" | "tel"): string {
  const s = String(u || "").trim();
  if (!s) return "";
  if (kind === "mail") return `mailto:${s}`;
  if (kind === "tel") return `tel:${s.replace(/[^0-9+]/g, "")}`;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

export async function generateMetadata({ params }: { params: { username: string } }): Promise<Metadata> {
  const p = await getProfileByUsername(params.username);
  if (!p) return { title: "Profile not found · ResumeTailored" };
  const title = `${p.name || p.username}${p.headline ? ` — ${p.headline}` : ""}`;
  const description = (p.bio || p.headline || "").slice(0, 160);
  return {
    title,
    description,
    openGraph: { title, description, type: "profile", images: p.photoUrl && /^https?:/.test(p.photoUrl) ? [p.photoUrl] : undefined },
    twitter: { card: p.photoUrl ? "summary_large_image" : "summary", title, description },
  };
}

export default async function ShareablePage({ params }: { params: { username: string } }) {
  const profile = await getProfileByUsername(params.username);
  const t = themeById(profile?.theme || "aurora");
  const dark = t.id === "aurora";

  if (!profile) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "#0b0f19", color: "#e8eaf2", fontFamily: "system-ui,sans-serif", textAlign: "center", padding: 32 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>Profile not found</h1>
        <p style={{ color: "#9aa3c0", maxWidth: "34ch", margin: 0 }}>This link doesn&rsquo;t exist yet.</p>
        <a href="/join" style={{ marginTop: 8, background: "#C2870B", color: "#fff", textDecoration: "none", padding: "11px 20px", borderRadius: 12, fontWeight: 700 }}>Create your free link →</a>
      </main>
    );
  }

  const c: ContactInfo = profile.contact || {};
  const links: { label: string; href: string }[] = [];
  if (c.email) links.push({ label: c.email, href: safe(c.email, "mail") });
  if (c.phone) links.push({ label: c.phone, href: safe(c.phone, "tel") });
  if (c.linkedin) links.push({ label: "LinkedIn", href: safe(c.linkedin, "http") });
  if (c.website) links.push({ label: "Website", href: safe(c.website, "http") });

  const photo = profile.photoUrl && /^(https?:|data:image\/)/i.test(profile.photoUrl) ? profile.photoUrl : "";

  return (
    <>
      {t.googleFont && (
        // eslint-disable-next-line @next/next/no-page-custom-font
        <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${t.googleFont.replace(/ /g, "+")}:wght@400;600;800&display=swap`} />
      )}
      <main style={{ minHeight: "100vh", background: t.bg, color: t.text, fontFamily: t.font, display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 20px" }}>
        <section
          style={{
            width: "100%", maxWidth: 560, background: t.panel, borderRadius: 28, padding: "40px 32px",
            boxShadow: dark ? "0 24px 80px rgba(0,0,0,.5)" : "0 24px 70px rgba(0,0,0,.10)",
            border: `1px solid color-mix(in srgb, ${t.accent} 16%, transparent)`, textAlign: "center", position: "relative", overflow: "hidden",
          }}
        >
          <div style={{ position: "absolute", inset: 0, height: 120, background: `linear-gradient(135deg, ${t.accent}, color-mix(in srgb, ${t.accent} 30%, transparent))`, opacity: dark ? 0.35 : 0.14 }} />
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt={profile.name} style={{ position: "relative", width: 112, height: 112, borderRadius: "50%", objectFit: "cover", margin: "8px auto 18px", border: `4px solid ${t.panel}`, boxShadow: `0 8px 24px rgba(0,0,0,.2)` }} />
          ) : (
            <div style={{ position: "relative", width: 112, height: 112, borderRadius: "50%", margin: "8px auto 18px", background: t.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44, fontWeight: 800, border: `4px solid ${t.panel}` }}>
              {(profile.name || profile.username).slice(0, 1).toUpperCase()}
            </div>
          )}
          <h1 style={{ position: "relative", margin: 0, fontSize: 30, fontWeight: 800 }}>{profile.name || profile.username}</h1>
          {profile.headline && <p style={{ position: "relative", margin: "8px 0 0", color: t.accent, fontWeight: 600, fontSize: 17 }}>{profile.headline}</p>}
          {c.location && <p style={{ position: "relative", margin: "6px 0 0", color: t.muted, fontSize: 14 }}>📍 {c.location}</p>}
          {profile.bio && <p style={{ position: "relative", margin: "20px auto 0", color: t.muted, fontSize: 16, lineHeight: 1.7, maxWidth: "46ch", whiteSpace: "pre-wrap" }}>{profile.bio}</p>}
          {links.length > 0 && (
            <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 24 }}>
              {links.map((l) => (
                <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" style={{ color: t.text, textDecoration: "none", border: `1px solid color-mix(in srgb, ${t.accent} 40%, transparent)`, borderRadius: 999, padding: "9px 16px", fontSize: 14, fontWeight: 600 }}>{l.label}</a>
              ))}
            </div>
          )}
        </section>

        {/* Upgrade CTA — the whole point of the free tier */}
        <a
          href="/join"
          style={{ marginTop: 28, display: "inline-flex", alignItems: "center", gap: 8, background: `linear-gradient(135deg, ${t.accent}, color-mix(in srgb, ${t.accent} 55%, #000))`, color: "#fff", textDecoration: "none", padding: "15px 26px", borderRadius: 16, fontWeight: 800, fontSize: 16, boxShadow: `0 12px 34px color-mix(in srgb, ${t.accent} 45%, transparent)` }}
        >
          ✨ Build a full personal website with ResumeTailored
        </a>
        <p style={{ marginTop: 12, color: t.muted, fontSize: 13, maxWidth: "42ch", textAlign: "center" }}>
          Multiple sections, video, custom design, your own domain and more — free to start.
        </p>

        <footer style={{ marginTop: 34, color: t.muted, fontSize: 12 }}>
          Powered by <a href="/" style={{ color: t.accent, textDecoration: "none", fontWeight: 700 }}>ResumeTailored</a>
        </footer>
      </main>
    </>
  );
}
