# Freshemia Academy — GitHub & Server Handover Guide

**Read this first.** This document explains what we are building, what lives where, and exactly
how to put it on GitHub and run it on a real server so the yellow *"Offline preview"* banner
disappears.

> **The banner you saw** appears because the page was opened with no portal server behind it, so it
> fell back to saving records in that one browser. That is by design — it is what makes the file
> usable anywhere. A live server removes it.

---

## 0. The one-minute version

| Thing | Where it lives | What it does |
|-------|----------------|--------------|
| **The website** | one file — `public/index.html` | Academy site + applicant portal + administrator console, all inlined |
| **The portal server** | `server.js` (Node + Express 5) | Accounts, applications, admissions, fees, deletes — the shared database |
| **GitHub** | `Preshemir1/Freshemia-Academy-` | Stores the code, keeps the history, and can publish the *website* for free |
| **A Node host** (Render / Railway / Fly / VPS) | runs `server.js` | The *real* multi-user portal: every visitor sees the same records |

**One sentence to remember:** GitHub stores the code; GitHub Pages can show the website; only a Node
host can run the portal server. GitHub Pages cannot run Node.

```
You (or I) edit in this workspace
        │
        ├─► node build.js  →  public/index.html   (the single self-contained website)
        │
        ├─► git commit + git push  →  GitHub repository
        │                                 │
        │                                 ├─► GitHub Pages   → public demo website (browser-only data)
        │                                 └─► Render/Railway → live portal server (shared data)
        │
        └─► node server.js → http://localhost:3000  (how you test it while building)
```

### Current status

| Item | State |
|------|-------|
| Repository | `Preshemir1/Freshemia-Academy-` — the full project is committed here |
| Build | `node build.js` produces `public/index.html` (262 kB, three programmes) |
| Server | `node server.js` — full API, verified by `npm run smoke` (29 checks) |
| GitHub Pages | **needs switching on once**: Settings → Pages → Source = GitHub Actions |
| Live Node host | **not yet deployed** — follow §5 Option B when you are ready |
| Administrator password | still the default until you set `ADMIN_PASSWORD` on the host |

Only the last three rows need you. Everything else is done.

---

## 1. What we are building (scope of this project)

A single admissions product for Freshemia Academy, Jos — one code base, three audiences:

**Public academy website** — hero, three schools (Cybersecurity, Artificial Intelligence, Computer
Operator), brochure cards with **live tuition**, the four-step admission process, entry requirements,
an admission-number verification page, and a prominent **Administrator console** button.
Includes a **light / dark** switch for the whole site.

**Applicant portal** — sign up, apply (programme → personal details → passport photograph and
documents → submit), then track the decision. When admitted: admission number
(`FA/26/CYB/0001`), a printable A4 admission letter with a QR code, and a printable student ID card.

**Administrator console** — admissions overview with six live counters and per-programme
distribution; searchable registers (all / pending / admitted / declined / accounts); a review drawer
with the uploaded documents; approve / decline; **delete an application or a whole account**;
**Programmes & fees** where the administrator can raise or cut each price, add a course, edit it, or
retire it — published to the website instantly.

### What is explicitly *not* built yet (the honest list)

| Missing | Why it matters | Suggested next step |
|---------|----------------|---------------------|
| Email / SMS notifications | Applicants are told nothing after approval | Add an email provider (Resend, Brevo, Mailgun) in `server.js` |
| Payment (application or tuition fee) | Fees are displayed but not collected | Paystack or Flutterwave checkout on the portal |
| Separate storage for uploaded photos | Currently stored inside `data/db.json` | Move to S3 / Cloudflare R2 / Supabase Storage |
| Multiple administrators & audit log | One admin account, no trail of who changed a fee | Add `role: 'staff'` users and an `audit[]` array |
| Rate limiting on sign-in | Brute-force attempts are not throttled | `express-rate-limit` on `/api/auth/*` |
| Database beyond a JSON file | Fine for hundreds of applications, not for tens of thousands | Move to PostgreSQL (Supabase / Neon) when volume grows |

