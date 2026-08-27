"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ResumeData } from "@/lib/types";

// pdf.js is loaded from a CDN on demand so we don't bundle it.
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

async function extractPdfText(file: File): Promise<string> {
  // Dynamic remote ESM import; webpackIgnore keeps the bundler from resolving it.
  const pdfjs: any = await import(/* webpackIgnore: true */ PDFJS_URL);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map((it: { str?: string }) => it.str ?? "").join(" ") + "\n";
  }
  return text;
}

export function ResumeUploader({ initial }: { initial: ResumeData | null }) {
  const [resume, setResume] = useState<ResumeData | null>(initial);
  const [pasted, setPasted] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function parse(text: string) {
    if (text.trim().length < 30) {
      setStatus("That doesn't look like enough text to parse.");
      return;
    }
    setBusy(true);
    setStatus("Parsing with GPT-4o…");
    try {
      const res = await fetch("/api/resume/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.message || data.error || "Parse failed.");
        return;
      }
      setResume(data.resumeData);
      setStatus("Saved ✓");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus("Reading file…");
    try {
      let text = "";
      if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        text = await extractPdfText(file);
      } else {
        text = await file.text();
      }
      await parse(text);
    } catch (err) {
      console.error(err);
      setStatus("Couldn't read that file. Try pasting the text instead.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resume</CardTitle>
        <CardDescription>Upload a PDF or paste your resume text. We parse it into structured data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex">
            <input type="file" accept=".pdf,.txt,.md" className="hidden" onChange={onFile} disabled={busy} />
            <span className="inline-flex h-10 cursor-pointer items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Upload PDF
            </span>
          </label>
          {status && <span className="text-sm text-muted-foreground">{status}</span>}
        </div>

        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">…or paste text</summary>
          <div className="mt-2 space-y-2">
            <Textarea value={pasted} onChange={(e) => setPasted(e.target.value)} className="min-h-[140px]" placeholder="Paste your resume here…" />
            <Button size="sm" disabled={busy} onClick={() => parse(pasted)}>Parse pasted text</Button>
          </div>
        </details>

        {resume && (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm">
            <p className="font-medium">{resume.personalInfo?.fullName}</p>
            <p className="text-muted-foreground">{resume.personalInfo?.email} · {resume.personalInfo?.location}</p>
            <p className="mt-2 text-muted-foreground">
              {resume.workExperience?.length ?? 0} roles · {resume.education?.length ?? 0} schools · {resume.skills?.length ?? 0} skills
            </p>
            {resume.skills?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {resume.skills.slice(0, 12).map((s) => (
                  <span key={s} className="rounded bg-secondary px-2 py-0.5 text-xs">{s}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
