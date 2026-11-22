# Freshemia Academy — repository & deployment status

**Audited:** 22 November 2026 · **Repository:** `Preshemir1/Freshemia-Academy-` (public, default branch `main`)
**Auditor's method:** fresh clone → `npm ci` → `node build.js` → `npm run smoke` → built page run
from a **different origin** than the API. Every number below is measured, not estimated.

---

## 1. Verdict

| | |
|---|---|
| **Code** | Complete and healthy — nothing to fix |
| **Build** | Clean, single file, no external requests |
| **Tests** | 38 / 38 passing |
| **Deployment** | **None.** No Node host exists, GitHub Pages is not enabled |
| **Site ↔ server link** | **Built in this branch** (was missing: the page could only ever call its own origin, and the server sent no CORS headers) |

The yellow *"Offline preview"* banner is therefore **accurate today**: there is no server anywhere for
the page to reach. It is not a code fault.

---

## 2. What is working

| Check | Result |
|---|---|
| Repository | public, `main`, **4 commits**, PR #1 merged, 155 kB |
| `npm ci` | clean — **1 runtime dependency** (`express`); the QR engine is vendored |
| `node build.js` | `public/index.html`, **273 kB**, **0 external requests** |
| CI **Checks** (run `45062116048`, `main`) | **success** — build, artefact-freshness gate, smoke test |
| `npm run smoke` | **38 passed, 0 failed** |
| Secrets | `data/` (database + signing key) and `.env` correctly ignored |
| Assets | stylesheet, catalogue, QR generator, all three scripts inlined — works from `file://` |

Smoke covers: catalogue, sign up, duplicate e-mail, wrong password, sign in, session resolve,
anonymous refusal, applying, reference format, double-application refusal, applicant status,
administrator sign-in, applicant blocked from the console, overview counters, register, review
drawer with photo, approval + admission number, admitted dashboard, QR payload, public
verification, unknown number, fee change, published fee, programme add, forced-delete guard,
application/account deletion, health — plus the new cross-origin block (§5).

---

## 3. What is not working

| Problem | Evidence | What it needs |
|---|---|---|
| **No server deployed** | `GET /repos/…/deployments` → `[]` | A Node host: Render blueprint is ready (§5 B1 of `GITHUB-SETUP.md`) |
| **GitHub Pages failed** | run `45062116019` (main) died at *"Configure Pages (enables it on the first run)"*; `GET /repos/…/pages` → `404`, i.e. `has_pages: false` | One click: Settings → Pages → Source **GitHub Actions**, then re-run |
| **No persistent disk** | n/a until a host exists | Blueprint attaches `data/`; on a VPS use a volume |
| **Site had no way to reach another server** *(fixed below)* | page called only `/api` on its own origin; server sent no CORS headers | — |

`configure-pages` cannot create the Pages site on the first run with the workflow token; the failure
is a permission boundary, not a mistake in the workflow.

---

## 4. What this branch adds — "linked as a server"

| File | Change |
|---|---|
| `src/js/common.js` | API address resolution: `?api=…` → address saved in this browser → `window.FA_API_BASE` (baked) → same origin. Adds `probe` / `connect` / `setApiBase` / `resetApiBase`, and guards session helpers for token-less endpoints |
| `src/index.template.html` | *Connect to server…* button in the offline banner + a dialog to enter, test and remember a server address |
| `src/js/app.js` | Dialog behaviour: prefill, probe, readable errors, remember + reload, *Use the default*; banner now names the unreachable server |
| `src/styles/app.css` | Banner action buttons and the dialog, using the existing tokens (dark theme included) |
| `build.js` | `API_BASE=…` (or `--api-base=…`) bakes `window.FA_API_BASE`; prints the base in the build log; template marker enforced |
| `server.js` | CORS middleware: preflight `204`, reflects the calling origin, allows `Authorization` + `PATCH`/`DELETE`, `Vary: Origin`, `ALLOWED_ORIGINS` allow-list with wildcard support, `403` for unlisted origins |
| `.github/workflows/pages.yml` | Bakes `vars.API_BASE`, so a published site links itself on every push |
| `.github/workflows/ci.yml` | Builds **without** `API_BASE` so the freshness gate matches the committed (neutral) artefact |
| `scripts/smoke.js` | 9 new checks: preflight, reflected origin, allowed headers, cross-origin GET/POST, and a second server whose allow-list blocks a stranger |
| `.env.example`, `render.yaml` | `ALLOWED_ORIGINS` documented and wired |
| `README.md`, `GITHUB-SETUP.md` | New "Pointing the site at a server" section and §5 **B5** |

---

## 5. Cross-origin proof (measured)

Page served statically on **`:4100`**, API on **`:3200`**, `ALLOWED_ORIGINS=http://127.0.0.1:4100`.

```
baked API base          → http://127.0.0.1:3200
offline banner shown    → false            (was true: no server linked)
programme cards         → ₦185,000 from the remote database
admin sign-in           → #/admin opened
KPIs from remote DB     → Applications 6 · Awaiting review 3 · Admitted 2 · Declined 1 · Accounts 6 · Programmes 3
fee write               → Cybersecurity ₦232,000 → confirmed in the remote database
?api=… link             → base remembered in localStorage, banner hidden
Connect dialog          → opens prefilled "Currently using http://127.0.0.1:3200 — built into this page"
wrong address           → "Could not reach http://127.0.0.1:3299. Check the address, that the server is running…"
CORS preflight          → 204, Access-Control-Allow-Origin: http://127.0.0.1:4100
unlisted origin         → 403, no Access-Control-Allow-Origin
smoke                   → 38 passed, 0 failed
```

Note on method: the browser's own CORS enforcement cannot be exercised head­lessly here, so it is
covered from both sides — the headers are asserted on the wire (curl + smoke), and the page's
resolution and remote calls are asserted in a DOM run against the real API.

---

## 6. Your remaining steps

1. **GitHub** → Settings → Pages → Source: **GitHub Actions** → re-run the *Deploy website* workflow
   → site at `https://preshemir1.github.io/Freshemia-Academy-/`
2. **render.com** → New → **Blueprint** → pick the repository (it reads `render.yaml`: build, start,
   disk at `data/`, `SEED_DEMO=0`, `ALLOWED_ORIGINS="*"`) → set `ADMIN_PASSWORD` → Create
3. Copy the service URL (e.g. `https://freshemia-academy.onrender.com`) and either send it over or
   set it as the repository variable **`API_BASE`**, then re-run Pages
4. Before real applicants: narrow `ALLOWED_ORIGINS` to your published site, set `SEED_DEMO=0`, keep
   the repository private if it should be

Nothing in this branch needs your input to be built or tested — it is already verified, committed and
ready to merge.
