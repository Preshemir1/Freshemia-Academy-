#!/usr/bin/env node
/* ==========================================================================
   Freshemia Academy — portal server
   --------------------------------------------------------------------------
   One Node process serves the website (public/index.html) and the JSON API it
   talks to. Records live in data/db.json, which must be on a persistent disk
   in production.

   Environment (all optional except ADMIN_PASSWORD in production):
     PORT            port to listen on                            (default 3000)
     HOST            interface to bind                            (default 0.0.0.0)
     DATA_DIR        where db.json + secret.key live              (default ./data)
     ADMIN_EMAIL     administrator e-mail   (default admin@freshemiaacademy.edu.ng)
     ADMIN_PASSWORD  administrator password (default Freshemia@2026 — change it!)
     SEED_DEMO       1 = always seed the six demo applicants,
                     0 = never, unset = seed only outside production
     SESSION_DAYS    applicant/administrator session lifetime     (default 30)
   ========================================================================== */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const qrcode = require('./src/vendor/qrcode.js');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const PROGRAMS_FILE = path.join(ROOT, 'shared', 'programs.json');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@freshemiaacademy.edu.ng').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Freshemia@2026';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const IS_PROD = process.env.NODE_ENV === 'production';

/* -------------------------------------------------------------------------- */
/* Small utilities                                                            */
/* -------------------------------------------------------------------------- */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => {
  throw new HttpError(status, message);
};

const nowISO = () => new Date().toISOString();
const uid = () => crypto.randomBytes(8).toString('hex');
const text = (value) => String(value == null ? '' : value).trim();

function slug(value) {
  return (
    String(value)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'programme'
  );
}

/* -------------------------------------------------------------------------- */
/* Passwords and session tokens                                               */
/* -------------------------------------------------------------------------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  let actual;
  try {
    actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  } catch {
    return false;
  }
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** The signing key is generated once and kept beside the database. */
function loadSecret() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (process.env.SESSION_SECRET) return Buffer.from(process.env.SESSION_SECRET);
  if (fs.existsSync(SECRET_FILE)) return Buffer.from(fs.readFileSync(SECRET_FILE, 'utf8').trim(), 'hex');
  const secret = crypto.randomBytes(32);
  fs.writeFileSync(SECRET_FILE, secret.toString('hex'), { mode: 0o600 });
  return secret;
}

const SECRET = loadSecret();

function signToken(user) {
  const body = Buffer.from(
    JSON.stringify({
      sub: user.id,
      role: user.role,
      iat: Date.now(),
      exp: Date.now() + SESSION_DAYS * 864e5,
    })
  ).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/** Returns the token payload, or null when the token is missing, forged or expired. */
function readToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.sub !== 'string') return null;
  if (typeof payload.exp === 'number' && payload.exp < Date.now()) return null;
  return payload;
}

/* -------------------------------------------------------------------------- */
/* The database — a single JSON file                                          */
/* -------------------------------------------------------------------------- */

let db = null;

function defaultPrograms() {
  const file = JSON.parse(fs.readFileSync(PROGRAMS_FILE, 'utf8'));
  const out = {};
  Object.values(file).forEach((program) => {
    out[program.id] = {
      ...program,
      feeAmount: typeof program.feeAmount === 'number' ? program.feeAmount : Number(String(program.fee || '').replace(/[^0-9]/g, '')) || 0,
      feePeriod: program.feePeriod || 'per session',
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
  });
  return out;
}

function emptyDb() {
  return {
    users: [],
    applications: [],
    programs: defaultPrograms(),
    counters: { application: 0, admission: 0 },
    createdAt: nowISO(),
  };
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function load() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      return {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        applications: Array.isArray(parsed.applications) ? parsed.applications : [],
        programs: parsed.programs && Object.keys(parsed.programs).length ? parsed.programs : defaultPrograms(),
        counters: { application: 0, admission: 0, ...(parsed.counters || {}) },
        createdAt: parsed.createdAt || nowISO(),
      };
    } catch (err) {
      console.error('data/db.json is not readable — keeping it aside and starting a fresh database.');
      fs.renameSync(DB_FILE, `${DB_FILE}.corrupt-${Date.now()}`);
    }
  }
  return emptyDb();
}

