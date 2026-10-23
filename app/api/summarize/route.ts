import { NextResponse } from "next/server";
import { AiError, isYouTube, summarizeArticle, summarizeVideo } from "@/lib/gemini";
import { cleanUrl } from "@/lib/sanitize";

export const dynamic = "force-dynamic";
// Long videos can take a while. Vercel's Hobby plan allows up to 60 seconds.
export const maxDuration = 60;

export async function POST(req: Request) {
  let url = "";
  try {
    const body = await req.json();
    url = cleanUrl(body?.url);
  } catch {
    /* handled below */
  }
  if (!url) return NextResponse.json({ error: "That is not a valid link." }, { status: 400 });

  try {
    const result = isYouTube(url) ? await summarizeVideo(url) : await summarizeArticle(url);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("POST /api/summarize", e);
    return NextResponse.json({ error: "Something went wrong while summarizing." }, { status: 500 });
  }
}