The JSON database is genuinely adequate for a single campus with a few hundred applicants per
session. Plan the move to PostgreSQL before the second or third intake.

---

## 2. What is inside the repository

```
Freshemia-Academy-/
├── server.js                  Express API: auth, applications, admissions, programmes, deletes
├── build.js                   Compiles src/ into the single file public/index.html
├── package.json               Dependencies and scripts (npm start / build / reset / smoke)
├── package-lock.json          Locked versions — keeps deploys identical
├── README.md                  How the product works, routes, API, design tokens
├── GITHUB-SETUP.md            ← this document
├── render.yaml                One-click Render blueprint for the live server
├── Procfile                   For Railway / Heroku-style hosts
├── .env.example               The settings the server understands
├── .nvmrc                     Node 20
├── .gitignore                 Keeps node_modules and data/ out of GitHub
├── .github/workflows/
│   ├── pages.yml              Publishes the website to GitHub Pages
│   └── ci.yml                 Rebuilds the page and runs the smoke test on every push
├── public/
│   └── index.html             THE ARTEFACT — the whole website in one file (generated)
├── src/
│   ├── index.template.html    Page shell and all view markup
│   ├── styles/app.css         Design system (navy/gold, dark theme, print styles)
│   ├── vendor/qrcode.js       QR generator 1.4.4 (MIT) — letter and ID-card QR codes
│   └── js/
│       ├── app.js             Router, applicant views, administrator console
│       ├── common.js          API client, session storage, offline detection
│       └── demo.js            Offline engine used when no server is reachable
├── shared/
│   └── programs.json          The catalogue (names, codes, tuition, modules, accents)
├── scripts/
│   ├── reset.js               `npm run reset` — clears the database
│   └── smoke.js               `npm run smoke` — end-to-end API test
└── data/                      NOT in GitHub — the live database, created at runtime
    ├── db.json                Accounts, applications, catalogue
    └── secret.key             Token signing key (generated on first run)
```

**Never commit `data/`.** It holds real applicants' names, phone numbers, passport photographs and
the key that signs session tokens. `.gitignore` already blocks it — keep it that way.

The QR generator is **vendored** in `src/vendor/qrcode.js` rather than pulled from `node_modules`.
That keeps the build dependency-free (only Express is installed) and guarantees the browser and the
server use exactly the same encoder. The file carries one local fix — upstream 1.4.4 transposes x
and y when drawing into a canvas, which mirrors every QR code — noted in the file header.

---

## 3. Before you start (10 minutes of setup)

1. **A GitHub account** — <https://github.com/signup>
2. **Git installed** (check: `git --version`)
   * Windows: <https://git-scm.com/download/win>
   * macOS: `brew install git`
   * Ubuntu: `sudo apt install git`
3. **Node.js 20 LTS** (check: `node -v`) — <https://nodejs.org>
4. **The project folder on your machine.** Either:
   * clone it from the repository (see §4.2), or
   * download the repository archive and unzip it.

---

## 4. The repository on GitHub

### 4.1 What already exists

The repository is **`Preshemir1/Freshemia-Academy-`**. The whole project — server, build, sources,
the generated page, workflow files and both documents — is committed in it. Nothing needs to be
created by hand.

To confirm: open the repository page and check that `server.js`, `build.js`, `src/`, `public/`,
`shared/`, `scripts/` and `.github/` are all listed, and that `node_modules/` and `data/` are not.

### 4.2 Clone it and run it locally

```bash
git clone https://github.com/Preshemir1/Freshemia-Academy-.git
cd Freshemia-Academy-

npm install
npm start        # http://localhost:3000
```

The first boot seeds six demo applications so every screen has content, and creates the
administrator account from `ADMIN_PASSWORD` (default `Freshemia@2026`).

