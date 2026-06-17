# HIVEDX Event Clearcoms — Setup Guide for Non-Coders

This guide takes you from zero to a working web app that you and your event crew can use to talk to each other live, just like wireless ClearCom headphones — but through any phone or laptop browser.

**Total time:** about 30–45 minutes the first time.
**Cost:** ₹0 / $0. Everything below uses free tiers.
**You'll need:** an email address, a credit/debit card is **NOT** required.

---

## What we're actually building

You're stitching together three free services:

| What | Why we need it | Where it lives |
|---|---|---|
| **LiveKit Cloud** | This does the hard part — moving live audio between everyone's phones in real time. | livekit.io/cloud |
| **GitHub** | A place to keep your app's code, like Google Drive but for code. | github.com |
| **Vercel** | This puts your app on the internet so anyone can open it in a browser. | vercel.com |

Your app's code is in this folder. We just need to upload it to GitHub, then tell Vercel to publish it, then plug in the LiveKit credentials.

---

## Step 1 — Create a LiveKit Cloud account (10 minutes)

LiveKit is what makes the voice actually flow between everyone.

1. Open **https://cloud.livekit.io** in your browser.
2. Click **Sign up**. Use Google or your email — easiest is Google.
3. After signing in, it'll ask you to **create a project**. Pick a name like `hivedx-clearcoms` and a region closest to your team (e.g., Singapore for India/SE Asia events).
4. Once the project opens, look at the left sidebar and click **Settings → Keys**.
5. Click **Create new key**. Give it any name like "main".
6. You'll see a popup with three things. **Copy all three into a notepad — you'll need them in Step 4.** They look like this:
   - **API Key** — starts with `API…`
   - **API Secret** — a long random string, only shown once! If you miss it, just create a new key.
   - **WebSocket URL** (or "Project URL") — looks like `wss://hivedx-clearcoms-xxxxx.livekit.cloud`

Keep this notepad open. Don't share these with anyone.

---

## Step 2 — Put the code on GitHub (10 minutes)

GitHub is just where Vercel reads your code from. You don't need to know any Git commands — we're using the website.

1. Go to **https://github.com** and click **Sign up**. Use the same email if you like.
2. After verifying your email, click the **+** icon at the top right → **New repository**.
3. Fill it in:
   - **Repository name:** `hivedx-clearcoms`
   - **Private** (recommended)
   - **Don't** check any of the "Add README" boxes
   - Click **Create repository**
4. On the next page, click the link **"uploading an existing file"**.
5. Open the folder I made for you in Finder/File Explorer. **Select all the files inside** (`index.html`, `app.js`, `package.json`, `.gitignore`, the `api` folder, etc.) and drag them into the GitHub upload box.
   - ⚠️ Make sure you upload the `api` *folder* too — the file `token.js` lives inside it. If you only uploaded the files at the top, click **choose your files** and add the `api/token.js` file separately, keeping the path `api/token.js`.
6. Scroll down and click **Commit changes**.

That's it — your code is now on GitHub.

---

## Step 3 — Connect Vercel to your GitHub (5 minutes)

1. Go to **https://vercel.com** and click **Sign Up**.
2. Choose **Continue with GitHub** — this links the two automatically.
3. After signup, you'll land on the dashboard. Click **Add New… → Project**.
4. You'll see a list of your GitHub repositories. Click **Import** next to `hivedx-clearcoms`.

---

## Step 4 — Plug in the LiveKit credentials (5 minutes)

This is where most beginners trip up — pay close attention.

You'll be on the "Configure Project" screen on Vercel. **Before clicking Deploy:**

1. Find the section **Environment Variables** (you may need to expand it).
2. Add these three rows, one at a time. Copy the value from the notepad you saved in Step 1.

| Name (exact spelling matters!) | Value |
|---|---|
| `LIVEKIT_API_KEY` | the API Key from Step 1 |
| `LIVEKIT_API_SECRET` | the API Secret from Step 1 |
| `LIVEKIT_WS_URL` | the WebSocket URL from Step 1 (starts with `wss://`) |

3. After all three are added, click **Deploy**.
4. Wait about 30–60 seconds. You'll see a celebration screen with a confetti/preview when it's done.

Click **Visit** or **Continue to Dashboard** — you'll see your app's public URL like `hivedx-clearcoms.vercel.app`.

---

## Step 5 — Test it with your team (5 minutes)