/* -------------------------------------------------------------------------- */
/* Programmes and applications helpers                                        */
/* -------------------------------------------------------------------------- */

function feeLabel(program) {
  if (!program) return '';
  if (program.feeAmount !== undefined && program.feeAmount !== null && program.feeAmount !== '') {
    return '₦' + Number(program.feeAmount).toLocaleString('en-NG') + (program.feePeriod ? ' ' + program.feePeriod : '');
  }
  return program.fee || '';
}

const publicProgram = (program) => ({ ...program, fee: feeLabel(program) });
const getProgram = (id) => (db.programs && db.programs[id]) || null;

function programOf(application) {
  const live = getProgram(application.program);
  const snapshot = application.programSnapshot || {};
  return {
    id: application.program,
    name: snapshot.name || (live && live.name) || application.program,
    school: snapshot.school || (live && live.school) || '',
    award: snapshot.award || (live && live.award) || '',
    duration: snapshot.duration || (live && live.duration) || '',
    fee: live ? feeLabel(live) : snapshot.fee || '',
  };
}

/** The shape the browser expects for every application record. */
function sanitize(application) {
  const program = programOf(application);
  return {
    id: application.id,
    ref: application.ref,
    userId: application.userId,
    program: application.program,
    programName: program.name || application.program,
    programSchool: program.school || '',
    award: program.award || '',
    fee: program.fee || '',
    applicant: application.applicant,
    intake: application.intake,
    status: application.status,
    submittedAt: application.submittedAt,
    reviewedAt: application.reviewedAt || null,
    reviewedBy: application.reviewedBy || null,
    reviewNote: application.reviewNote || '',
    admissionNumber: application.admissionNumber || null,
    checklist: application.checklist || [],
  };
}

const publicUser = (user) => ({
  id: user.id,
  firstName: user.firstName,
  surname: user.surname,
  email: user.email,
  phone: user.phone,
  role: user.role,
  createdAt: user.createdAt,
});

function admissionNumber(program, n) {
  const catalogue = getProgram(program);
  const yy = String(new Date().getFullYear()).slice(-2);
  return `FA/${yy}/${catalogue ? catalogue.code : 'GEN'}/${String(n).padStart(4, '0')}`;
}

function qrDataUrl(value) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(String(value));
    qr.make();
    const svg = qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
    return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
  } catch {
    return '';
  }
}

function admissionPayload(application, baseUrl) {
  const program = programOf(application);
  const base = String(baseUrl || '').replace(/#.*$/, '');
  const verifyUrl = `${base}#/verify/${String(application.admissionNumber).replace(/\//g, '-')}`;
  const text = `FRESHEMIA ACADEMY | ${application.admissionNumber} | ${application.applicant.firstName} ${application.applicant.surname} | ${program.name || ''} | ${verifyUrl}`;
  return {
    admissionNumber: application.admissionNumber,
    verifyUrl,
    qrDataUrl: qrDataUrl(text),
    program: program.name || application.program,
    award: program.award || '',
    school: program.school || '',
    duration: program.duration || '',
    issuedAt: application.reviewedAt,
  };
}

function programmeSnapshot(programId) {
  const program = programOf({ program: programId });
  return { name: program.name, school: program.school, award: program.award, duration: program.duration, fee: program.fee };
}

/* -------------------------------------------------------------------------- */
/* Demo seed (local development and demos)                                    */
/* -------------------------------------------------------------------------- */

function avatar(initials, colour) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600" viewBox="0 0 480 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colour}"/><stop offset="1" stop-color="#0a2540"/></linearGradient></defs><rect width="480" height="600" fill="url(#g)"/><circle cx="240" cy="235" r="92" fill="#ffffff" opacity="0.16"/><path d="M100 600c0-92 63-160 140-160s140 68 140 160z" fill="#ffffff" opacity="0.16"/><text x="240" y="270" font-family="Georgia,serif" font-size="96" fill="#ffffff" text-anchor="middle" opacity="0.92">${initials}</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}

