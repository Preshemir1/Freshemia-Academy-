#!/usr/bin/env node
/* ==========================================================================
   Freshemia Academy — single-file build
   --------------------------------------------------------------------------
   Compiles everything in src/ into one self-contained page:

       public/index.html   =  src/index.template.html
                             + src/styles/app.css
                             + shared/programs.json   (the catalogue)
                             + src/vendor/qrcode.js   (admission-letter QR codes)
                             + src/js/demo.js         (offline engine)
                             + src/js/common.js       (API client, sessions)
                             + src/js/app.js          (router, portal, console)

   Never edit public/index.html by hand — change src/ and run `node build.js`
   (or `npm run build`).

   Point a published copy at a live portal server by baking its address in:

       API_BASE=https://freshemia-academy.onrender.com node build.js

   The committed public/index.html is normally built without API_BASE and picks
   its server from the origin that serves it — or from "Connect to server…".
   ========================================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'public');
const OUT_FILE = path.join(OUT_DIR, 'index.html');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Strip a leading shebang or BOM, and normalise the trailing newline. */
function tidy(text) {
  return text.replace(/^\uFEFF/, '').replace(/\s+$/, '');
}

/**
 * Wrap a script body so it cannot terminate the surrounding <script> element
 * and cannot leak a stray `</script>` from a string in the source.
 */
function script(body, comment) {
  const safe = body.replace(/<\/script/gi, '<\\/script');
  return `<script>\n/* ${comment} */\n${safe}\n</script>`;
}

/**
 * The portal server this copy of the page should talk to, or '' for
 * "whatever origin is serving me". Accepts `--api-base=…` or API_BASE.
 */
function apiBaseFromEnv(argv) {
  const flag = argv.find((arg) => arg.startsWith('--api-base='));
  const raw = String(flag ? flag.slice('--api-base='.length) : process.env.API_BASE || '').trim();
  if (!raw) return '';
  let base = raw;
  if (!/^https?:\/\//i.test(base)) {
    const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|$)/i.test(base);
    base = (local ? 'http://' : 'https://') + base;
  }
  base = base.replace(/\/+$/, '').replace(/\/api$/i, '');
  return base;
}

function build(options = {}) {
  const apiBase = options.apiBase !== undefined ? options.apiBase : apiBaseFromEnv([]);
  const template = read('src/index.template.html');
  const css = tidy(read('src/styles/app.css'));
  const programs = JSON.parse(read('shared/programs.json'));
  const qrcode = tidy(read('src/vendor/qrcode.js'));
  const demo = tidy(read('src/js/demo.js'));
  const common = tidy(read('src/js/common.js'));
  const app = tidy(read('src/js/app.js'));

  if (!/\/\* @@APP_CSS@@ \*\//.test(template)) throw new Error('Template is missing the @@APP_CSS@@ marker.');
  if (!/<!-- @@APP_SCRIPTS@@ -->/.test(template)) throw new Error('Template is missing the @@APP_SCRIPTS@@ marker.');
  if (!/<!-- @@API_BASE@@ -->/.test(template)) throw new Error('Template is missing the @@API_BASE@@ marker.');
  if (!Object.keys(programs).length) throw new Error('shared/programs.json is empty — the catalogue must have at least one programme.');

  const scripts = [
    `<script>\n/* Programme catalogue — edit shared/programs.json, then rebuild. */\nwindow.FA_PROGRAMS = ${JSON.stringify(programs, null, 2)};\n</script>`,
    script(qrcode, 'QR Code Generator (qrcode-generator 1.4.4, MIT) — vendor/qrcode.js'),
    script(demo, 'Offline demo engine — demo.js'),
    script(common, 'Shared helpers: API client, sessions, formatting — common.js'),
    script(app, 'Freshemia Academy — single-page application — app.js'),
  ].join('\n\n');

  const apiBaseScript = apiBase
    ? `<script>\n/* Portal server, baked in at build time (build.js API_BASE). */\nwindow.FA_API_BASE = ${JSON.stringify(apiBase)};\n</script>`
    : '<!-- No API_BASE baked in: this page talks to the origin that serves it, or to a server chosen with "Connect to server…". -->';

  const html = template
    .replace('/* @@APP_CSS@@ */', () => css)
    .replace('<!-- @@API_BASE@@ -->', () => apiBaseScript)
    .replace('<!-- @@APP_SCRIPTS@@ -->', () => scripts);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, html, 'utf8');

  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(
    `built public/index.html — ${kb} kB, ${Object.keys(programs).length} programmes, API base: ${apiBase || 'same origin'}`
  );
  return html;
}

if (require.main === module) {
  try {
    build({ apiBase: apiBaseFromEnv(process.argv.slice(2)) });
  } catch (err) {
    console.error('build failed:', err.message);
    process.exit(1);
  }
}

module.exports = { build };
