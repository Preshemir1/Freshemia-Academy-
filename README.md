# Freshemia Academy — Admissions Portal

**Jos · Plateau State · Nigeria — 2026 / 2027 session**

One Node application, one code base, three audiences:

| | What it is |
|---|---|
| **Public website** | Hero, the three schools, brochure cards with live tuition, the four-step admission process, entry requirements, admission-number verification and a light/dark switch. |
| **Applicant portal** | Create an account, apply (programme → personal details → passport photograph & documents → submit), then track the decision. When admitted: an admission number (`FA/26/CYB/0001`), a printable A4 admission letter with a QR code, and a printable student ID card. |
| **Administrator console** | Six live counters and per-programme distribution, searchable registers (all / pending / admitted / declined / accounts), a review drawer with the uploaded documents, approve / decline, delete an application or a whole account, and **Programmes & fees** where prices can be raised, cut, courses added, edited or retired — published to the website instantly. |

Two sessions live side by side in the same browser: an applicant and an administrator never log each other out.

---

## Quick start

```bash
npm install          # once (Node 20 LTS or newer)
npm start            # builds public/index.html, then serves http://localhost:3000
```

`npm start` seeds six demo applications the first time, so every screen has something in it.

| Sign in as | Email | Password |
|---|---|---|
| Administrator (demo) | `admin@freshemiaacademy.edu.ng` | `Freshemia@2026` |
| Applicant (demo) | `tunde.adeyemi@example.com` | `Student@2026` |

```bash
npm run build        # rebuild public/index.html only
npm run serve        # run the server without rebuilding
npm run dev          # build, then restart on file changes
npm run reset        # move data/db.json aside (keeps a timestamped backup)
npm run smoke        # end-to-end API test on a throwaway database
```

Before real applicants use it, set `ADMIN_PASSWORD` to something long and unique and `SEED_DEMO=0`. See [GITHUB-SETUP.md](GITHUB-SETUP.md) for deployment, domains and the security checklist.