function seedDemo() {
  const year = new Date().getFullYear();
  const colours = ['#16406f', '#0e7d8b', '#6b46c1', '#b3660d', '#1b6b48', '#8a3a5b'];
  const rows = [
    ['Amina', 'Bello', 'Yusuf', 'cybersecurity', 'Female', '2004-04-12', 'Plateau', "O'level (WAEC) — 6 credits", 'approved', 'amina.yusuf@example.com', '+234 806 221 4471', 12],
    ['Chinedu', 'Emeka', 'Okafor', 'artificial_intelligence', 'Male', '2003-09-30', 'Enugu', "O'level (WAEC) — 7 credits", 'pending', 'chinedu.okafor@example.com', '+234 813 774 2200', 4],
    ['Fatima', '', 'Sani', 'computer_operator', 'Female', '2006-01-18', 'Kaduna', 'SSCE in view', 'pending', 'fatima.sani@example.com', '+234 705 900 8832', 2],
    ['Tunde', 'Samuel', 'Adeyemi', 'cybersecurity', 'Male', '2002-06-05', 'Lagos', 'ND Computer Science', 'approved', 'tunde.adeyemi@example.com', '+234 802 441 6678', 20],
    ['Blessing', 'Danjuma', 'Ishaku', 'artificial_intelligence', 'Female', '2005-11-22', 'Plateau', "O'level (NECO) — 5 credits", 'pending', 'blessing.ishaku@example.com', '+234 811 330 5512', 1],
    ['Ibrahim', '', 'Musa', 'computer_operator', 'Male', '2007-03-09', 'Bauchi', "O'level — 3 credits", 'rejected', 'ibrahim.musa@example.com', '+234 708 662 9014', 8],
  ];

  rows.forEach((row, i) => {
    const [firstName, middleName, surname, program, gender, dob, state, qualification, status, email, phone, days] = row;
    const joined = new Date(Date.now() - days * 864e5).toISOString();
    const user = {
      id: uid(),
      firstName,
      surname,
      email,
      phone,
      role: 'student',
      password: hashPassword('Student@2026'),
      createdAt: joined,
    };
    db.users.push(user);
    db.counters.application += 1;

    const application = {
      id: uid(),
      ref: `FA-APP-${year}-${String(db.counters.application).padStart(5, '0')}`,
      userId: user.id,
      program,
      applicant: {
        firstName,
        middleName,
        surname,
        email,
        phone,
        gender,
        dob,
        address: `${i + 3} Zaria Road, Jos`,
        state,
        nationality: 'Nigerian',
        qualification,
        guardianName: 'Mr. ' + surname,
        guardianPhone: '+234 809 111 2233',
        photo: avatar(firstName[0] + surname[0], colours[i % colours.length]),
        idDoc: null,
        resultDoc: null,
      },
      checklist: [
        { label: 'Passport photograph', ok: true },
        { label: "O'level / result document", ok: false },
        { label: 'Means of identification', ok: false },
        { label: 'Contact details verified', ok: true },
      ],
      programSnapshot: programmeSnapshot(program),
      intake: `${year}/${year + 1} academic session`,
      status,
      submittedAt: joined,
      reviewedAt: status === 'pending' ? null : new Date(Date.now() - (days - 1) * 864e5).toISOString(),
      reviewedBy: status === 'pending' ? null : 'Grace Ademola',
      reviewNote:
        status === 'approved'
          ? 'Entry requirements verified. Welcome to Freshemia Academy.'
          : status === 'rejected'
          ? 'Entry requirement not met: Mathematics credit is outstanding. You may re-apply once your result is available.'
          : '',
      admissionNumber: null,
    };

    if (status === 'approved') {
      db.counters.admission += 1;
      application.admissionNumber = admissionNumber(program, db.counters.admission);
    }
    db.applications.push(application);
  });
}

