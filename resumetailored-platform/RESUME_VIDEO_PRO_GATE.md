# Resume Video → Pro-only + personalization

Two changes: **(A)** the Resume Video tool is now fully Pro-gated (free users can't open it — the sidebar shows a lock and clicking goes straight to the upgrade flow), and **(B)** Pro users get a **Personalize** card (To / greeting / closing) that flows into the AI script. `next build` is green.

## How the gate works (single choke point)

Every way of opening a tool — sidebar, dashboard quick-actions, any deep link — goes through `openTool()` in `tools-context.tsx`. That function already redirects free users to `/candidate?upgrade=pro` for any tool whose `kind === "pro"`. So the fix is just to mark Resume Video as `kind: "pro"`. On top of that:
- the sidebar shows a **lock icon** to free users on the item, and
- the tool component itself has a **backstop**: if a free user somehow reaches it, it redirects to the upgrade flow and renders nothing, and
- the **script API route** is Pro-gated server-side (defense in depth).

---

## 1) `app/candidate/components/tools-context.tsx`

Change the Resume Video entry in the `TOOLS` array from `kind: "tool"` to `kind: "pro"` (Personal Website stays open):

```tsx
  // Resume Video is a fully Pro-only tool: free users can't open it at all
  // (openTool redirects them to the upgrade flow). The in-tool voiceover/MP4
  // gates remain as secondary server-side checks.
  { id: "video", label: "Resume Video", icon: Video, kind: "pro" },
  // Personal Website opens for everyone; its Pro gate is on Publish.
  { id: "studio", label: "Personal Website", icon: Globe, kind: "tool" },
```

The existing guard in `openTool` (unchanged) does the redirect:

```tsx
if (meta.kind === "pro" && !isPro) {
  router.push("/candidate?upgrade=pro");
  return;
}
```

---

## 2) `components/candidate-sidebar.tsx`

Add the `Lock` icon import:

```tsx
import {
  // …existing icons…
  Star,
  Crown,
  Lock,
  type LucideIcon,
} from "lucide-react";
```

Add a `locked` flag to the `NavItem` type:

```tsx
interface NavItem {
  // …existing fields…
  /** Show a small "PRO" pill to the right. */
  pro?: boolean;
  /** Fully Pro-gated: free users see a lock and clicking opens the upgrade flow. */
  locked?: boolean;
}
```

Mark the Resume Video nav item as locked:

```tsx
  { label: "Resume Video", opens: "video", icon: Video, pro: true, locked: true },
```

Render a lock for free users (Pro users still see the PRO pill):

```tsx
          const inner = (
            <>
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span className={cn(!item.pro && "flex-1")}>{item.label}</span>
              {item.pro &&
                (item.locked && !proish ? (
                  <Lock className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-cream" />
                ) : (
                  <ProBadge />
                ))}
            </>
          );
```

Clicking the item already calls `openTool("video")`, which now redirects free users to `/candidate?upgrade=pro` — so the lock click opens the upgrade flow immediately.

---

## 3) `lib/video-ai.ts`

Add the option lists + defaults, and extend the prompt builder to place the greeting + "To" at the opening and the chosen closing at the end (keeping the HOOK/PROOF/STRENGTHS/CLOSE structure):

```ts
/** Preset greeting openers offered in the Personalize section (custom text allowed too). */
export const GREETING_OPTIONS = [
  "Hello", "Hi", "Dear", "Good morning", "Good afternoon", "Greetings", "Hey", "To whom it may concern",
];

/** Preset closings offered in the Personalize section (custom text allowed too). */
export const CLOSING_OPTIONS = [
  "Thank you for your time", "Have a great day", "Best regards",
  "Looking forward to hearing from you", "Sincerely", "Talk soon", "Cheers",
];

export const DEFAULT_GREETING = "Hello";
export const DEFAULT_CLOSING = "Thank you for your time";

/** Optional personalization the Pro user sets in the modal. */
export interface VideoScriptOptions {
  to?: string;        // "Sarah Johnson" / "Team at Google". Empty ⇒ generic opener.
  greeting?: string;  // "Hello"
  closing?: string;   // "Thank you for your time"
}

export function buildVideoScriptPrompt(
  resume: string,
  template: string,
  opts: VideoScriptOptions = {}
): { system: string; user: string } {
  const tone =
    template === "creative" ? "energetic and bold"
    : template === "minimal" ? "calm, spare, and understated"
    : template === "warm" ? "warm, friendly, and human"
    : "polished and professional";

  const greeting = (opts.greeting || DEFAULT_GREETING).trim().slice(0, 60) || DEFAULT_GREETING;
  const to = (opts.to || "").trim().slice(0, 80);
  const closing = (opts.closing || DEFAULT_CLOSING).trim().slice(0, 140) || DEFAULT_CLOSING;
  // "Hello Sarah," when addressed, otherwise just "Hello,".
  const opener = to ? `${greeting} ${to},` : `${greeting},`;

  return {
    system:
      "You write short spoken scripts for 30–45 second first-person video resumes. The script is read aloud by one voice, so write natural, punchy spoken English — no headers, no stage directions, no markdown. It must sound like a confident person introducing themselves, not a document read aloud.",
    user: `Write a ${tone} first-person video-resume script (~90–120 words, ~35 seconds spoken) from the resume below.

Structure it as 4 short spoken beats, one per line, in this exact labeled form (keep the labels — the app splits on them):
HOOK: begin the sentence EXACTLY with "${opener}" then the person's name and a confident one-line hook — for example "${opener} I'm Jordan Lee, a ..."
PROOF: one or two sentences — the single most impressive, quantified achievement
STRENGTHS: one sentence — the skills/qualities that make them a strong hire
CLOSE: one sentence — what they're looking for — and END it with EXACTLY this sign-off: "${closing}."

Rules: first person ("I"), spoken cadence, real specifics from the resume (never invented), no buzzword soup, no "I am a results-driven professional". Do not repeat the greeting or the closing anywhere except where instructed above.

RESUME:
${resume.slice(0, 6000)}`,
  };
}
```

Example output with To = "Sarah": `HOOK: Hello Sarah, I'm Marvin Person, a software engineer with 5 years… … CLOSE: …and that's why I'd be a great fit for your team. Thank you for your time.`
With To empty: `HOOK: Hello, I'm Marvin Person… … CLOSE: … Thank you for your time.`

---

## 4) `app/api/resume-video/script/route.ts` (server-side Pro gate + pass personalization)

> Not in your file list, but required: since the whole tool is Pro-only now, the script endpoint is gated too (so it can't be called by a free account directly), and it forwards the new fields.

```ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { buildVideoScriptPrompt } from "@/lib/video-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  if (!(await isPro())) {
    return NextResponse.json({ error: "pro_required", message: "Resume Video is a Pro feature." }, { status: 402 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    resume?: string; template?: string; to?: string; greeting?: string; closing?: string;
  };
  const resume = (body.resume || "").trim();
  if (resume.length < 40) return NextResponse.json({ error: "Paste your resume (a few sentences at least)." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const { system, user } = buildVideoScriptPrompt(resume, body.template || "professional", {
    to: body.to, greeting: body.greeting, closing: body.closing,
  });
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 700, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const script = (block && block.type === "text" ? block.text : "").trim();
    if (!script) throw new Error("empty script");
    return NextResponse.json({ script });
  } catch (err) {
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not generate the script. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

---

## 5) `app/candidate/tools/resume-video.tsx`

**Imports** — add `TextInput` and the personalization exports; drop the now-unused `UpgradeNote`:

```tsx
import { Label, TextArea, TextInput, Select, PrimaryButton, SecondaryButton } from "../components/ui";
import {
  VIDEO_TEMPLATES, VIDEO_VOICES, parseScriptScenes,
  GREETING_OPTIONS, CLOSING_OPTIONS, DEFAULT_GREETING, DEFAULT_CLOSING,
} from "@/lib/video-ai";
```

**State** (next to `template`/`voice`):

```tsx
// Personalization (Pro): who the video is for + greeting/closing style.
const [toWhom, setToWhom] = useState("");
const [greeting, setGreeting] = useState(DEFAULT_GREETING);
const [closing, setClosing] = useState(DEFAULT_CLOSING);
```

**Pro backstop** — redirect free users; skip the resumes fetch until Pro:

```tsx
useEffect(() => {
  if (!isPro) {
    router.push("/candidate?upgrade=pro");
    onClose();
  }
}, [isPro, router, onClose]);

useEffect(() => {
  if (!isPro) return;
  fetch("/api/resumes", { cache: "no-store" })
    .then((r) => r.json())
    .then((d: { drafts?: ResumeDraft[] }) => setResumes(d.drafts || []))
    .catch(() => {});
}, [isPro]);
```

…and right before the main `return (`:

```tsx
// Pro-only tool. The effect above redirects free users; render nothing for the
// frame before that navigation lands so the form never flashes.
if (!isPro) return null;
```

**`genScript` body** — send the personalization and handle a 402:

```tsx
body: JSON.stringify({
  resume: resumeText,
  template,
  to: toWhom.trim(),
  greeting: greeting.trim() || DEFAULT_GREETING,
  closing: closing.trim() || DEFAULT_CLOSING,
}),
// …after the fetch:
if (res.status === 402) { router.push("/candidate?upgrade=pro"); return; }
```

**Personalize card** — inserted in the left column after the Style/Voice grid:

```tsx
{/* Personalize — who the video is for + greeting/closing style. */}
<div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
  <div className="flex items-center gap-2">
    <Sparkles className="h-3.5 w-3.5 text-violet" />
    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-cream">Personalize</h4>
  </div>
  <div>
    <Label>Who is this video for? (optional)</Label>
    <TextInput value={toWhom} onChange={(e) => setToWhom(e.target.value)}
      placeholder="e.g. Hiring Manager, Sarah Johnson, Team at Google" />
  </div>
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <div>
      <Label>How do you want to start?</Label>
      <TextInput list="rv-greetings" value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder={DEFAULT_GREETING} />
      <datalist id="rv-greetings">{GREETING_OPTIONS.map((o) => <option key={o} value={o} />)}</datalist>
    </div>
    <div>
      <Label>How do you want to close?</Label>
      <TextInput list="rv-closings" value={closing} onChange={(e) => setClosing(e.target.value)} placeholder={DEFAULT_CLOSING} />
      <datalist id="rv-closings">{CLOSING_OPTIONS.map((o) => <option key={o} value={o} />)}</datalist>
    </div>
  </div>
  <p className="text-[11px] text-white/45">Used at the open and close of your script — pick a preset or type your own.</p>
</div>
```

The greeting/closing use a native `<input list=…>` + `<datalist>` combobox, which gives the preset dropdown **and** free typing in one control (satisfies "allow custom text too"). The footer's old "Free" label and the free-user `UpgradeNote` were removed since the tool is now Pro-only.

---

## Deploy & verify

Merge to `main` → the app (`web` service) auto-deploys (same flow as before; no legacy-site or env changes needed).

- **Free user:** sidebar "Resume Video" shows a 🔒; clicking → `/candidate?upgrade=pro`; the modal never opens. Direct/stale attempts also redirect.
- **Pro user:** opens normally, sees the **Personalize** card. Set To / greeting / closing → **Generate script** → the script opens with the greeting (+ name) and ends with the chosen closing. Voiceover + MP4 work as before.

---

## One thing worth confirming (my only question)

I made the **script API route Pro-gated** (402 for non-Pro), which wasn't in your file list but is the correct server-side enforcement now that the whole tool is Pro. If you'd rather keep script generation open to everyone at the API level (e.g. you plan to reuse `/api/resume-video/script` from a free surface like the public `/preview` maker), tell me and I'll drop that one gate — the UI gate + `openTool` redirect still keep the tool itself Pro-only. Everything else matches your spec exactly.
