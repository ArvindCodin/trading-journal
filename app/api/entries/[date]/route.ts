import { NextResponse } from "next/server";
import { entries, toDoc } from "@/lib/db";
import { entryHasContent, isDate, sanitizeEntry } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ date: string }> };

export async function PUT(req: Request, ctx: Ctx) {
  const { date } = await ctx.params;
  if (!isDate(date)) return NextResponse.json({ error: "Bad date." }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send the entry as JSON." }, { status: 400 });
  }

  const entry = sanitizeEntry(date, body);
  try {
    const col = await entries();
    if (!entryHasContent(entry)) {
      await col.deleteOne({ _id: date });
      return NextResponse.json({ entry: null });
    }
    const doc = toDoc(entry);
    await col.replaceOne({ _id: date }, doc, { upsert: true });
    return NextResponse.json({ entry });
  } catch (e) {
    console.error("PUT /api/entries", e);
    return NextResponse.json({ error: "Could not save to the database." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { date } = await ctx.params;
  if (!isDate(date)) return NextResponse.json({ error: "Bad date." }, { status: 400 });
  try {
    const col = await entries();
    await col.deleteOne({ _id: date });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/entries", e);
    return NextResponse.json({ error: "Could not delete from the database." }, { status: 500 });
  }
}
