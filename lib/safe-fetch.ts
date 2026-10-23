import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Fetches a page on behalf of the signed-in person. Because the address comes
 * from user input, it refuses anything that resolves to a private, loopback or
 * link-local address (so the server cannot be pointed at internal services),
 * re-checks every redirect, and caps the size and time of the download.
 */

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 4;

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // unique local
  if (v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb")) return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new FetchRefused("Only http and https links can be read.");
  }
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new FetchRefused("That link uses an unusual port, so it was not fetched.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new FetchRefused("That link points at a private address.");
  }
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new FetchRefused("That link points at a private address.");
  }
}

export class FetchRefused extends Error {}

export async function fetchPublicText(
  input: string,
): Promise<{ finalUrl: string; contentType: string; text: string }> {
  let url = new URL(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; TradingJournalBot/1.0)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "accept-language": "en",
      },
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) {
      throw new FetchRefused(`The site answered with status ${res.status}.`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!/text\/|html|xml|json/i.test(contentType)) {
      throw new FetchRefused("That link is not a web page or text document.");
    }

    const reader = res.body?.getReader();
    if (!reader) throw new FetchRefused("The page came back empty.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
    return { finalUrl: url.href, contentType, text };
  }
  throw new FetchRefused("Too many redirects.");
}
