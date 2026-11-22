#!/usr/bin/env node
/* ==========================================================================
   npm run reset — clear the database
   --------------------------------------------------------------------------
   Deletes data/db.json (accounts, applications, the edited catalogue) and
   leaves data/secret.key in place, so existing sessions keep working until the
   server restarts. The next boot recreates the administrator from
   ADMIN_EMAIL / ADMIN_PASSWORD and re-seeds the demo records if enabled.
   ========================================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DB_FILE)) {
  console.log(`nothing to reset — ${DB_FILE} does not exist yet`);
  process.exit(0);
}

const backup = `${DB_FILE}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
fs.renameSync(DB_FILE, backup);
console.log(`reset complete — previous database kept at ${path.relative(ROOT, backup)}`);
console.log('restart the server to recreate the administrator and demo records');
