"use client";

/**
 * Browser side of the server export (/api/documents/export): posts the text on screen, then downloads the
 * .docx / .pdf the server rendered. No window.print(), no client-side file writer. Resolves to an error
 * message, or null on success.
 */
export async function exportDocument(opts: {
  text: string;
  kind: "resume" | "cover_letter";
  format: "docx" | "pdf";
  employer?: string;
  position?: string;
  templateId?: string;
  fallbackError: string;
}): Promise<string | null> {
  try {
    const { fallbackError, ...payload } = opts;
    const res = await fetch("/api/documents/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const type = res.headers.get("content-type") || "";
    if (type.includes("application/json")) {
      const data = (await res.json().catch(() => ({}))) as { url?: string; filename?: string; message?: string; error?: string };
      if (!res.ok || !data.url) return data.message || data.error || fallbackError;
      const a = document.createElement("a");
      a.href = data.url;
      a.download = data.filename || "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return null;
    }
    if (!res.ok) return fallbackError;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = opts.kind === "resume" ? `Resume.${opts.format}` : `CoverLetter.${opts.format}`;
    a.click();
    URL.revokeObjectURL(a.href);
    return null;
  } catch {
    return opts.fallbackError;
  }
}
