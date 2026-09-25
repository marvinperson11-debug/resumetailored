import { NextResponse, type NextRequest } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { getCert, updateCert, uploadCertFile, downloadCertFile, certFileExt, MAX_CERT_FILE_BYTES } from "@/lib/cert-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/** POST attach a file to an existing certification. Multipart `file`,
 *  pdf/jpg/png/doc/docx ≤ 10MB. Owner-scoped. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can attach files." }, { status: 403 });
  const id = Number(params.id);
  const cert = await getCert(ctx.employerId, id);
  if (!cert) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });

  const ext = certFileExt(file.name || "", file.type);
  if (!ext) return NextResponse.json({ error: "Unsupported file type. Upload a PDF, image (JPG/PNG), or Word document." }, { status: 400 });
  if (file.size > MAX_CERT_FILE_BYTES) return NextResponse.json({ error: "That file is too large (max 10 MB)." }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  if (!buf.length) return NextResponse.json({ error: "That file is empty." }, { status: 400 });

  const stored = await uploadCertFile(ctx.employerId, cert.employeeId, { data: buf, filename: file.name || `file.${ext}`, ext });
  if (!stored) return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });

  const updated = await updateCert(ctx.employerId, id, { fileUrl: stored.path });
  if (!updated) return NextResponse.json({ error: "Could not save the file reference." }, { status: 500 });
  return NextResponse.json({ cert: updated });
}

/** GET stream the certification's attached file. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  const cert = await getCert(ctx.employerId, id);
  if (!cert || !cert.fileUrl) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const file = await downloadCertFile(ctx.employerId, cert.fileUrl);
  if (!file) return NextResponse.json({ error: "unavailable" }, { status: 502 });

  const dl = req.nextUrl.searchParams.get("download") === "1";
  const safeName = cert.name.replace(/[^\w.\-]+/g, "_") || "certification";
  return new NextResponse(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `${dl ? "attachment" : "inline"}; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
