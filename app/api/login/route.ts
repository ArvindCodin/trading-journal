import { NextResponse } from "next/server";
import { COOKIE, cookieOptions, passwordMatches, signSession } from "@/lib/auth";

export async function POST(req: Request) {
  let password = "";
  try {
    const body = await req.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Send the password as JSON." }, { status: 400 });
  }

  try {
    if (!passwordMatches(password)) {
      await new Promise((r) => setTimeout(r, 700)); // slows down guessing
      return NextResponse.json({ error: "Wrong password." }, { status: 401 });
    }
    const token = await signSession();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, token, cookieOptions);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server is not configured.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
