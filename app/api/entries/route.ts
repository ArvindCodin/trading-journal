import { NextResponse } from "next/server";
import { entries, toEntry } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const col = await entries();
    const docs = await col.find({}).sort({ _id: -1 }).limit(1000).toArray();
    return NextResponse.json({ entries: docs.map(toEntry) });
  } catch (e) {
    console.error("GET /api/entries", e);
    return NextResponse.json(
      { error: "Could not reach the database. Check MONGODB_URI and Atlas network access." },
      { status: 500 },
    );
  }
}
