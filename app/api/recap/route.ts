import { NextResponse } from "next/server";
import { AiError, recapDay } from "@/lib/gemini";
import { isDate, sanitizeEntry } from "@/lib/sanitize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send the entry as JSON." }, { status: 400 });
  }
  const date = body?.date;
  if (!isDate(date)) return NextResponse.json({ error: "Bad date." }, { status: 400 });

  try {
    const recap = await recapDay(sanitizeEntry(date, body));
    return NextResponse.json({ recap });
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("POST /api/recap", e);
    return NextResponse.json({ error: "Something went wrong while writing the recap." }, { status: 500 });
  }
}