/* -------------------------------------------------------------------------- */
/* Boot: seed the administrator and (optionally) the demo records             */
/* -------------------------------------------------------------------------- */

function bootstrap() {
  db = load();
  const fresh = !fs.existsSync(DB_FILE);
  let changed = fresh;

  if (!db.users.some((user) => user.role === 'admin')) {
    db.users.push({
      id: uid(),
      firstName: process.env.ADMIN_FIRST_NAME || 'Grace',
      surname: process.env.ADMIN_LAST_NAME || 'Ademola',
      email: ADMIN_EMAIL,
      phone: process.env.ADMIN_PHONE || '+234 803 000 1122',
      role: 'admin',
      password: hashPassword(ADMIN_PASSWORD),
      createdAt: nowISO(),
    });
    changed = true;
    console.log(`administrator created: ${ADMIN_EMAIL}`);
  }

  const seedSetting = String(process.env.SEED_DEMO == null ? '' : process.env.SEED_DEMO).toLowerCase();
  const shouldSeed =
    seedSetting === '1' || seedSetting === 'true'
      ? true
      : seedSetting === '0' || seedSetting === 'false'
      ? false
      : !IS_PROD;

  if (shouldSeed && db.applications.length === 0 && db.users.filter((user) => user.role === 'student').length === 0) {
    seedDemo();
    changed = true;
    console.log('seeded six demo applications (SEED_DEMO=0 disables this)');
  }

  if (changed) save();
  if (IS_PROD && ADMIN_PASSWORD === 'Freshemia@2026') {
    console.warn('WARNING: ADMIN_PASSWORD is still the default — set your own before collecting real applications.');
  }
}

/* -------------------------------------------------------------------------- */
/* Authentication middleware                                                  */
/* -------------------------------------------------------------------------- */

function currentUser(req) {
  const header = req.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  const payload = readToken(token);
  if (!payload) return null;
  return db.users.find((user) => user.id === payload.sub) || null;
}

function need(req, role) {
  const user = currentUser(req);
  if (!user) fail(401, 'Please sign in to continue.');
  if (role && user.role !== role) fail(403, 'You do not have access to this area.');
  return user;
}

/* -------------------------------------------------------------------------- */
/* The API                                                                    */
/* -------------------------------------------------------------------------- */

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

/* -------------------------------------------------------------------------- */
/* CORS                                                                       */
/* -------------------------------------------------------------------------- */
/* The website is often served somewhere other than this API — GitHub Pages, a */
/* preview link, a plain file — so the API must allow cross-origin calls.      */
/* Tokens travel in the Authorization header, never in cookies, so wildcard    */
/* origins carry no credential-leak risk.                                      */
/*                                                                            */
/* ALLOWED_ORIGINS=https://preshemir1.github.io,https://admissions.example.edu */
/*   → only those origins may call the API (wildcards like https://*.onrender  */
/*     .com are accepted; a trailing slash is ignored)                        */
/* ALLOWED_ORIGINS unset → every origin may call it (the default)             */

const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function originAllowed(origin) {
  const clean = String(origin || '').replace(/\/+$/, '');
  if (!clean) return true; // same-origin, curl, health checks, server-to-server
  if (ALLOWED_ORIGINS.length === 0) return true;
  return ALLOWED_ORIGINS.some((rule) => {
    if (rule === '*') return true;
    if (rule.includes('*')) {
      const pattern = new RegExp('^' + rule.split('*').map(escapeRegex).join('[^/]*') + '$', 'i');
      return pattern.test(clean);
    }
    return rule.toLowerCase() === clean.toLowerCase();
  });
}