`npm run smoke` runs 29 end-to-end checks against a throwaway database — a good way to prove the
checkout is healthy before you touch anything.

### 4.3 Working from a machine that is not this one

If you ever set the project up from scratch somewhere else, the sequence is:

```bash
git init -b main
git add .
git commit -m "Freshemia Academy admissions portal — website, portal, admin console"
git remote add origin https://github.com/Preshemir1/Freshemia-Academy-.git
git push -u origin main
```

When Git asks for a password it wants a **Personal Access Token**, not your GitHub password:
GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new
token** → tick **repo** → paste the token as the password. (Or install *GitHub Desktop* and use
**Add local repository → Publish repository**.)

### 4.4 Keeping the repository tidy

On the repository page: **About** (right side) — add the description
`Freshemia Academy — admissions portal (website + applicant portal + administrator console)`, the
website URL once Pages is on, and topics `admissions`, `portal`, `nodejs`, `express`, `education`,
`nigeria`.

Keep it **private** until launch: it is a school's system.

---

## 5. Choose how it will run

You need **one or both** of these.

| | **Option A — GitHub Pages** | **Option B — Node host** |
|---|---|---|
| Cost | Free | Free tier or ~$7/month |
| Setup time | 5 minutes | 15 minutes |
| What works | The whole website, applicant portal and console, fully clickable | Everything, plus shared data |
| Where records live | Each visitor's own browser | One shared server database |
| Yellow banner | **Still shown** (by design) | **Gone** |
| Use it for | Showing the design to the school, a demo link on WhatsApp | Real admissions |

### Option A — publish the website on GitHub Pages (free demo link)

The workflow file `.github/workflows/pages.yml` is already in the project and does the work:

1. On GitHub: **Settings → Pages**
2. **Build and deployment → Source: GitHub Actions** (not "Deploy from a branch")
3. Push to `main` (or **Actions → Deploy website to GitHub Pages → Run workflow**)
4. Wait ~1 minute, then your site is at:
   `https://preshemir1.github.io/Freshemia-Academy-/`

What this gives you: a permanent, professional URL where the academy site, the application wizard,
the admission letter and the whole administrator console can be demonstrated — with records kept in
the browser of whoever is looking. Do not use it to collect real applications.

### Option B — run the live server (recommended for real admissions)

#### B1. Render (easiest, and `render.yaml` is ready)

1. Sign in at <https://render.com> **with GitHub** and allow it to read your repositories.
2. **New → Blueprint** → pick `Freshemia-Academy-`. Render reads `render.yaml` and fills everything in:
   * build: `npm ci && node build.js`
   * start: `node server.js`
   * disk mounted at `data/` (so applicants survive redeploys)
   * `SEED_DEMO=0` (empty register)
3. It asks for **`ADMIN_PASSWORD`** — type a strong password and keep it safe. That is the
   administrator login for the live system.
4. **Apply / Create** and wait for *Live*. Your portal is at
   `https://freshemia-academy.onrender.com` (the exact name is shown at the top of the service page).

> Without **Blueprint**, do it manually: **New → Web Service → connect the repo →
> Build Command** `npm ci && node build.js`, **Start Command** `node server.js`, then add the
> environment variables from `.env.example` and a **Disk** mounted at
> `/opt/render/project/src/data`.
>
> A persistent disk requires Render's paid instance type (start around $7/month). On the free
> instance the service sleeps after inactivity and the disk is temporary — records would be lost on
> each deploy, which is fine for a demo but **not** for real applications.

#### B2. Railway (good alternative)

1. <https://railway.app> → **New Project → Deploy from GitHub repo** → `Freshemia-Academy-`.
2. Railway detects Node and runs `npm start`. Add variables `ADMIN_PASSWORD`, `SEED_DEMO=0`.
3. **+ New → Volume**, mount it at `/app/data`, and set `DATA_DIR=/app/data`.
4. **Settings → Networking → Generate Domain**.

