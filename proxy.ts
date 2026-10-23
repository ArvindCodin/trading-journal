import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, verifySession } from "./lib/auth";

// Runs before every request. Everything except the login page and the login
// endpoint needs a valid session cookie.
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const open = pathname === "/login" || pathname === "/api/login";
  if (open) return NextResponse.next();

  let ok = false;
  try {
    ok = await verifySession(req.cookies.get(COOKIE)?.value);
  } catch {
    ok = false; // SESSION_SECRET missing: treat as signed out
  }
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
