import type { AiSummary, Entry, Recap, Source, Takeaway } from "./types";

const MAX_SOURCES = 40;
const MAX_TAKEAWAYS = 60;
const MAX_TAGS = 20;

export function isDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function strList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => str(x, maxLen).trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

/** Returns a normalized http(s) URL, or "" when the input is not one. */
export function cleanUrl(input: unknown): string {
  let s = typeof input === "string" ? input.trim() : "";
  if (!s || s.length > 2000) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (/^[^\s/]+\.[^\s/]{2,}/.test(s)) s = "https://" + s;
    else return "";
  }
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    return u.href;
  } catch {
    return "";
  }
}

export function detectType(href: string): "video" | "article" {
  try {
    const host = new URL(href).hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (["youtu.be", "youtube.com", "youtube-nocookie.com"].includes(host)) return "video";
  } catch {
    /* fall through */
  }
  return "article";
}

function sanitizeAi(v: unknown): AiSummary | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const tldr = str(o.tldr, 2000);
  if (!tldr) return undefined;
  return {
    tldr,
    points: strList(o.points, 12, 600),
    takeaways: strList(o.takeaways, 8, 600),
    watchOuts: strList(o.watchOuts, 8, 600),
    model: str(o.model, 80),
    at: Number(o.at) || 0,
  };
}

function sanitizeRecap(v: unknown): Recap | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const summary = str(o.summary, 4000);
  if (!summary) return undefined;
  return {
    summary,
    gaps: strList(o.gaps, 10, 600),
    questions: strList(o.questions, 10, 600),
    at: Number(o.at) || 0,
  };
}

export function sanitizeEntry(date: string, raw: unknown): Entry {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const sources: Source[] = [];
  if (Array.isArray(o.sources)) {
    for (const item of o.sources.slice(0, MAX_SOURCES)) {
      const s = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const url = cleanUrl(s.url);
      if (!url) continue;
      sources.push({
        id: str(s.id, 40) || Math.random().toString(36).slice(2, 10),
        url,
        title: str(s.title, 300),
        type: s.type === "video" ? "video" : "article",
        note: str(s.note, 8000),
        ai: sanitizeAi(s.ai),
      });
    }
  }

  const takeaways: Takeaway[] = [];
  if (Array.isArray(o.takeaways)) {
    for (const item of o.takeaways.slice(0, MAX_TAKEAWAYS)) {
      const t = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const text = str(t.text, 1000).trim();
      if (!text) continue;
      takeaways.push({
        id: str(t.id, 40) || Math.random().toString(36).slice(2, 10),
        text,
        star: t.star === true,
      });
    }
  }

  const seen = new Set<string>();
  const tags = strList(o.tags, MAX_TAGS, 24).filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    date,
    sources,
    learned: str(o.learned, 30000),
    takeaways,
    tags,
    recap: sanitizeRecap(o.recap),
    updatedAt: Date.now(),
  };
}

export function entryHasContent(e: Entry): boolean {
  return Boolean(e.sources.length || e.learned.trim() || e.takeaways.length || e.tags.length);
}