#### B3. A VPS you control (Ubuntu, full control, ~$5/month)

```bash
# on the server
sudo apt update && sudo apt install -y git nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2

git clone https://github.com/Preshemir1/Freshemia-Academy-.git
cd Freshemia-Academy-
npm ci && node build.js

ADMIN_PASSWORD='YourStrongPassword' SEED_DEMO=0 PORT=3000 pm2 start server.js --name freshemia
pm2 save && pm2 startup      # keeps the portal running after a reboot
```

Then point Nginx at `127.0.0.1:3000` and add a free certificate with `certbot --nginx`. Give the
school a real domain here (`admissions.freshemiaacademy.edu.ng`).

#### B4. Other hosts in one line each

| Host | Command / setting |
|------|-------------------|
| **Fly.io** | `fly launch` → `fly volumes create data --size 1` → mount at `/app/data` |
| **Koyeb** | Build `npm ci && node build.js`, run `node server.js`, add a volume at `/app/data` |
| **cPanel "Setup Node.js App"** | Application root = repo, startup file `server.js`, run `npm install` |

In every case the same three settings apply: **`ADMIN_PASSWORD`**, **`SEED_DEMO=0`**, and a
**persistent disk mounted at the project's `data/` folder**.

---

## 6. Connect your own domain

1. Buy or use the domain you already own (e.g. `freshemiaacademy.edu.ng`).
2. In the host's dashboard: **Settings → Custom Domain → Add** `admissions.freshemiaacademy.edu.ng`.
3. The host shows a target. In the domain registrar's DNS panel add:
   * **CNAME** `admissions` → `freshemia-academy.onrender.com` (or whatever the host shows), **or**
   * **A** record to the IP the host gives you, if it asks for an IP.
4. Wait for DNS (5 minutes to a few hours). HTTPS is issued automatically by the host.
5. Open the new domain, sign in as administrator, approve a test application, then delete the test.

---

## 7. The working loop (how GitHub links to what we build here)

```bash
# 1. edit the files in src/  (or ask me to)
node build.js                  # rebuild public/index.html
node server.js                 # test at http://localhost:3000

# 2. publish
git add .
git commit -m "Raise Cybersecurity tuition to ₦210,000"
git push
```

* **Render / Railway** redeploy automatically on every push to `main` (about 1–2 minutes).
* **GitHub Pages** rebuilds and republishes automatically through the workflow.
* **CI** rebuilds the page and runs `npm run smoke` on every push and pull request; if the committed
  `public/index.html` is stale, it fails and tells you to rebuild.
* **Made a mistake?** On GitHub open the commit → **Revert** → push; the previous version is live
  again in a minute.

Two rules that keep this clean:

1. **Never edit `public/index.html` by hand.** It is generated — change `src/` and rebuild.
2. **Never commit `data/`.** Live records belong to the server's disk, not to GitHub.

---

## 8. Data, backups and the administrator account

| Question | Answer |
|----------|--------|
| Where are the records? | `data/db.json` on the server's disk |
| How do I back it up? | Download it from the host's shell/dashboard (Render: **Shell** tab → `cat data/db.json`), or add a scheduled backup to object storage |
| How do I start fresh? | `npm run reset` locally (it keeps a timestamped backup), or delete `data/db.json` on the server and restart |
| How do I change the admin password? | Set `ADMIN_PASSWORD` then delete `data/db.json` and restart — the administrator is re-created on the next boot (this also erases the applications, so do it before launch) |
| Can two people sign in at once? | Yes — the applicant session and the administrator session are separate and do not log each other out |
| Is the applicant's password stored? | Only a `scrypt` hash with a per-user salt; plain passwords are never stored or logged |

---

## 9. Security checklist before real applicants use it

