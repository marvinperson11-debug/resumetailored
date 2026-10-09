import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseVideoBackend } from "@/lib/saved-videos-store";
import { scriptFileFor } from "@/lib/saved-videos";

export const runtime = "nodejs";

/** Download a saved video's script as a .txt file. Owner-only; someone else's id is a 404. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const be = supabaseVideoBackend();
  const file = be ? await scriptFileFor(be, userId, params.id) : null;
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
