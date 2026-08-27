"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface TokenMeta { id: string; label: string | null; lastUsedAt: string | null; createdAt: string; }

export function ExtensionTokenPanel() {
  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/extension-token");
    const data = await res.json();
    setTokens(data.tokens ?? []);
  }
  useEffect(() => { load(); }, []);

  async function mint() {
    setBusy(true);
    try {
      const res = await fetch("/api/extension-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      setFresh(data.token);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/extension-token?id=${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Browser extension</CardTitle>
        <CardDescription>
          Generate a token, then paste it into the AutoApply extension popup so it can read your
          data on the employer&apos;s site.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {fresh && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="font-medium text-amber-900">Copy this token now — it won&apos;t be shown again:</p>
            <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs">{fresh}</code>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => navigator.clipboard.writeText(fresh)}>Copy</Button>
          </div>
        )}
        <Button onClick={mint} disabled={busy}>{busy ? "Generating…" : "Generate extension token"}</Button>

        {tokens.length > 0 && (
          <ul className="divide-y text-sm">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2">
                <span>
                  {t.label ?? "Token"}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t.lastUsedAt ? `last used ${new Date(t.lastUsedAt).toLocaleDateString()}` : "never used"}
                  </span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => revoke(t.id)}>Revoke</Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
