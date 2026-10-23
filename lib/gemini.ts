import { ApiError, GoogleGenAI, Type } from "@google/genai";
import * as cheerio from "cheerio";
import { fetchPublicText } from "./safe-fetch";
import type { AiSummary, Entry, Recap } from "./types";

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

let _ai: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AiError("GEMINI_API_KEY is not set on the server.", 500);
  if (!_ai) _ai = new GoogleGenAI({ apiKey });
  return _ai;
}

export class AiError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

/** Turns Gemini SDK failures into short messages the page can show. */
function explain(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof ApiError) {
    if (e.status === 429) {
      return new AiError("Gemini free-tier limit reached. Wait a minute and try again.", 429);
    }
    if (e.status === 400 || e.status === 403) {
      return new AiError(
        "Gemini could not read this one. Videos must be public, and the API key must be valid.",
        422,
      );
    }
    if (e.status === 404) {
      return new AiError(`Model "${MODEL}" was not found. Set GEMINI_MODEL to a current model name.`, 500);
    }
  }
  return new AiError("Gemini did not return a usable answer. Try again.", 502);
}

const DISCLAIMER =
  "You are a study assistant for a retail trader keeping a learning journal. " +
  "Only report what the source itself says. Do not give financial advice, do not add price targets or trade calls of your own, " +
  "and do not invent details that are not in the source. Write plainly and keep every item short.";

const summarySchema = {
  type: Type.OBJECT,
  properties: {
    tldr: { type: Type.STRING, description: "2 to 3 sentences on what the source is about and its main claim." },
    points: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "4 to 7 key points, in the order the source makes them.",
    },
    takeaways: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Up to 3 concrete rules, setups or risk ideas the source teaches, worded as a trader would note them.",
    },
    watchOuts: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "Claims that are unproven, hype, guaranteed-profit language, cherry-picked results or missing risk caveats. Empty list when none.",
    },
  },
  required: ["tldr", "points", "takeaways", "watchOuts"],
};

function list(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter(Boolean)
        .slice(0, max)
    : [];
}

function parseJson(text: string | undefined): Record<string, unknown> {
  if (!text) throw new AiError("Gemini returned an empty answer. Try again.", 502);
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fall through */
      }
    }
    throw new AiError("Gemini returned something that was not valid JSON. Try again.", 502);
  }
}

function toSummary(o: Record<string, unknown>): AiSummary {
  const tldr = typeof o.tldr === "string" ? o.tldr.trim() : "";
  if (!tldr) throw new AiError("Gemini returned no summary. Try again.", 502);
  return {
    tldr,
    points: list(o.points, 12),
    takeaways: list(o.takeaways, 8),
    watchOuts: list(o.watchOuts, 8),
    model: MODEL,
    at: Date.now(),
  };
}

/* ---------- YouTube ---------- */

