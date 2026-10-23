# Trading Journal

A private daily trading journal. Each day is a session where you:

- paste the **YouTube videos and blog posts** you studied,
- press **Summarize with Gemini** to get a short summary, key points, suggested takeaways and "watch out" flags,
- write **your own version** in a box right beside the AI summary,
- keep **notes, starred takeaways and tags** for the day,
- generate a **day recap** that compares your notes with the sources and lists what you have not captured yet, plus a few questions to test yourself.

Built with Next.js (App Router), MongoDB Atlas, and the Gemini API. It deploys to Vercel as one project.

## How it fits together

| Piece | What it does |
| --- | --- |
| `components/Journal.tsx` | The whole interface. Autosaves after you stop typing. |
| `app/api/entries` | Reads and saves one entry per date in MongoDB. |
| `app/api/summarize` | Sends a YouTube link straight to Gemini, or downloads a blog page, strips it to text, and sends that. |
| `app/api/recap` | Asks Gemini to compare your notes with the sources. |
| `proxy.ts` | Blocks every page and API route unless you are signed in. |
| `lib/safe-fetch.ts` | Refuses links that point at private or internal addresses before downloading a page. |

Vercel runs the API routes as serverless functions, so there is no separate Express server to host. That replaces the "E" in MERN.

## What you need (all free)

1. **MongoDB Atlas** free cluster: https://www.mongodb.com/cloud/atlas
   - Create a database user and copy the connection string.
   - Under **Network Access**, allow `0.0.0.0/0`. Vercel's addresses change, so a fixed allow list will not work.
2. **Gemini API key**: https://aistudio.google.com/apikey
3. A **Vercel** account and a GitHub account.

## Run it on your computer

```bash
npm install
cp .env.example .env.local     # then fill in the values
npm run dev
```

Open http://localhost:3000 and sign in with the `APP_PASSWORD` you chose.

## Deploy to Vercel

1. Create a new GitHub repository and push this folder to it:
   ```bash
   git init
   git add .
   git commit -m "Trading journal"
   git branch -M main
   git remote add origin https://github.com/YOUR_NAME/trading-journal.git
   git push -u origin main
   ```
2. In Vercel choose **Add New > Project**, import the repository, and leave the framework as **Next.js**.
3. Before the first deploy, open **Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `MONGODB_URI` | your Atlas connection string |
   | `MONGODB_DB` | `trading_journal` |
   | `GEMINI_API_KEY` | your key |
   | `GEMINI_MODEL` | `gemini-3.8-flash` (optional) |
   | `APP_PASSWORD` | the password you will type to sign in |
   | `SESSION_SECRET` | a long random string, from `openssl rand -base64 32` |

4. Press **Deploy**. Open the URL, sign in, and log your first session.

## Things to know

- **Videos must be public.** Gemini cannot read private or unlisted YouTube videos. The free tier covers about 8 hours of YouTube video per day.
- **Long videos are slow.** Summaries run for up to 60 seconds, which is the Hobby plan limit set in `app/api/summarize/route.ts`. If a long video times out, summarize a shorter one or write your own notes.
- **Some blogs cannot be read.** Pages that need JavaScript or a login come back nearly empty, and the app tells you so.
- **Free-tier rate limits** apply. If you see a limit message, wait a minute.
- **If Google retires the model**, set `GEMINI_MODEL` to a current name from https://ai.google.dev/gemini-api/docs/models and redeploy.
- **AI summaries are study aids, not advice.** The prompts tell Gemini to report only what the source says and to flag hype, but check anything you plan to trade on.
- **This is a one-person app.** There is one shared password and one journal. Use a long password.
- **Export Markdown** in the top bar downloads your whole journal, including AI summaries and your versions, as a backup.

## Project layout

```
app/
  api/           entries, summarize, recap, login, logout
  login/         password page
  page.tsx       renders the journal
components/Journal.tsx
lib/             db, auth, gemini, safe-fetch, sanitize, types
proxy.ts         sign-in check for every request
```