- [ ] `ADMIN_PASSWORD` set to something long and unique; the default `Freshemia@2026` is **not** used
- [ ] `SEED_DEMO=0` — the six demo applications are gone
- [ ] `data/` is **not** in the repository (check GitHub's file list)
- [ ] HTTPS enforced (hosts do this automatically; on a VPS use certbot)
- [ ] Repository is **private**
- [ ] Demo student passwords (`Student@2026`) no longer exist because the demo records are gone
- [ ] A backup of `data/db.json` has been taken once real applications arrive
- [ ] Someone at the academy owns the admin login and the domain, not only the developer
- [ ] Written consent/policy for storing passport photographs and O'level details
- [ ] Add rate limiting and email notifications before a second intake (see §1)

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Yellow *"Offline preview"* banner | The page cannot reach `/api` — opened from disk, or Pages hosting | Expected for Option A. For shared data use Option B (Node host) |
| `Cannot find module 'express'` | Dependencies not installed | `npm ci` (or `npm install`) in the project folder |
| `public/index.html is missing` | The page was never built | `node build.js` (or `npm start`, which builds first) |
| Everything works, then all accounts vanish after a deploy | No persistent disk, or disk mounted somewhere other than `data/` | Attach a disk, mount it at the project's `data/` folder, set `DATA_DIR` if it lives elsewhere |
| `Error: listen EADDRINUSE` | Port already used locally | `PORT=3001 npm start` |
| Admin login rejected on the live site | Password was changed but the old database is still there | Set `ADMIN_PASSWORD`, delete `data/db.json`, restart |
| Pages shows 404 | Source is set to a branch instead of **GitHub Actions**, or the workflow has not run | Settings → Pages → Source: GitHub Actions → Actions tab → Run workflow |
| Page looks unstyled | `public/index.html` was committed half-built or edited | `node build.js` and commit the rebuilt file |
| CI fails with "public/index.html is out of date" | `src/` changed but the artefact was not rebuilt | `node build.js && git add public/index.html` |
| Node 14/16 on the host | Express 5 needs a modern runtime | Set `NODE_VERSION=20` (Render) — `.nvmrc` is respected by most hosts |

---

## 11. Repository housekeeping

On the GitHub repository page:

* **About** (right side): description + website URL + topics
  `admissions`, `portal`, `nodejs`, `express`, `education`, `nigeria`
* **Settings → Branches → Add branch protection rule** for `main`: require a pull request for your
  own review once a second person starts committing
* **Settings → Secrets and variables → Actions**: store `ADMIN_PASSWORD` here if you later automate
  deployments instead of typing it into the host
* Add a `LICENSE` file if the academy wants to make the code public — otherwise keep it private

---

## 12. Quick reference

```bash
# local development
npm install             # once
npm start               # build + serve on http://localhost:3000
npm run build           # rebuild the single file only
npm run reset           # move the database aside, then restart to re-seed
npm run smoke           # end-to-end API test (29 checks, throwaway database)

# publish
git add . && git commit -m "message" && git push
```

| Sign in as | Email | Password |
|------------|-------|----------|
| Administrator (demo) | `admin@freshemiaacademy.edu.ng` | `Freshemia@2026` |
| Applicant (demo) | `tunde.adeyemi@example.com` | `Student@2026` |

On a live deployment the administrator password is whatever you set in `ADMIN_PASSWORD`, and the
demo applicants do not exist when `SEED_DEMO=0`.

---

### What is left for you to decide

1. The **administrator password** for the live system (and whether the login stays
   `admin@freshemiaacademy.edu.ng` — `ADMIN_EMAIL` changes it).
2. Which host you want: **Render** (easiest, blueprint ready), **Railway**, **Fly.io**, or your own
   **VPS/domain**.
3. The domain you want to use, if you already own one.
4. Whether the repository should stay **private** (recommended) or become public.

With those I can keep the code and the deployment files in step, and you only ever have to run the
`git push` — or hand this document to any developer and they will know exactly what to do.

---

© Freshemia Academy — admissions portal, 2026 / 2027 session.
