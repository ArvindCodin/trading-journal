"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { cleanUrl, detectType, entryHasContent } from "@/lib/sanitize";
import type { Entry, Source } from "@/lib/types";

/* ---------- small helpers ---------- */

const PRESET_TAGS = ["Price action", "Risk", "Psychology", "Options", "Setups", "Macro", "Indicators", "Backtesting"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const todayStr = () => ymd(new Date());
const longDate = (s: string) => {
  const d = parse(s);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
};
const isDateStr = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parse(s).getTime());
const uid = () => Math.random().toString(36).slice(2, 10);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function display(href: string): string {
  try {
    const u = new URL(href);
    return u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname) + u.search;
  } catch {
    return href;
  }
}

const blank = (date: string): Entry => ({
  date,
  sources: [],
  learned: "",
  takeaways: [],
  tags: [],
  updatedAt: 0,
});

const hasContent = (e: Entry) => entryHasContent(e);
const hasTag = (list: string[], t: string) => list.some((x) => x.toLowerCase() === t.toLowerCase());

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Not signed in");
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error || "Something went wrong.");
  return j as T;
}

function Auto({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />;
}

const XIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);
const StarIcon = ({ on }: { on: boolean }) => (
  <svg width="17" height="17" viewBox="0 0 20 20" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill={on ? "currentColor" : "none"}>
    <path d="m10 2.6 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 7.9l5-.7z" />
  </svg>
);

type Status = "loading" | "saved" | "pending" | "saving" | "error";

/* ---------- component ---------- */

