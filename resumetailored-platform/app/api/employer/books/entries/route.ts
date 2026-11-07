import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBooks, canUseFullBooks } from "@/lib/employer-plan";
import { listEntries, createEntry } from "@/lib/books-store";
import { isBooksEntryType, BOOKS_CATEGORIES, UNCATEGORIZED } from "@/lib/books-hub";

export const dynamic = "force-dynamic";

/** GET ?from=&to=&type=&jobId= — this employer's own income/expense entries. */
export async function GET(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const jobIdRaw = url.searchParams.get("jobId");
  const jobId = jobIdRaw ? Number(jobIdRaw) : undefined;
  const entries = await listEntries(ctx.employerId, {
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    type: isBooksEntryType(type) ? type : undefined,
    jobId: Number.isFinite(jobId) ? jobId : undefined,
  });
  return NextResponse.json({ entries });
}

function cleanCategory(raw: unknown): string {
  const v = String(raw ?? "").trim().slice(0, 80);
  return v || UNCATEGORIZED;
}

/** POST — create one manual entry. Body: { type, entryDate, amount, description, category, jobId? }.
 *  `jobId` (tagging an expense to a job posting for cost-per-hire) requires full Books (Corporate) —
 *  a Portal/Scale caller's jobId is silently dropped rather than erroring, since the entry itself is
 *  still valid without it. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    type?: string;
    entryDate?: string;
    amount?: number;
    description?: string;
    category?: string;
    jobId?: number;
  };
  if (!isBooksEntryType(body.type)) return NextResponse.json({ error: "type must be 'income' or 'expense'." }, { status: 400 });
  const entryDate = String(body.entryDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return NextResponse.json({ error: "entryDate must be YYYY-MM-DD." }, { status: 400 });
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "amount must be a positive number." }, { status: 400 });

  const jobId = canUseFullBooks(ctx.access) && Number.isFinite(Number(body.jobId)) ? Number(body.jobId) : null;

  const entry = await createEntry(ctx.employerId, ctx.userId, {
    type: body.type,
    entryDate,
    amountCents: Math.round(amount * 100),
    description: String(body.description || "").trim().slice(0, 500),
    category: cleanCategory(body.category),
    jobId,
  });
  if (!entry) return NextResponse.json({ error: "Could not save this entry. Please try again." }, { status: 500 });
  return NextResponse.json({ entry, categories: BOOKS_CATEGORIES });
}