export function isYouTube(href: string): boolean {
  try {
    const host = new URL(href).hostname.replace(/^www\./, "").replace(/^m\./, "");
    return ["youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host);
  } catch {
    return false;
  }
}

async function youtubeTitle(href: string): Promise<string> {
  try {
    const res = await fetch(
      "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(href),
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return "";
    const j = (await res.json()) as { title?: string; author_name?: string };
    return [j.title, j.author_name ? `(${j.author_name})` : ""].filter(Boolean).join(" ");
  } catch {
    return "";
  }
}

export async function summarizeVideo(href: string): Promise<{ title: string; ai: AiSummary }> {
  try {
    const [title, res] = await Promise.all([
      youtubeTitle(href),
      ai().models.generateContent({
        model: MODEL,
        contents: [
          { fileData: { fileUri: href } },
          {
            text:
              "Summarize this trading or markets video for my learning journal. " +
              "Only use what is said or shown in the video.",
          },
        ],
        config: {
          systemInstruction: DISCLAIMER,
          responseMimeType: "application/json",
          responseSchema: summarySchema,
          temperature: 0.3,
        },
      }),
    ]);
    return { title, ai: toSummary(parseJson(res.text)) };
  } catch (e) {
    throw explain(e);
  }
}

/* ---------- Articles ---------- */

function extractArticle(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  const title =
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim();

  $("script, style, noscript, svg, iframe, form, nav, footer, header, aside, [role=navigation], [aria-hidden=true]").remove();

  const root = ["article", "main", "[role=main]", ".post-content", ".entry-content", ".article-body", "body"]
    .map((sel) => $(sel).first())
    .find((el) => el.length && el.text().trim().length > 400);

  const raw = (root ?? $("body")).text();
  const text = raw
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

export async function summarizeArticle(href: string): Promise<{ title: string; ai: AiSummary }> {
  let page;
  try {
    page = await fetchPublicText(href);
  } catch (e) {
    throw new AiError(e instanceof Error ? e.message : "Could not fetch that page.", 422);
  }
  const { title, text } = /html|xml/i.test(page.contentType)
    ? extractArticle(page.text)
    : { title: "", text: page.text.trim() };

  if (text.length < 200) {
    throw new AiError(
      "That page has almost no readable text (it may need JavaScript or a login). Paste your own notes instead.",
      422,
    );
  }

  try {
    const res = await ai().models.generateContent({
      model: MODEL,
      contents:
        "Summarize this trading or markets article for my learning journal. Only use the text below.\n\n" +
        `TITLE: ${title || "(none)"}\nURL: ${page.finalUrl}\n\nTEXT:\n${text.slice(0, 60000)}`,
      config: {
        systemInstruction: DISCLAIMER,
        responseMimeType: "application/json",
        responseSchema: summarySchema,
        temperature: 0.3,
      },
    });
    return { title, ai: toSummary(parseJson(res.text)) };
  } catch (e) {
    throw explain(e);
  }
}

/* ---------- Day recap ---------- */

const recapSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING, description: "3 to 4 sentences: what today's study added up to." },
    gaps: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "Up to 5 important points from the sources that the person's own notes and takeaways do not mention yet.",
    },
    questions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "3 to 5 short self-test questions the person should be able to answer a week from now.",
    },
  },
  required: ["summary", "gaps", "questions"],
};

export async function recapDay(entry: Entry): Promise<Recap> {
  const sources = entry.sources
    .map((s, i) => {
      const lines = [`SOURCE ${i + 1} (${s.type}): ${s.title || s.url}`];
      if (s.ai) lines.push(`AI summary: ${s.ai.tldr}`, ...s.ai.points.map((p) => `- ${p}`));
      if (s.note.trim()) lines.push(`My own notes on it: ${s.note.trim()}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const mine = [
    entry.learned.trim() && `MY NOTES FOR THE DAY:\n${entry.learned.trim()}`,
    entry.takeaways.length &&
      `MY TAKEAWAYS:\n${entry.takeaways.map((t) => `- ${t.star ? "[RULE] " : ""}${t.text}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!sources && !mine) {
    throw new AiError("Add a source or some notes first, then ask for a recap.", 422);
  }

  try {
    const res = await ai().models.generateContent({
      model: MODEL,
      contents:
        `Date: ${entry.date}\n\n${sources || "(no sources logged)"}\n\n${mine || "(no personal notes yet)"}\n\n` +
        "Write a recap of this study session. Compare my own notes against the sources and point out what I have not captured yet.",
      config: {
        systemInstruction: DISCLAIMER,
        responseMimeType: "application/json",
        responseSchema: recapSchema,
        temperature: 0.4,
      },
    });
    const o = parseJson(res.text);
    const summary = typeof o.summary === "string" ? o.summary.trim() : "";
    if (!summary) throw new AiError("Gemini returned no recap. Try again.", 502);
    return { summary, gaps: list(o.gaps, 6), questions: list(o.questions, 6), at: Date.now() };
  } catch (e) {
    throw explain(e);
  }
}