export default function Journal() {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [date, setDate] = useState("");
  const [doc, setDoc] = useState<Entry>(blank(""));
  const [all, setAll] = useState<Record<string, Entry>>({});
  const [status, setStatus] = useState<Status>("loading");

  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkMsg, setLinkMsg] = useState("");
  const [tkText, setTkText] = useState("");
  const [tagText, setTagText] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [aiErr, setAiErr] = useState<Record<string, string>>({});
  const [recapBusy, setRecapBusy] = useState(false);
  const [recapErr, setRecapErr] = useState("");
  const [armed, setArmed] = useState(false);
  const [navMsg, setNavMsg] = useState("");

  const docRef = useRef<Entry>(doc);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const armTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dayTop = useRef<HTMLElement>(null);

  /* ----- saving ----- */

  const doSave = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    setStatus("saving");
    const d = docRef.current;
    try {
      const j = await api<{ entry: Entry | null }>(`/api/entries/${d.date}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(d),
      });
      setAll((prev) => {
        const next = { ...prev };
        if (j.entry) next[d.date] = j.entry;
        else delete next[d.date];
        return next;
      });
      if (!dirty.current) setStatus("saved");
    } catch {
      dirty.current = true;
      setStatus("error");
    }
  }, []);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    chain.current = chain.current.then(doSave);
    return chain.current;
  }, [doSave]);

  const schedule = useCallback(() => {
    dirty.current = true;
    setStatus("pending");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush();
    }, 900);
  }, [flush]);

  const edit = useCallback(
    (fn: (d: Entry) => Entry) => {
      const next = fn(docRef.current);
      docRef.current = next;
      setDoc(next);
      schedule();
    },
    [schedule],
  );

  /* ----- load ----- */

  const load = useCallback(async () => {
    setLoadError("");
    setStatus("loading");
    try {
      const j = await api<{ entries: Entry[] }>("/api/entries");
      const map: Record<string, Entry> = {};
      j.entries.forEach((e) => (map[e.date] = e));
      const t = todayStr();
      const first = map[t] ?? blank(t);
      docRef.current = first;
      setAll(map);
      setDate(t);
      setDoc(first);
      setReady(true);
      setStatus("saved");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load your journal.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onHide = () => {
      if (document.hidden && dirty.current) void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flush]);

  /* ----- navigation ----- */

  const aiBusy = recapBusy || Object.values(busy).some(Boolean);

  const openDate = useCallback(
    async (target: string, fromRail = false) => {
      if (!isDateStr(target) || target > todayStr() || target === docRef.current.date) return;
      if (aiBusy) {
        setNavMsg("Wait for the AI request to finish before changing day.");
        return;
      }
      setNavMsg("");
      await flush();
      if (dirty.current) return; // last save failed: stay here so nothing is lost
      const next = all[target] ?? blank(target);
      docRef.current = next;
      setDate(target);
      setDoc(next);
      setLinkMsg("");
      setRecapErr("");
      setArmed(false);
      if (fromRail && window.innerWidth < 860) dayTop.current?.scrollIntoView({ block: "start" });
    },
    [aiBusy, all, flush],
  );

  /* ----- sources ----- */

  function addLinks(e: FormEvent) {
    e.preventDefault();
    const parts = linkText.split(/[\s,]+/).filter(Boolean);
    if (!parts.length) return;
    const fresh: Source[] = [];
    let bad = 0;
    let dup = 0;
    const have = new Set(docRef.current.sources.map((s) => s.url));
    for (const p of parts) {
      const href = cleanUrl(p);
      if (!href) {
        bad++;
        continue;
      }
      if (have.has(href)) {
        dup++;
        continue;
      }
      have.add(href);
      fresh.push({ id: uid(), url: href, title: "", type: detectType(href), note: "" });
    }
    if (fresh.length) {
      edit((d) => ({ ...d, sources: [...d.sources, ...fresh] }));
      setLinkText("");
    }
    if (!fresh.length) {
      setLinkMsg(bad ? "That does not look like a link. Paste a full address such as youtube.com/watch?v=..." : "That link is already in this session.");
    } else if (bad || dup) {
      setLinkMsg(`Added ${plural(fresh.length, "link")}. Skipped ${bad + dup}.`);
    } else {
      setLinkMsg("");
    }
  }

  const patchSource = (id: string, patch: Partial<Source>) =>
    edit((d) => ({ ...d, sources: d.sources.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  async function summarize(src: Source) {
    if (busy[src.id]) return;
    setBusy((b) => ({ ...b, [src.id]: true }));
    setAiErr((m) => ({ ...m, [src.id]: "" }));
    try {
      const j = await api<{ title: string; ai: NonNullable<Source["ai"]> }>("/api/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: src.url }),
      });
      edit((d) => ({
        ...d,
        sources: d.sources.map((s) => (s.id === src.id ? { ...s, ai: j.ai, title: s.title || j.title || "" } : s)),
      }));
    } catch (e) {
      setAiErr((m) => ({ ...m, [src.id]: e instanceof Error ? e.message : "Could not summarize." }));
    } finally {
      setBusy((b) => ({ ...b, [src.id]: false }));
    }
  }

  function addTakeaway(text: string) {
    const t = text.trim();
    if (!t) return;
    edit((d) =>
      d.takeaways.some((x) => x.text.trim().toLowerCase() === t.toLowerCase())
        ? d
        : { ...d, takeaways: [...d.takeaways, { id: uid(), text: t, star: false }] },
    );
  }

  function copyIntoMine(src: Source) {
    if (!src.ai) return;
    const text = [src.ai.tldr, ...src.ai.points.map((p) => `- ${p}`)].join("\n");
    patchSource(src.id, { note: src.note.trim() ? `${src.note.trim()}\n\n${text}` : text });
  }

  /* ----- recap ----- */

  async function makeRecap() {
    if (recapBusy) return;
    setRecapBusy(true);
    setRecapErr("");
    try {
      const j = await api<{ recap: NonNullable<Entry["recap"]> }>("/api/recap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(docRef.current),
      });
      edit((d) => ({ ...d, recap: j.recap }));
    } catch (e) {
      setRecapErr(e instanceof Error ? e.message : "Could not write the recap.");
    } finally {
      setRecapBusy(false);
    }
  }

  /* ----- misc actions ----- */

  async function clearDay() {
    if (!armed) {
      setArmed(true);
      clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    setArmed(false);
    clearTimeout(timer.current);
    await chain.current;
    dirty.current = false;
    const d = docRef.current.date;
    const empty = blank(d);
    docRef.current = empty;
    setDoc(empty);
    try {
      await api(`/api/entries/${d}`, { method: "DELETE" });
      setAll((prev) => {
        const next = { ...prev };
        delete next[d];
        return next;
      });
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  function exportMd() {
    const merged = { ...all, [docRef.current.date]: docRef.current };
    const list = Object.values(merged).filter(hasContent).sort((a, b) => b.date.localeCompare(a.date));
    const out: string[] = ["# Trading Journal", ""];
    for (const e of list) {
      out.push(`## ${longDate(e.date)}`);
      if (e.tags.length) out.push(`Tags: ${e.tags.join(", ")}`);
      out.push("");
      if (e.sources.length) {
        out.push("### Sources", "");
        for (const s of e.sources) {
          out.push(`- [${s.title || display(s.url)}](${s.url}) (${s.type})`);
          if (s.ai) out.push(`  - AI summary: ${s.ai.tldr}`);
          if (s.note.trim()) out.push(`  - My version: ${s.note.trim().replace(/\n+/g, " ")}`);
        }
        out.push("");
      }
      if (e.learned.trim()) out.push("### What I learned", "", e.learned.trim(), "");
      if (e.takeaways.length) {
        out.push("### What matters", "");
        e.takeaways.forEach((t) => out.push(`- ${t.star ? "[RULE] " : ""}${t.text}`));
        out.push("");
      }
      if (e.recap) {
        out.push("### Recap", "", e.recap.summary, "");
      }
    }
    const blob = new Blob([out.join("\n")], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trading-journal-${todayStr()}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function signOut() {
    await flush();
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  /* ----- derived ----- */

  const merged = useMemo(() => {
    const m = { ...all };
    if (doc.date) {
      if (hasContent(doc)) m[doc.date] = doc;
      else delete m[doc.date];
    }
    return m;
  }, [all, doc]);

  const sessions = useMemo(
    () => Object.values(merged).filter(hasContent).sort((a, b) => b.date.localeCompare(a.date)),
    [merged],
  );

  const streak = useMemo(() => {
    const set = new Set(sessions.map((s) => s.date));
    let d = todayStr();
    if (!set.has(d)) d = addDays(d, -1);
    let n = 0;
    while (set.has(d)) {
      n++;
      d = addDays(d, -1);
    }
    return n;
  }, [sessions]);

  const sourceCount = sessions.reduce((n, s) => n + s.sources.length, 0);

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    sessions.forEach((s) => s.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [sessions]);

  const knownTags = useMemo(() => {
    const seen = new Map<string, string>();
    [...PRESET_TAGS, ...sessions.flatMap((s) => s.tags), ...doc.tags].forEach((t) => {
      if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    });
    return Array.from(seen.values());
  }, [sessions, doc.tags]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sessions.filter((s) => {
      if (tagFilter && !hasTag(s.tags, tagFilter)) return false;
      if (!needle) return true;
      const hay = [
        s.learned,
        s.tags.join(" "),
        s.takeaways.map((t) => t.text).join(" "),
        s.sources.map((x) => `${x.title} ${x.url} ${x.note} ${x.ai?.tldr ?? ""}`).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [sessions, q, tagFilter]);

  /* ----- render ----- */

  const statusText: Record<Status, string> = {
    loading: "Loading…",
    saved: "Saved",
    pending: "Unsaved changes",
    saving: "Saving…",
    error: "Not saved",
  };

  if (!ready) {
    return (
      <div className="app">
        <header className="top">
          <div className="brand"><h1>Trading Journal</h1></div>
        </header>
        {loadError ? (
          <div className="panel-msg" role="alert">
            <p>{loadError}</p>
            <p className="hint">Check that MONGODB_URI is set and that Atlas allows connections from Vercel (Network Access).</p>
            <button className="btn primary" type="button" onClick={() => void load()}>Try again</button>
          </div>
        ) : (
          <p className="hint">Loading your journal…</p>
        )}
      </div>
    );
  }

  const today = todayStr();
  const isToday = date === today;
  const vids = doc.sources.filter((s) => s.type === "video").length;
  const arts = doc.sources.length - vids;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg className="mark" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
            <path d="M7 3v22M14 6v18M21 2v19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
            <rect className="c2" x="4" y="9" width="6" height="9" rx="1" />
            <rect className="c1" x="11" y="11" width="6" height="8" rx="1" />
            <rect className="c2" x="18" y="6" width="6" height="9" rx="1" />
          </svg>
          <h1>Trading Journal</h1>
        </div>
        <div className="top-actions">
          <span className="status" role="status" aria-live="polite" data-s={status === "saving" || status === "pending" ? "pending" : status}>
            <i />
            <span>{statusText[status]}</span>
          </span>
          {status === "error" && (
            <button className="btn sm" type="button" onClick={() => void flush()}>Retry save</button>
          )}
          <button className="btn sm" type="button" onClick={exportMd}>Export Markdown</button>
          <button className="btn sm" type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>

      <div className="layout">
        <main className="day" ref={dayTop} aria-labelledby="dayTitle">
          <div className="day-head">
            <div className="datenav">
              <button className="ico" type="button" aria-label="Previous day" onClick={() => void openDate(addDays(date, -1))}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 3.5 5.5 9l5.5 5.5" /></svg>
              </button>
              <div>
                <p className="eyebrow">{isToday ? "Today’s session" : "Session"}</p>
                <h2 className="dtitle" id="dayTitle">{longDate(date)}</h2>
              </div>
              <button className="ico" type="button" aria-label="Next day" disabled={date >= today} onClick={() => void openDate(addDays(date, 1))}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m7 3.5 5.5 5.5L7 14.5" /></svg>
              </button>
            </div>
            <div className="day-tools">
              <label className="sr" htmlFor="dateJump">Jump to a date</label>
              <input
                id="dateJump"
                className="field"
                type="date"
                value={date}
                max={today}
                onChange={(e) => void openDate(e.target.value)}
              />
              {!isToday && (
                <button className="btn sm" type="button" onClick={() => void openDate(today)}>Back to today</button>
              )}
            </div>
          </div>
          {navMsg && <p className="err" role="alert" style={{ padding: "0 20px 12px", margin: 0 }}>{navMsg}</p>}

          {/* Sources */}
          <section className="block" aria-labelledby="hSources">
            <div className="bh">
              <h3 id="hSources">Sources</h3>
              <span className="hint">
                {doc.sources.length ? [vids ? plural(vids, "video") : "", arts ? plural(arts, "article") : ""].filter(Boolean).join(" · ") : ""}
              </span>
            </div>
            <form className="addrow" onSubmit={addLinks} autoComplete="off">
              <label className="sr" htmlFor="linkInput">Link to a video or article</label>
              <input
                id="linkInput"
                className="field"
                type="text"
                inputMode="url"
                placeholder="Paste a YouTube or blog link"
                value={linkText}
                onChange={(e) => {
                  setLinkText(e.target.value);
                  setLinkMsg("");
                }}
              />
              <button className="btn primary" type="submit">Add</button>
            </form>
            {linkMsg && <p className="err" role="alert">{linkMsg}</p>}

            {doc.sources.length === 0 ? (
              <p className="empty">Nothing logged yet for this session. Paste the video or article you studied, then let Gemini summarize it and write your own version beside it.</p>
            ) : (
              <ul className="blotter">
                {doc.sources.map((s) => (
                  <li className="src" key={s.id}>
                    <div className="src-head">
                      <button
                        type="button"
                        className={`chip ${s.type}`}
                        aria-label={`Type: ${s.type === "video" ? "Video" : "Article"}. Press to switch.`}
                        onClick={() => patchSource(s.id, { type: s.type === "video" ? "article" : "video" })}
                      >
                        {s.type === "video" ? "Video" : "Article"}
                      </button>
                      <div className="src-main">
                        <input
                          type="text"
                          className="ghost src-title"
                          aria-label="Title"
                          placeholder="Add a title"
                          value={s.title}
                          maxLength={300}
                          onChange={(e) => patchSource(s.id, { title: e.target.value })}
                        />
                        <a className="src-url" href={s.url} target="_blank" rel="noopener noreferrer" title={s.url}>
                          {display(s.url)}
                        </a>
                      </div>
                      <button
                        type="button"
                        className="ico"
                        aria-label="Remove source"
                        onClick={() => edit((d) => ({ ...d, sources: d.sources.filter((x) => x.id !== s.id) }))}
                      >
                        <XIcon />
                      </button>
                    </div>

                    <div className="src-actions">
                      <button className="btn sm" type="button" disabled={!!busy[s.id]} onClick={() => void summarize(s)}>
                        {busy[s.id] ? "Reading…" : s.ai ? "Summarize again" : "Summarize with Gemini"}
                      </button>
                      {busy[s.id] && <span className="hint">{s.type === "video" ? "Watching the video, this can take up to a minute." : "Reading the page."}</span>}
                      {s.ai && !busy[s.id] && <span className="meta">{s.ai.model}</span>}
                    </div>
                    {aiErr[s.id] && <p className="err" role="alert" style={{ marginTop: 0 }}>{aiErr[s.id]}</p>}

                    <div className="pair">
                      {s.ai && (
                        <div className="pane ai">
                          <h4>AI summary</h4>
                          <p className="tldr">{s.ai.tldr}</p>
                          {s.ai.points.length > 0 && (
                            <details>
                              <summary>Key points ({s.ai.points.length})</summary>
                              <ul className="pts">{s.ai.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
                            </details>
                          )}
                          {s.ai.takeaways.length > 0 && (
                            <ul className="sugg" aria-label="Suggested takeaways">
                              {s.ai.takeaways.map((t, i) => (
                                <li key={i}>
                                  <span>{t}</span>
                                  <button className="btn sm" type="button" onClick={() => addTakeaway(t)}>Add</button>
                                </li>
                              ))}
                            </ul>
                          )}
                          {s.ai.watchOuts.length > 0 && (
                            <div className="warn">
                              <b>Watch out</b>
                              <ul>{s.ai.watchOuts.map((w, i) => <li key={i}>{w}</li>)}</ul>
                            </div>
                          )}
                          <p style={{ marginTop: 10 }}>
                            <button className="btn sm" type="button" onClick={() => copyIntoMine(s)}>Copy into my version</button>
                          </p>
                        </div>
                      )}
                      <div className="pane">
                        <h4>My version</h4>
                        <Auto
                          aria-label="My version of what this source taught me"
                          placeholder="In your own words: what did this teach you, and what would you do differently?"
                          value={s.note}
                          maxLength={8000}
                          onChange={(v) => patchSource(s.id, { note: v })}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Notes */}
          <section className="block" aria-labelledby="hLearned">
            <div className="bh"><h3 id="hLearned">What I learned</h3></div>
            <label className="sr" htmlFor="learned">Notes on what you learned</label>
            <textarea
              id="learned"
              className="field"
              placeholder="A setup that worked, a mistake you made, a rule you want to keep. For example: waited for the retest of the breakout level instead of chasing the first candle, and the stop was half the size."
              value={doc.learned}
              maxLength={30000}
              onChange={(e) => edit((d) => ({ ...d, learned: e.target.value }))}
            />
          </section>

          {/* Takeaways */}
          <section className="block" aria-labelledby="hMatters">
            <div className="bh"><h3 id="hMatters">What matters</h3><span className="hint">Star the ones that are rules.</span></div>
            <form
              className="addrow"
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                addTakeaway(tkText);
                setTkText("");
              }}
            >
              <label className="sr" htmlFor="tkInput">Add a takeaway</label>
              <input id="tkInput" className="field" type="text" placeholder="Size down after two stop-outs in a row" value={tkText} onChange={(e) => setTkText(e.target.value)} />
              <button className="btn primary" type="submit">Add</button>
            </form>
            {doc.takeaways.length === 0 ? (
              <p className="empty">Short, specific points you want to see again next week.</p>
            ) : (
              <ul className="takes">
                {doc.takeaways.map((t) => (
                  <li className="take" key={t.id} data-star={t.star ? "true" : "false"}>
                    <button
                      type="button"
                      className="ico star"
                      aria-pressed={t.star}
                      aria-label="Mark as a rule to keep"
                      onClick={() => edit((d) => ({ ...d, takeaways: d.takeaways.map((x) => (x.id === t.id ? { ...x, star: !x.star } : x)) }))}
                    >
                      <StarIcon on={t.star} />
                    </button>
                    <Auto
                      rows={1}
                      aria-label="Takeaway"
                      value={t.text}
                      maxLength={1000}
                      onChange={(v) => edit((d) => ({ ...d, takeaways: d.takeaways.map((x) => (x.id === t.id ? { ...x, text: v } : x)) }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                    />
                    <button type="button" className="ico" aria-label="Remove takeaway" onClick={() => edit((d) => ({ ...d, takeaways: d.takeaways.filter((x) => x.id !== t.id) }))}>
                      <XIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Recap */}
          <section className="block" aria-labelledby="hRecap">
            <div className="bh">
              <h3 id="hRecap">Day recap</h3>
              <button className="btn sm" type="button" disabled={recapBusy || !(doc.sources.length || doc.learned.trim() || doc.takeaways.length)} onClick={() => void makeRecap()}>
                {recapBusy ? "Writing…" : doc.recap ? "Regenerate recap" : "Generate recap"}
              </button>
            </div>
            {recapErr && <p className="err" role="alert">{recapErr}</p>}
            {doc.recap ? (
              <div className="recap">
                <p className="sum">{doc.recap.summary}</p>
                <div className="recap-cols">
                  {doc.recap.gaps.length > 0 && (
                    <div>
                      <h4>Not in your notes yet</h4>
                      <ul>{doc.recap.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
                    </div>
                  )}
                  {doc.recap.questions.length > 0 && (
                    <div>
                      <h4>Test yourself</h4>
                      <ul>{doc.recap.questions.map((g, i) => <li key={i}>{g}</li>)}</ul>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="empty">Gemini compares your own notes with the sources and points out what you have not captured yet.</p>
            )}
          </section>

          {/* Tags */}
          <section className="block" aria-labelledby="hTags">
            <div className="bh"><h3 id="hTags">Tags</h3></div>
            <div className="chips">
              {knownTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="tag"
                  aria-pressed={hasTag(doc.tags, t)}
                  onClick={() =>
                    edit((d) => ({
                      ...d,
                      tags: hasTag(d.tags, t) ? d.tags.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...d.tags, t],
                    }))
                  }
                >
                  {t}
                </button>
              ))}
            </div>
            <form
              className="tagform"
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                const v = tagText.trim().replace(/\s+/g, " ");
                if (!v) return;
                edit((d) => (hasTag(d.tags, v) ? d : { ...d, tags: [...d.tags, v] }));
                setTagText("");
              }}
            >
              <label className="sr" htmlFor="tagInput">Add a custom tag</label>
              <input id="tagInput" className="field" style={{ width: "100%" }} type="text" maxLength={24} placeholder="Add a tag, press Enter" value={tagText} onChange={(e) => setTagText(e.target.value)} />
            </form>
          </section>

          <div className="foot">
            {hasContent(doc) ? (
              <button className={`btn sm danger${armed ? " armed" : ""}`} type="button" onClick={() => void clearDay()}>
                {armed ? "Press again to delete this session" : "Delete this session"}
              </button>
            ) : (
              <span />
            )}
          </div>
        </main>

        <aside className="rail" aria-labelledby="hRail">
          <div className="rail-head"><h2 className="rt" id="hRail">Sessions</h2></div>
          <p className="facts">
            <span><b>{sessions.length}</b> {sessions.length === 1 ? "session" : "sessions"}</span>
            <span><b>{streak}</b> day streak</span>
            <span><b>{sourceCount}</b> {sourceCount === 1 ? "source" : "sources"}</span>
          </p>
          <label className="sr" htmlFor="q">Search sessions</label>
          <input id="q" className="field" type="search" placeholder="Search notes, links, takeaways" value={q} onChange={(e) => setQ(e.target.value)} />
          {tagCounts.length > 0 && (
            <div className="chips">
              {tagCounts.map(([t, n]) => (
                <button key={t} type="button" className="tag" aria-pressed={tagFilter === t} onClick={() => setTagFilter(tagFilter === t ? "" : t)}>
                  {t} {n}
                </button>
              ))}
            </div>
          )}
          <div className="sess-wrap">
            {visible.length > 0 && (
              <ol className="sessions">
                {visible.map((e) => {
                  const d = parse(e.date);
                  const v = e.sources.filter((s) => s.type === "video").length;
                  const a = e.sources.length - v;
                  const bits = [v ? plural(v, "video") : "", a ? plural(a, "article") : ""].filter(Boolean);
                  const starred = e.takeaways.find((t) => t.star);
                  const preview =
                    starred?.text || e.takeaways[0]?.text || e.learned.trim().split("\n")[0] || e.sources[0]?.title || (e.sources[0] ? display(e.sources[0].url) : "");
                  return (
                    <li key={e.date}>
                      <button type="button" className="sess" aria-current={e.date === date} onClick={() => void openDate(e.date, true)}>
                        <div className="sd"><b>{d.getDate()}</b><span>{MON[d.getMonth()]} {DOW[d.getDay()]}</span></div>
                        <div>
                          <p className="sm">{bits.length ? bits.join(" · ") : "notes only"}</p>
                          <p className={`sp${preview ? "" : " dim"}`}>{preview || "No notes yet"}</p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            {visible.length === 0 && (
              <p className="empty">{sessions.length ? "No sessions match." : "Saved days will list here. Log your first video or article to start the journal."}</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
