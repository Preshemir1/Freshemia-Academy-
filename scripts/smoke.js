#!/usr/bin/env node
/* ==========================================================================
   npm run smoke — end-to-end check of the portal API
   --------------------------------------------------------------------------
   Boots the real server on a spare port against a throwaway DATA_DIR, then
   walks the whole admissions lifecycle: sign up, apply, review, approve,
   verify the admission number, edit a fee, delete the record. Nothing touches
   data/db.json.

   Exits 0 when every step passes, 1 otherwise — usable in CI.
   ========================================================================== */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT || 4599);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'freshemia-smoke-'));
const ADMIN_PASSWORD = 'SmokeTest@2026';

const PHOTO =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="75"><rect width="60" height="75" fill="#0a2540"/></svg>',
    'utf8'
  ).toString('base64');

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(method, route, { token, body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + '/api' + route, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR,
      ADMIN_PASSWORD,
      ADMIN_EMAIL: 'admin@freshemiaacademy.edu.ng',
      SEED_DEMO: '0',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.env.SMOKE_VERBOSE && process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

async function run() {
  const server = startServer();
  try {
    if (!(await waitForServer())) throw new Error('the server did not start');

    console.log('\ncatalogue');
    const programs = await call('GET', '/programs');
    check('GET /programs returns the three schools', programs.status === 200 && programs.data.programs.length === 3, JSON.stringify(programs.data).slice(0, 120));
    const first = programs.data.programs[0];
    check('programmes carry a formatted fee', /^₦[\d,]+/.test(first.fee), first.fee);

    console.log('\napplicant account');
    const signup = await call('POST', '/auth/signup', {
      body: { firstName: 'Smoke', surname: 'Tester', email: 'smoke.tester@example.com', phone: '+234 800 000 0000', password: 'Testing@2026' },
    });
    check('sign up returns a token', signup.status === 201 && typeof signup.data.token === 'string', JSON.stringify(signup.data).slice(0, 120));
    const studentToken = signup.data.token;

    const duplicate = await call('POST', '/auth/signup', {
      body: { firstName: 'Smoke', surname: 'Tester', email: 'smoke.tester@example.com', phone: '+234 800 000 0000', password: 'Testing@2026' },
    });
    check('a duplicate email is rejected', duplicate.status === 409);

    const badLogin = await call('POST', '/auth/login', { body: { email: 'smoke.tester@example.com', password: 'wrong-password' } });
    check('a wrong password is rejected', badLogin.status === 401);

    const login = await call('POST', '/auth/login', { body: { email: 'smoke.tester@example.com', password: 'Testing@2026' } });
    check('sign in works', login.status === 200 && login.data.user.role === 'student');

    const me = await call('GET', '/auth/me', { token: studentToken });
    check('GET /auth/me resolves the session', me.status === 200 && me.data.user.email === 'smoke.tester@example.com');

    const noAuth = await call('GET', '/auth/me');
    check('an anonymous request is refused with 401', noAuth.status === 401);

    console.log('\napplication');
    const application = await call('POST', '/applications', {
      token: studentToken,
      body: {
        program: 'cybersecurity',
        firstName: 'Smoke',
        middleName: 'A.',
        surname: 'Tester',
        email: 'smoke.tester@example.com',
        phone: '+234 800 000 0000',
        gender: 'Female',
        dob: '2004-02-02',
        address: '12 Zaria Road, Jos',
        state: 'Plateau',
        nationality: 'Nigerian',
        qualification: "O'level (WAEC) — 6 credits",
        guardianName: 'Mr. Tester',
        guardianPhone: '+234 801 111 1111',
        photo: PHOTO,
      },
    });
    check('an application is accepted', application.status === 201 || application.status === 200, JSON.stringify(application.data).slice(0, 160));
    const ref = application.data.application.ref;
    check('it receives a reference number', /^FA-APP-\d{4}-\d{5}$/.test(ref || ''), ref);

    const second = await call('POST', '/applications', {
      token: studentToken,
      body: { program: 'cybersecurity', firstName: 'Smoke', surname: 'Tester', email: 'smoke.tester@example.com', phone: '1', gender: 'Female', dob: '2004-02-02', address: 'x', state: 'Plateau', qualification: 'waec', photo: PHOTO },
    });
    check('a second application is refused', second.status === 409);

    const mine = await call('GET', '/applications/mine', { token: studentToken });
    check('the applicant sees it as pending', mine.status === 200 && mine.data.application.status === 'pending');

    console.log('\nadministrator');
    const adminLogin = await call('POST', '/auth/login', { body: { email: 'admin@freshemiaacademy.edu.ng', password: ADMIN_PASSWORD } });
    check('the administrator can sign in', adminLogin.status === 200 && adminLogin.data.user.role === 'admin', JSON.stringify(adminLogin.data).slice(0, 120));
    const adminToken = adminLogin.data.token;

    const forbidden = await call('GET', '/admin/stats', { token: studentToken });
    check('an applicant cannot open the console', forbidden.status === 403);

    const stats = await call('GET', '/admin/stats', { token: adminToken });
    check('the overview counts one pending application', stats.status === 200 && stats.data.pending === 1, JSON.stringify(stats.data).slice(0, 160));

    const register = await call('GET', '/admin/applications', { token: adminToken });
    check('the register lists the application', register.status === 200 && register.data.applications.length === 1);

    const id = register.data.applications[0].id;
    const detail = await call('GET', `/admin/applications/${id}`, { token: adminToken });
    check('the review drawer returns the uploaded photo', !!detail.data.documents.photo);

    const approve = await call('POST', `/admin/applications/${id}/approve`, {
      token: adminToken,
      body: { note: 'Entry requirements verified. Welcome to Freshemia Academy.' },
    });
    check('approval issues an admission number', /^FA\/\d{2}\/[A-Z0-9]{2,5}\/\d{4}$/.test(approve.data.application.admissionNumber || ''), approve.data.application.admissionNumber);

    const admissionNumber = approve.data.application.admissionNumber;

    const dashboard = await call('GET', '/applications/mine', { token: studentToken });
    check('the applicant sees the admission', dashboard.data.application.status === 'approved');
    check('the admission payload carries a QR code', String(dashboard.data.admission?.qrDataUrl || '').startsWith('data:image/svg+xml;base64,'));

    const verify = await call('GET', '/verify/' + encodeURIComponent(admissionNumber.replace(/\//g, '-')));
    check('the admission number verifies publicly', verify.status === 200 && verify.data.valid === true, JSON.stringify(verify.data).slice(0, 160));

    const verifyBad = await call('GET', '/verify/FA-26-XXX-9999');
    check('an unknown admission number does not verify', verifyBad.status === 404);

    console.log('\nprogrammes and fees');
    const raise = await call('PATCH', '/admin/programs/cybersecurity', { token: adminToken, body: { feeAmount: 210000 } });
    check('a fee can be changed', raise.status === 200 && raise.data.program.feeAmount === 210000);

    const catalogue = await call('GET', '/programs');
    const cyber = catalogue.data.programs.find((program) => program.id === 'cybersecurity');
    check('the new fee is published to the website', cyber.fee.includes('210,000'), cyber.fee);

    const add = await call('POST', '/admin/programs', {
      token: adminToken,
      body: { name: 'Data Analytics', code: 'DAT', duration: '12 months', feeAmount: 150000, feePeriod: 'per session', accent: 'ai' },
    });
    check('a programme can be added', add.status === 201 && !!add.data.program.id);

    const blocked = await call('DELETE', '/admin/programs/cybersecurity', { token: adminToken });
    check('a programme in use cannot be deleted without force', blocked.status === 409);

    console.log('\nclean-up');
    const removed = await call('DELETE', `/admin/applications/${id}?account=1`, { token: adminToken });
    check('the application and its account can be deleted', removed.status === 200 && removed.data.ok === true && removed.data.accountDeleted === true);

    const gone = await call('GET', '/applications/mine', { token: studentToken });
    check('the deleted session no longer resolves', gone.status === 401);

    const health = await call('GET', '/health');
    check('the health endpoint reports the database', health.status === 200 && health.data.ok === true);
  } finally {
    server.kill('SIGTERM');
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error('\nsmoke test could not run:', err.message);
  process.exit(1);
});