1. Open your app's URL on your phone or laptop.
2. Click **Enter** → **Create an Event**. Fill it in. Click **Generate Event Code**.
3. **Copy the event code** that appears.
4. Click **Enter Event** to enter the lobby. **Allow microphone access** when the browser asks.
5. Send the URL + the event code to a teammate via WhatsApp/SMS.
6. Have them open the URL on *their* phone, click **Join an Event**, paste the code, enter their name, and click **Enter Event**.
7. Now you'll both see each other in the lobby.
8. Both click **🎙️ Join the Conversation** → start talking.
9. Try the **🔇 Mute** and **📞 End** buttons.
10. Back in the lobby, try **➕ Create Private Channel** to pull a sub-group into a separate conversation.

You're done!

---

## How the screens map to what you asked for

| Screen | What it is | Where it is in code |
|---|---|---|
| 1. HIVEDX welcome | Click Enter | `index.html`, `<div id="screen-welcome">` |
| 2. Create vs Join | Two buttons | `<div id="screen-choice">` |
| 3. Create event form + generated code | Form → code reveal | `screen-create` and `screen-created` |
| 4. Join event form | Code + name | `screen-join` |
| 5. Lobby + members + private channel button | Names list, "Join the Conversation" button | `screen-lobby` |
| 6. Live conversation with mute + end | Talking screen | `screen-talk` |

---

## Common problems and how to fix them

**"Microphone error" / no sound**
The browser blocks mic access by default. On the URL bar there's usually a small lock icon — click it and set Microphone to **Allow**, then refresh the page.

**"Token server: Server is missing LIVEKIT_API_KEY..."**
Step 4 didn't take. Go to Vercel → your project → **Settings → Environment Variables**. Check spelling carefully (must be UPPERCASE with underscores, no spaces). After fixing, go to **Deployments → … → Redeploy**.

**Both people can hear, but with delay or echo**
This is normal if you're in the same physical room — both phones pick up each other's speakers. Wear headphones (any wired or Bluetooth earbuds) to fix it. This is exactly the same in a real ClearCom — they always use headsets.

**"Can't see the other person in the lobby"**
Both must enter the **same event code** and both must click **Enter Event** (not just stay on Screen 4). If still not showing, refresh both browsers.

**iPhone Safari quirks**
Safari sometimes silences audio until the user taps the screen first. After clicking "Join the Conversation", tap once anywhere on the screen if you don't hear anyone. Use Chrome on iOS if it persists.

---

## Roughly what this will cost you

For a typical event:

| Crew size × hours | LiveKit usage | Cost |
|---|---|---|
| 10 people × 3 hours | ~30 user-hours of voice | Free (within free tier) |
| 20 people × 8 hours | ~160 user-hours | Free (within free tier) |
| 20 people × 8 hours, every weekend, all month | ~640 user-hours | ~$10–15/month |

LiveKit's free tier covers a generous amount; you'll see your usage on their dashboard. Vercel hosting stays free for this kind of small app.

---

## Things to know about this first version (and how to upgrade later)

This is a **working prototype**, not a finished product. A few honest limitations:

1. **Event details (Client Name, Venue, Date) are only saved on the creator's device.** The teammate joining via code only sees the code, not the venue. To upgrade: add a database (Vercel KV is free and takes ~10 lines of code).
2. **No login.** Anyone with the code can join. Fine for trusted teams; if you want password-protected events, that's another evening of work.
3. **No persistent event history.** Once everyone leaves, the event is gone. Fine for ClearCom use; if you want recordings, LiveKit supports that and we can add a checkbox later.
4. **Phone number/SMS invites aren't built in.** You share the URL + code manually for now (WhatsApp, etc.).

When you want any of these added, just describe what you want and I'll edit the code.

---

## Where to find your code if you want to change it

- **Look and feel (colors, layout, text):** `index.html` (everything between `<style>` and `</style>` is the visual design).
- **Behavior (what happens when buttons click):** `app.js`.
- **Token server (rarely needs changing):** `api/token.js`.

After any edit on GitHub, Vercel automatically redeploys within a minute.

---

## Quick reference

- **Your live app:** `https://[your-project-name].vercel.app` (Vercel will show this)
- **LiveKit dashboard (usage, settings):** https://cloud.livekit.io
- **GitHub repo (your code):** https://github.com/[your-username]/hivedx-clearcoms
- **Vercel dashboard (deploys, env vars):** https://vercel.com/dashboard

Save these four URLs as bookmarks.