app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin) {
    res.setHeader('Vary', 'Origin');
    if (originAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    } else if (req.method === 'OPTIONS') {
      return res.status(403).json({ error: `Origin ${origin} is not allowed. Add it to ALLOWED_ORIGINS on the server.` });
    }
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Passport photographs arrive as base64 data URLs, so the body limit is generous.
app.use(express.json({ limit: '15mb' }));

const api = express.Router();
app.use('/api', api);

api.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'freshemia-academy',
    programmes: Object.keys(db.programs).length,
    applications: db.applications.length,
    demoSeeded: db.applications.length > 0 && db.users.some((user) => user.email === 'tunde.adeyemi@example.com'),
    time: nowISO(),
  });
});

/* ---- catalogue (public) -------------------------------------------------- */
api.get('/programs', (req, res) => {
  res.json({ programs: Object.values(db.programs).map(publicProgram) });
});

/* ---- accounts ------------------------------------------------------------ */
api.post('/auth/signup', (req, res) => {
  const body = req.body || {};
  const email = text(body.email).toLowerCase();
  if (!text(body.firstName) || !text(body.surname) || !email || !text(body.phone) || !body.password) {
    fail(400, 'All fields are required.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) fail(400, 'Enter a valid email address.');
  if (String(body.password).length < 8) fail(400, 'Password must be at least 8 characters.');
  if (db.users.some((user) => user.email === email)) {
    fail(409, 'An account with that email already exists. Please sign in.');
  }

  const user = {
    id: uid(),
    firstName: text(body.firstName),
    surname: text(body.surname),
    email,
    phone: text(body.phone),
    role: 'student',
    password: hashPassword(body.password),
    createdAt: nowISO(),
  };
  db.users.push(user);
  save();
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

api.post('/auth/login', (req, res) => {
  const body = req.body || {};
  const email = text(body.email).toLowerCase();
  const user = db.users.find((candidate) => candidate.email === email);
  if (!user || !verifyPassword(body.password || '', user.password)) {
    fail(401, 'Invalid email or password.');
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

api.get('/auth/me', (req, res) => {
  const user = need(req);
  res.json({ user: publicUser(user) });
});

api.post('/auth/logout', (req, res) => {
  // Tokens are stateless; the browser simply forgets its copy.
  res.json({ ok: true });
});

/* ---- public verification ------------------------------------------------- */
api.get('/verify/:number', (req, res) => {
  const target = decodeURIComponent(req.params.number).replace(/-/g, '/').toLowerCase();
  const application = db.applications.find(
    (item) => item.status === 'approved' && item.admissionNumber && item.admissionNumber.toLowerCase() === target
  );
  if (!application) fail(404, 'No admission record matches that number.');
  const program = programOf(application);
  res.json({
    valid: true,
    admissionNumber: application.admissionNumber,
    student: `${application.applicant.firstName} ${application.applicant.surname}`,
    program: program.name || application.program,
    award: program.award || '',
    issuedAt: application.reviewedAt,
    status: 'Admitted',
  });
});

/* ---- the applicant's own application ------------------------------------- */
api.get('/applications/mine', (req, res) => {
  const user = need(req, 'student');
  const mine = db.applications
    .filter((item) => item.userId === user.id)
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))[0];
  if (!mine) return res.json({ application: null });

  const payload = { application: sanitize(mine) };
  if (mine.status === 'approved' && mine.admissionNumber) {
    payload.admission = admissionPayload(mine, `${req.protocol}://${req.get('host')}/`);
  }
  res.json(payload);
});

api.post('/applications', (req, res) => {
  const user = need(req, 'student');
  const body = req.body || {};
  if (!getProgram(body.program)) fail(400, 'Please choose a programme of study.');

  const required = ['firstName', 'surname', 'email', 'phone', 'gender', 'dob', 'address', 'state', 'qualification'];
  const missing = required.filter((key) => !text(body[key]));
  if (missing.length) fail(400, 'Please complete all required fields.');
  if (!body.photo) fail(400, 'A passport photograph is required.');

  const existing = db.applications.find((item) => item.userId === user.id);
  if (existing && existing.status !== 'rejected') {
    fail(409, 'You already submitted an application this session.');
  }

  const year = new Date().getFullYear();
  const applicant = {
    firstName: text(body.firstName),
    middleName: text(body.middleName),
    surname: text(body.surname),
    email: text(body.email).toLowerCase(),
    phone: text(body.phone),
    gender: text(body.gender),
    dob: text(body.dob),
    address: text(body.address),
    state: text(body.state),
    nationality: text(body.nationality) || 'Nigerian',
    qualification: text(body.qualification),
    guardianName: text(body.guardianName),
    guardianPhone: text(body.guardianPhone),
    photo: body.photo,
    idDoc: body.idDoc || null,
    resultDoc: body.resultDoc || null,
  };

  const checklist = [
    { label: 'Passport photograph', ok: !!applicant.photo },
    { label: "O'level / result document", ok: !!applicant.resultDoc },
    { label: 'Means of identification', ok: !!applicant.idDoc },
    { label: 'Contact details verified', ok: !!(applicant.email && applicant.phone) },
  ];

  let application = existing;
  if (application) {
    // A declined applicant may re-apply; the same record is reused and reset.
    Object.assign(application, {
      program: body.program,
      applicant,
      checklist,
      programSnapshot: programmeSnapshot(body.program),
      status: 'pending',
      submittedAt: nowISO(),
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: '',
      admissionNumber: null,
    });
  } else {
    db.counters.application += 1;
    application = {
      id: uid(),
      ref: `FA-APP-${year}-${String(db.counters.application).padStart(5, '0')}`,
      userId: user.id,
      program: body.program,
      applicant,
      checklist,
      programSnapshot: programmeSnapshot(body.program),
      intake: `${year}/${year + 1} academic session`,
      status: 'pending',
      submittedAt: nowISO(),
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: '',
      admissionNumber: null,
    };
    db.applications.push(application);
  }

  save();
  res.status(201).json({ application: sanitize(application) });
});

/* ---- administrator: overview and registers ------------------------------- */
api.get('/admin/stats', (req, res) => {
  need(req, 'admin');
  const applications = db.applications;
  res.json({
    programmes: Object.keys(db.programs).length,
    students: db.users.filter((user) => user.role === 'student').length,
    total: applications.length,
    pending: applications.filter((item) => item.status === 'pending').length,
    approved: applications.filter((item) => item.status === 'approved').length,
    rejected: applications.filter((item) => item.status === 'rejected').length,
    byProgram: Object.values(db.programs).map((program) => {
      const list = applications.filter((item) => item.program === program.id);
      return {
        id: program.id,
        name: program.name,
        total: list.length,
        pending: list.filter((item) => item.status === 'pending').length,
        approved: list.filter((item) => item.status === 'approved').length,
        rejected: list.filter((item) => item.status === 'rejected').length,
      };
    }),
    recent: applications
      .slice()
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
      .slice(0, 5)
      .map(sanitize),
  });
});

api.get('/admin/applications', (req, res) => {
  need(req, 'admin');
  const list = db.applications
    .slice()
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
    .map(sanitize);
  res.json({ applications: list, total: list.length });
});

api.get('/admin/students', (req, res) => {
  need(req, 'admin');
  const students = db.users
    .filter((user) => user.role === 'student')
    .map((user) => {
      const application = db.applications.find((item) => item.userId === user.id);
      return {
        id: user.id,
        name: `${user.firstName} ${user.surname}`,
        email: user.email,
        phone: user.phone,
        joined: user.createdAt,
        status: application ? application.status : 'no application',
        admissionNumber: application ? application.admissionNumber : null,
        program: application ? programOf(application).name : '—',
        ref: application ? application.ref : '—',
      };
    })
    .sort((a, b) => new Date(b.joined) - new Date(a.joined));
  res.json({ students });
});

/* ---- administrator: review one application ------------------------------- */
api.get('/admin/applications/:id', (req, res) => {
  need(req, 'admin');
  const application = db.applications.find((item) => item.id === req.params.id || item.ref === req.params.id);
  if (!application) fail(404, 'Application not found.');
  res.json({ application: sanitize(application), documents: { ...application.applicant } });
});

api.post('/admin/applications/:id/approve', (req, res) => {
  const admin = need(req, 'admin');
  const application = db.applications.find((item) => item.id === req.params.id || item.ref === req.params.id);
  if (!application) fail(404, 'Application not found.');
  if (application.status === 'approved') fail(409, 'This application has already been approved.');

  application.status = 'approved';
  application.reviewedAt = nowISO();
  application.reviewedBy = `${admin.firstName} ${admin.surname}`;
  application.reviewNote = text((req.body || {}).note);
  if (!application.admissionNumber) {
    db.counters.admission += 1;
    application.admissionNumber = admissionNumber(application.program, db.counters.admission);
  }
  save();
  res.json({ application: sanitize(application) });
});

api.post('/admin/applications/:id/reject', (req, res) => {
  const admin = need(req, 'admin');
  const application = db.applications.find((item) => item.id === req.params.id || item.ref === req.params.id);
  if (!application) fail(404, 'Application not found.');

  const note = text((req.body || {}).note);
  if (!note) fail(400, 'Please give a reason for the decision (shown to the applicant).');

  application.status = 'rejected';
  application.reviewedAt = nowISO();
  application.reviewedBy = `${admin.firstName} ${admin.surname}`;
  application.reviewNote = note;
  application.admissionNumber = null;
  save();
  res.json({ application: sanitize(application) });
});

/* ---- administrator: deletes ---------------------------------------------- */
api.delete('/admin/applications/:id', (req, res) => {
  need(req, 'admin');
  const index = db.applications.findIndex((item) => item.id === req.params.id || item.ref === req.params.id);
  if (index < 0) fail(404, 'Application not found.');

  const removed = db.applications.splice(index, 1)[0];
  let accountDeleted = false;
  const withAccount = String(req.query.account || '') === '1' || (req.body || {}).account === true;

  if (withAccount) {
    const owner = db.users.find((user) => user.id === removed.userId);
    if (owner && owner.role !== 'admin') {
      db.users = db.users.filter((user) => user.id !== owner.id);
      db.applications = db.applications.filter((item) => item.userId !== owner.id);
      accountDeleted = true;
    }
  }
  save();
  res.json({ ok: true, deleted: removed.ref, accountDeleted });
});

api.delete('/admin/students/:id', (req, res) => {
  need(req, 'admin');
  const user = db.users.find((candidate) => candidate.id === req.params.id && candidate.role === 'student');
  if (!user) fail(404, 'Account not found.');
  db.users = db.users.filter((candidate) => candidate.id !== user.id);
  db.applications = db.applications.filter((item) => item.userId !== user.id);
  save();
  res.json({ ok: true, deleted: `${user.firstName} ${user.surname}` });
});

/* ---- administrator: programmes and fees ----------------------------------- */
const ACCENTS = ['cyber', 'ai', 'cop'];

function readProgram(body, existing) {
  const pick = (key, fallback) => (body[key] !== undefined ? body[key] : existing ? existing[key] : fallback);
  const name = text(pick('name', ''));
  if (!name) fail(400, 'Programme name is required.');

  const code = text(pick('code', '') || name.slice(0, 3)).toUpperCase();
  if (!/^[A-Z0-9]{2,5}$/.test(code)) fail(400, 'Programme code must be 2–5 letters or digits (it appears in admission numbers).');

  const feeAmount = Number(String(pick('feeAmount', 0)).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(feeAmount) || feeAmount < 0) fail(400, 'Enter a valid tuition amount (numbers only).');

  const duration = text(pick('duration', ''));
  if (!duration) fail(400, 'Programme duration is required (e.g. 24 months).');

  let modules = pick('modules', []);
  if (typeof modules === 'string') modules = modules.split(',').map((item) => item.trim()).filter(Boolean);
  if (!Array.isArray(modules)) modules = [];

  const accent = pick('accent', '');
  return {
    name,
    code,
    school: text(pick('school', '')) || 'School of Computing & Cyber Sciences',
    award: text(pick('award', '')) || `Diploma in ${name}`,
    duration,
    summary: text(pick('summary', '')),
    entry: text(pick('entry', '')),
    feeAmount,
    feePeriod: text(pick('feePeriod', '')) || 'per session',
    accent: ACCENTS.includes(accent) ? accent : 'cyber',
    modules: modules.slice(0, 12),
  };
}

api.post('/admin/programs', (req, res) => {
  need(req, 'admin');
  const value = readProgram(req.body || {}, null);
  let id = slug(value.name);
  if (db.programs[id]) id = `${id}_${Object.keys(db.programs).length + 1}`;
  db.programs[id] = { id, ...value, createdAt: nowISO(), updatedAt: nowISO() };
  save();
  res.status(201).json({ program: publicProgram(db.programs[id]) });
});

api.patch('/admin/programs/:id', (req, res) => {
  need(req, 'admin');
  const program = getProgram(req.params.id);
  if (!program) fail(404, 'Programme not found.');
  Object.assign(program, readProgram(req.body || {}, program), { updatedAt: nowISO() });
  save();
  res.json({ program: publicProgram(program) });
});

api.delete('/admin/programs/:id', (req, res) => {
  need(req, 'admin');
  const program = getProgram(req.params.id);
  if (!program) fail(404, 'Programme not found.');
  if (Object.keys(db.programs).length <= 1) fail(400, 'At least one programme must remain on the catalogue.');

  const linked = db.applications.filter((item) => item.program === req.params.id).length;
  const force = String(req.query.force || '') === '1' || (req.body || {}).force === true;
  if (linked && !force) {
    fail(
      409,
      `${linked} application${linked === 1 ? '' : 's'} already reference this programme. Remove it anyway? Existing applications keep their details.`
    );
  }
  delete db.programs[req.params.id];
  save();
  res.json({ ok: true, removed: program.name, applicationsKept: linked });
});

/* ---- unmatched API routes and errors ------------------------------------- */
api.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || (err.type === 'entity.too.large' ? 413 : 500);
  const message =
    err.type === 'entity.too.large'
      ? 'That upload is too large. Please use a smaller photograph.'
      : status >= 500
      ? 'Something went wrong on the server. Please try again.'
      : err.message;
  if (status >= 500) console.error(err);
  if (req.path.startsWith('/api')) return res.status(status).json({ error: message });
  res.status(status).type('text/plain').send(message);
});

/* -------------------------------------------------------------------------- */
/* The website                                                                */
/* -------------------------------------------------------------------------- */

app.use(
  express.static(PUBLIC_DIR, {
    index: 'index.html',
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store');
      else res.setHeader('Cache-Control', 'public, max-age=3600');
    },
  })
);

// Everything else is the single-page app.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!fs.existsSync(INDEX_FILE)) {
    return res.status(503).type('text/plain').send('public/index.html is missing — run `node build.js` first.');
  }
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(INDEX_FILE);
});

/* -------------------------------------------------------------------------- */
/* Start                                                                      */
/* -------------------------------------------------------------------------- */

bootstrap();

const server = app.listen(PORT, HOST, () => {
  const base = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
  console.log(`Freshemia Academy portal listening on ${base}`);
  console.log(`database: ${DB_FILE}`);
  console.log(`applications: ${db.applications.length} · students: ${db.users.filter((u) => u.role === 'student').length}`);
  console.log(`cors: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : 'any origin'}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} — shutting down`);
    server.close(() => process.exit(0));
  });
}

module.exports = { app };
