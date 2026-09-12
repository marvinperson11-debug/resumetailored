import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { inflateRawSync } from "node:zlib";
import { parseFromCsvFiles, parseFromJson, hasContent, type ParsedLinkedIn } from "@/lib/linkedin-import";

export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * Parse a LinkedIn data export — no AI, pure parsing. Accepts either:
 *   { linkedinJson }  — a JSON string/object of the profile, or
 *   { linkedinZip }   — base64 of the export .zip (we unpack the CSVs here).
 * Returns { parsedProfile }.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { linkedinJson?: unknown; linkedinZip?: string };

  let parsed: ParsedLinkedIn | null = null;

  // JSON path.
  if (body.linkedinJson !== undefined && body.linkedinJson !== null && body.linkedinJson !== "") {
    try {
      const obj = typeof body.linkedinJson === "string" ? JSON.parse(body.linkedinJson) : body.linkedinJson;
      parsed = parseFromJson(obj);
    } catch {
      return NextResponse.json({ error: "That doesn't look like valid JSON. Paste the file contents, or upload the ZIP." }, { status: 400 });
    }
  }

  // ZIP path (base64, possibly with a data: prefix).
  if ((!parsed || !hasContent(parsed)) && body.linkedinZip) {
    try {
      const b64 = body.linkedinZip.includes(",") ? body.linkedinZip.split(",").pop()! : body.linkedinZip;
      const buf = Buffer.from(b64, "base64");
      const files = readZipCsvs(buf);
      parsed = parseFromCsvFiles(files);
    } catch {
      return NextResponse.json({ error: "Could not read that ZIP. Make sure it's the LinkedIn export .zip." }, { status: 400 });
    }
  }

  if (!parsed || !hasContent(parsed)) {
    return NextResponse.json({ error: "No profile data found. Upload the LinkedIn export ZIP, or paste your profile JSON." }, { status: 400 });
  }

  return NextResponse.json({ parsedProfile: parsed });
}

/** Extract the LinkedIn export CSVs from a ZIP buffer using the central directory
 *  + Node's raw inflate (store + deflate entries). Minimal, dependency-free. */
function readZipCsvs(buf: Buffer): { profile?: string; positions?: string; education?: string; skills?: string } {
  const want: Record<string, "profile" | "positions" | "education" | "skills"> = {
    "profile.csv": "profile",
    "positions.csv": "positions",
    "education.csv": "education",
    "skills.csv": "skills",
  };
  const out: { profile?: string; positions?: string; education?: string; skills?: string } = {};

  // Find End Of Central Directory (search backwards for the signature).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return out;
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16); // central directory offset

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen);
    ptr += 46 + nameLen + extraLen + commentLen;

    const base = name.split("/").pop()!.toLowerCase();
    const key = want[base];
    if (!key) continue;

    // Read the local header to find where the data starts.
    if (buf.readUInt32LE(localOff) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    try {
      const text = method === 0 ? raw.toString("utf8") : inflateRawSync(raw).toString("utf8");
      out[key] = text;
    } catch {
      /* skip an entry we can't inflate */
    }
  }
  return out;
}