The website and the API can live on **different hosts** — GitHub Pages for the page, Render for the database. See [Pointing the site at a server](#pointing-the-site-at-a-server).

---

## How the pieces fit together

```
shared/programs.json     the catalogue (names, codes, tuition, modules, accents)
        │
        ├─► build.js ──► public/index.html      ONE self-contained page
        │                    ▲
src/index.template.html     │  inlines src/styles/app.css,
src/styles/app.css          │  shared/programs.json, src/vendor/qrcode.js,
src/vendor/qrcode.js        │  src/js/demo.js, src/js/common.js, src/js/app.js
src/js/{demo,common,app}.js ┘
        │
        ├─► server.js ──► http://localhost:3000   the portal API + the page
        │                    │
        │                    └─► data/db.json     accounts, applications, catalogue
```

**Never edit `public/index.html` by hand** — it is generated. Change `src/` (or `shared/programs.json`), run `node build.js`, and commit both.

**Never commit `data/`** — it holds applicants' names, phone numbers, passport photographs and the key that signs session tokens.

### Pointing the site at a server

The page finds its API in this order, first match wins:

1. **`?api=https://host`** in the address — also remembered, so a shared link sticks
2. **a server saved in this browser** by the *Connect to server…* button
3. **`window.FA_API_BASE`** — an address baked in at build time
4. **the origin that served the page** (same-origin hosting, e.g. `node server.js`)

With nothing configured, a copy that cannot reach an API falls back to the offline demo engine and shows the yellow banner — which now carries a **Connect to server…** button: paste the address of a live portal, the page checks its `/api/health`, remembers it and reloads onto the shared database. No rebuild required, so a page already published on Pages can be rescued without touching the code.

To bake the address into the published artefact instead:

```bash
API_BASE=https://freshemia-academy.onrender.com node build.js   # or --api-base=…
# built public/index.html — 273.3 kB, 3 programmes, API base: https://freshemia-academy.onrender.com
```

The committed `public/index.html` is deliberately **unbaked** (CI enforces this); deployment bakes it. Set the repository variable `API_BASE` and `.github/workflows/pages.yml` links the published site to the live portal on every push.

Because the API is then called cross-origin, `server.js` sends CORS headers (preflight, `Authorization`, `PATCH`/`DELETE`) and mirrors the calling origin. By default **any** origin may call it — tokens travel in the `Authorization` header, never in cookies. Restrict it with `ALLOWED_ORIGINS`:

```bash
ALLOWED_ORIGINS=https://preshemir1.github.io        # comma-separated; https://*.onrender.com works
```

Unlisted origins get no CORS header and their preflight is refused with `403`.

### Why one HTML file?

The page has to be demonstrable anywhere: from a USB stick, from a `file://` path, from GitHub Pages. So `build.js` inlines the stylesheet, the catalogue, the QR generator and all three scripts into a single document. When the page can reach `/api` it talks to the server; when it cannot, `src/js/demo.js` answers the same calls from `localStorage` and a yellow *Offline preview* banner appears. That fallback is a feature, not a bug — it is what makes the site usable without a server.

---

## Project layout

```
freshemia-academy/
├── server.js                  Express 5 API + static hosting of the built page
├── build.js                   compiles src/ into public/index.html
├── package.json               dependencies and scripts
├── package-lock.json          locked versions
├── render.yaml                one-click Render blueprint (disk + env vars)
├── Procfile                   Railway / Heroku-style start command
├── .env.example               the settings the server understands
├── .nvmrc                     Node 20
├── .gitignore                 keeps node_modules/ and data/ out of Git
├── .github/workflows/
│   ├── pages.yml              publishes the website to GitHub Pages
│   └── ci.yml                 rebuild + smoke test on every push
├── public/
│   └── index.html             THE ARTEFACT — the whole site in one file (generated)
├── src/
│   ├── index.template.html    page shell and every view's markup
│   ├── styles/app.css         design system (navy/gold, dark theme, print styles)
│   ├── vendor/qrcode.js       qrcode-generator 1.4.4 (MIT) for the letter's QR code
│   └── js/
│       ├── app.js             router, applicant views, administrator console
│       ├── common.js          API client, session storage, formatting helpers
│       └── demo.js            offline engine used when no server is reachable
├── shared/programs.json       the catalogue
├── scripts/
│   ├── reset.js               npm run reset
│   └── smoke.js               npm run smoke — end-to-end API + CORS test
└── data/                      NOT in Git — created at runtime
    ├── db.json                accounts, applications, catalogue
    └── secret.key             token signing key (generated on first run)
```

---

## Routes in the page

Hash-based, so the single file works from any path:

| Route | Screen |
|---|---|
| `#/` | Academy website |
| `#/signin` | Applicant sign in |
| `#/signup` | Create an applicant account |
| `#/staff` | Staff & administrator sign in |
| `#/apply` | Four-step application wizard (asks for sign-in first) |
| `#/dashboard` | Applicant dashboard (status, admission, documents) |
| `#/letter` | Printable A4 admission letter |
| `#/id` | Printable student ID card |
| `#/verify` | Public admission-number verification |
| `#/verify/FA-26-CYB-0001` | Verification with the number pre-filled |
| `#/admin` | Administrator console (asks for staff sign-in first) |

---

## The API

All routes are under `/api`. Applicant routes use the applicant's bearer token, `/admin/*` uses the administrator's; `GET /verify/:number` needs no token. Errors are `{ "error": "message" }` with a matching HTTP status.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness + record counts (also what *Connect to server…* probes) |
| `GET` | `/programs` | Catalogue with formatted fees |
| `POST` | `/auth/signup` | Create an applicant account |
| `POST` | `/auth/login` | Sign in (applicant or administrator) |
| `GET` | `/auth/me` | Resolve the current session |
| `POST` | `/auth/logout` | Client-side sign-out acknowledgement |
| `GET` | `/applications/mine` | The applicant's application (+ admission payload when approved) |
| `POST` | `/applications` | Submit or re-submit an application |
| `GET` | `/verify/:number` | Public verification (`FA-26-CYB-0001` or `FA/26/CYB/0001`) |
| `GET` | `/admin/stats` | Counters, per-programme split, five most recent |
| `GET` | `/admin/applications` | Full register |
| `GET` | `/admin/applications/:id` | One application + uploaded documents |
| `POST` | `/admin/applications/:id/approve` | Approve and mint an admission number |
| `POST` | `/admin/applications/:id/reject` | Decline with a reason shown to the applicant |
| `DELETE` | `/admin/applications/:id?account=1` | Delete the application (and optionally the account) |
| `GET` | `/admin/students` | Accounts register with application status |
| `DELETE` | `/admin/students/:id` | Delete an account and its applications |
| `POST` | `/admin/programs` | Add a programme |
| `PATCH` | `/admin/programs/:id` | Change name, code, award, duration, tuition, modules |
| `DELETE` | `/admin/programs/:id?force=1` | Retire a programme (force when applications reference it) |

Example:

```bash
TOKEN=$(curl -s localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@freshemiaacademy.edu.ng","password":"Freshemia@2026"}' | jq -r .token)

curl -s localhost:3000/api/admin/stats -H "Authorization: Bearer $TOKEN"
```

---

## Security and data

* Passwords: `scrypt` with a 16-byte per-user salt — the plain password is never stored or logged.
* Sessions: HMAC-SHA256 signed bearer tokens (`SESSION_DAYS`, default 30), verified on every request; the signing key lives in `data/secret.key` unless you supply `SESSION_SECRET`.
* Uploads: passport photographs and documents are downscaled in the browser (max 900 px, JPEG ~82%) before they are sent, then stored in `data/db.json` as data URLs. Move them to object storage (S3 / R2 / Supabase) before volume grows.
* Database: a single JSON file, written atomically. It is fine for a single campus with a few hundred applicants per session; plan a move to PostgreSQL before the second or third intake.
* Not built yet: e-mail/SMS notifications, payment collection, multiple administrators with an audit trail, and rate limiting on sign-in. Each is a small, contained addition — see §1 of [GITHUB-SETUP.md](GITHUB-SETUP.md).

### Data directory

| File | Contents |
|---|---|
| `data/db.json` | Accounts (hashed passwords), applications, catalogue, counters |
| `data/secret.key` | 32-byte token signing key, generated on first boot |

Both are created automatically. On any host, that directory must be on a **persistent disk** or records disappear on redeploy.

---

## Design system

| Token | Value | Used for |
|---|---|---|
| `--navy` | `#0a2540` | Primary brand, headings, headers |
| `--gold` | `#c9a227` | Accents, gold buttons, the crest |
| `--cream` | `#f8f6f1` | Page background |
| `--cyber` | `#0e7d8b` | Cybersecurity accent |
| `--ai` | `#6b46c1` | Artificial Intelligence accent |
| `--cop` | `#b3660d` | Computer Operator accent |
| `--green` / `--red` / `--amber` | `#1b6b48` / `#9a2b2b` / `#8a5a08` | Admitted / declined / pending |

Type: `Iowan Old Style` (falling back to Palatino/Georgia) for headings, the system sans stack for body text, `SFMono-Regular`/Consolas for admission numbers. The dark theme is a `data-theme="dark"` attribute on `<html>`, persisted in `localStorage` as `fa_theme` and applied before first paint. Print styles produce a true A4 letter and CR80-sized ID card.

---

## Tests

`npm run smoke` boots the real server against a temporary database and walks the whole lifecycle — sign up, apply, review, approve, verify, edit a fee, delete — plus a cross-origin block: preflight, reflected `Access-Control-Allow-Origin`, `Authorization` in the allowed headers, a JSON `POST` from another origin, and a second server whose `ALLOWED_ORIGINS` refuses an unlisted site. 38 checks in all. It is what CI runs; nothing in `data/` is touched.

---

## Deployment

| Option | What you get | Where records live |
|---|---|---|
| **GitHub Pages** (`pages.yml`) | A permanent demo URL — site, wizard, console, all clickable | Each visitor's browser |
| **Render** (`render.yaml`) | The real portal with shared data and a persistent disk | `data/db.json` on the disk |
| **Railway / Fly.io / VPS** | Same as Render | Same, with a volume mounted at `data/` |

Full instructions, domain setup and the pre-launch checklist: **[GITHUB-SETUP.md](GITHUB-SETUP.md)**.

---

© Freshemia Academy — admissions portal, 2026 / 2027 session.
