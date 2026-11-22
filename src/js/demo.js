/* ==========================================================================
   Offline demo engine
   --------------------------------------------------------------------------
   The portal talks to the Express API when it is available. If this file is
   opened on its own (file://, a static host, or the in-app file viewer) there
   is no server, so this module answers the same API calls using localStorage.
   Nothing here is used when the real server is running.
   ========================================================================== */
(function () {
  'use strict';

  const PROGRAMS = window.FA_PROGRAMS || {};
  const KEY = 'fa_demo_db_v1';

  let db = null;

  const uid = () => Math.random().toString(36).slice(2, 12);
  const nowISO = () => new Date().toISOString();
  const hash = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'h' + h.toString(36);
  };

  /* ---------------------------- storage ---------------------------- */
  let memoryCopy = null; // used when localStorage is unavailable (file://)

  function save() {
    memoryCopy = JSON.stringify(db);
    try {
      localStorage.setItem(KEY, memoryCopy);
    } catch {
      /* quota or blocked storage — the in-memory copy keeps the demo working */
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* blocked storage — use the in-memory copy if we have one */
    }
    if (memoryCopy) return JSON.parse(memoryCopy);
    return seed();
  }

  function avatar(initials, bg) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600" viewBox="0 0 480 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#0a2540"/></linearGradient></defs><rect width="480" height="600" fill="url(#g)"/><circle cx="240" cy="235" r="92" fill="#ffffff" opacity="0.16"/><path d="M100 600c0-92 63-160 140-160s140 68 140 160z" fill="#ffffff" opacity="0.16"/><text x="240" y="270" font-family="Georgia,serif" font-size="96" fill="#ffffff" text-anchor="middle" opacity="0.92">${initials}</text></svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }

  const slug = (text) =>
    String(text).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'programme';

  function seedPrograms() {
    const out = {};
    Object.values(PROGRAMS).forEach((p) => {
      const digits = String(p.fee || '').replace(/[^0-9]/g, '');
      out[p.id] = {
        ...p,
        feeAmount: typeof p.feeAmount === 'number' ? p.feeAmount : digits ? Number(digits) : 0,
        feePeriod: p.feePeriod || (/term/i.test(p.fee || '') ? 'per term' : 'per session'),
        createdAt: nowISO(),
      };
    });
    return out;
  }

  function feeLabel(p) {
    if (!p) return '';
    if (p.feeAmount !== undefined && p.feeAmount !== null && p.feeAmount !== '') {
      return '₦' + Number(p.feeAmount).toLocaleString('en-NG') + (p.feePeriod ? ' ' + p.feePeriod : '');
    }
    return p.fee || '';
  }

  const publicProgram = (p) => ({ ...p, fee: feeLabel(p) });
  const getProgram = (id) => (db.programs && db.programs[id]) || null;

  function programOf(a) {
    const live = getProgram(a.program);
    const snap = a.programSnapshot || {};
    return {
      id: a.program,
      name: snap.name || (live && live.name) || a.program,
      school: snap.school || (live && live.school) || '',
      award: snap.award || (live && live.award) || '',
      duration: snap.duration || (live && live.duration) || '',
      fee: live ? feeLabel(live) : snap.fee || '',
    };
  }

  function seed() {
    const year = new Date().getFullYear();
    const fresh = { users: [], applications: [], programs: seedPrograms(), counters: { application: 0, admission: 0 } };
    // make the catalogue reachable while we mint the demo admission numbers below
    db = fresh;

    fresh.users.push({
      id: 'demo-admin',
      firstName: 'Grace',
      surname: 'Ademola',
      email: 'admin@freshemiaacademy.edu.ng',
      phone: '+234 803 000 1122',
      role: 'admin',
      pass: hash('Freshemia@2026'),
      createdAt: nowISO(),
    });

    const demo = [
      ['Amina', 'Bello', 'Yusuf', 'cybersecurity', 'Female', '2004-04-12', 'Plateau', "O'level (WAEC) — 6 credits", 'approved', 'amina.yusuf@example.com', '+234 806 221 4471', 12],
      ['Chinedu', 'Emeka', 'Okafor', 'artificial_intelligence', 'Male', '2003-09-30', 'Enugu', "O'level (WAEC) — 7 credits", 'pending', 'chinedu.okafor@example.com', '+234 813 774 2200', 4],
      ['Fatima', '', 'Sani', 'computer_operator', 'Female', '2006-01-18', 'Kaduna', 'SSCE in view', 'pending', 'fatima.sani@example.com', '+234 705 900 8832', 2],
      ['Tunde', 'Samuel', 'Adeyemi', 'cybersecurity', 'Male', '2002-06-05', 'Lagos', 'ND Computer Science', 'approved', 'tunde.adeyemi@example.com', '+234 802 441 6678', 20],
      ['Blessing', 'Danjuma', 'Ishaku', 'artificial_intelligence', 'Female', '2005-11-22', 'Plateau', "O'level (NECO) — 5 credits", 'pending', 'blessing.ishaku@example.com', '+234 811 330 5512', 1],
      ['Ibrahim', '', 'Musa', 'computer_operator', 'Male', '2007-03-09', 'Bauchi', "O'level — 3 credits", 'rejected', 'ibrahim.musa@example.com', '+234 708 662 9014', 8],
    ];

    const colours = ['#16406f', '#0e7d8b', '#6b46c1', '#b3660d', '#1b6b48', '#8a3a5b'];

    demo.forEach((d, i) => {
      const [first, middle, last, program, gender, dob, state, qual, status, email, phone, days] = d;
      const user = {
        id: uid(),
        firstName: first,
        surname: last,
        email,
        phone,
        role: 'student',
        pass: hash('Student@2026'),
        createdAt: new Date(Date.now() - days * 864e5).toISOString(),
      };
      fresh.users.push(user);
      fresh.counters.application += 1;
      const app = {
        id: uid(),
        ref: `FA-APP-${year}-${String(fresh.counters.application).padStart(5, '0')}`,
        userId: user.id,
        program,
        applicant: {
          firstName: first,
          middleName: middle,
          surname: last,
          email,
          phone,
          gender,
          dob,
          address: `${i + 3} Zaria Road, Jos`,
          state,
          nationality: 'Nigerian',
          qualification: qual,
          guardianName: 'Mr. ' + last,
          guardianPhone: '+234 809 111 2233',
          photo: avatar(first[0] + last[0], colours[i % colours.length]),
          idDoc: null,
          resultDoc: null,
        },
        checklist: [
          { label: 'Passport photograph', ok: true },
          { label: "O'level / result document", ok: false },
          { label: 'Means of identification', ok: false },
          { label: 'Contact details verified', ok: true },
        ],
        programSnapshot: {
          name: (fresh.programs[program] || {}).name || program,
          school: (fresh.programs[program] || {}).school || '',
          award: (fresh.programs[program] || {}).award || '',
          duration: (fresh.programs[program] || {}).duration || '',
          fee: feeLabel(fresh.programs[program]),
        },
        intake: `${year}/${year + 1} academic session`,
        status,
        submittedAt: new Date(Date.now() - days * 864e5).toISOString(),
        reviewedAt: status === 'pending' ? null : new Date(Date.now() - (days - 1) * 864e5).toISOString(),
        reviewedBy: status === 'pending' ? null : 'Grace Ademola',
        reviewNote: status === 'approved' ? 'Entry requirements verified. Welcome to Freshemia Academy.' : status === 'rejected' ? "Entry requirement not met: Mathematics credit is outstanding. You may re-apply once your result is available." : '',
        admissionNumber: null,
      };
      if (status === 'approved') {
        fresh.counters.admission += 1;
        app.admissionNumber = admissionNumber(program, fresh.counters.admission);
      }
      fresh.applications.push(app);
    });

    db = fresh;
    save();
    return fresh;
  }

  function admissionNumber(program, n) {
    const p = getProgram(program);
    const yy = String(new Date().getFullYear()).slice(-2);
    return `FA/${yy}/${p ? p.code : 'GEN'}/${String(n).padStart(4, '0')}`;
  }

  /* ---------------------------- helpers ---------------------------- */
  function sanitize(a) {
    const p = programOf(a);
    return {
      id: a.id,
      ref: a.ref,
      userId: a.userId,
      program: a.program,
      programName: p.name || a.program,
      programSchool: p.school || '',
      award: p.award || '',
      fee: p.fee || '',
      applicant: a.applicant,
      intake: a.intake,
      status: a.status,
      submittedAt: a.submittedAt,
      reviewedAt: a.reviewedAt || null,
      reviewedBy: a.reviewedBy || null,
      reviewNote: a.reviewNote || '',
      admissionNumber: a.admissionNumber || null,
      checklist: a.checklist || [],
    };
  }

  function fail(message, status) {
    const err = new Error(message);
    err.status = status || 400;
    throw err;
  }

  function userFromToken(options) {
    const header = (options && options.headers && options.headers.Authorization) || '';
    const token = header.replace('Bearer ', '');
    if (!token) return null;
    const id = token.split('.').pop();
    return db.users.find((u) => u.id === id) || null;
  }

  function requireUser(options, role) {
    const user = userFromToken(options);
    if (!user) fail('Please sign in to continue.', 401);
    if (role && user.role !== role) fail('You do not have access to this area.', 403);
    return user;
  }

  function makeToken(user) {
    return 'demo.' + user.id;
  }

  function publicUser(u) {
    return { id: u.id, firstName: u.firstName, surname: u.surname, email: u.email, phone: u.phone, role: u.role, createdAt: u.createdAt };
  }

  function qr(text) {
    try {
      if (typeof window.qrcode !== 'function') return '';
      const q = window.qrcode(0, 'M');
      q.addData(text);
      q.make();
      return q.createDataURL(4, 8);
    } catch {
      return '';
    }
  }

  function admissionPayload(a) {
    const p = programOf(a);
    const base = location.href.split('#')[0];
    const verifyUrl = `${base}#/verify/${String(a.admissionNumber).replace(/\//g, '-')}`;
    const text = `FRESHEMIA ACADEMY | ${a.admissionNumber} | ${a.applicant.firstName} ${a.applicant.surname} | ${p.name || ''} | ${verifyUrl}`;
    return {
      admissionNumber: a.admissionNumber,
      verifyUrl,
      qrDataUrl: qr(text),
      program: p.name || a.program,
      award: p.award || '',
      school: p.school || '',
      duration: p.duration || '',
      issuedAt: a.reviewedAt,
    };
  }

  /* ---------------------------- the "API" --------------------------- */
  function handle(path, options = {}) {
    if (!db) db = load();
    if (!db.programs || !Object.keys(db.programs).length) {
      db.programs = seedPrograms();
      save();
    }
    const method = (options.method || 'GET').toUpperCase();
    const body = typeof options.body === 'string' ? JSON.parse(options.body || '{}') : options.body || {};

    /* public */
    if (path === '/programs') return { programs: Object.values(db.programs).map(publicProgram) };

    if (path === '/auth/signup' && method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!body.firstName || !body.surname || !email || !body.phone || !body.password) fail('All fields are required.');
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) fail('Enter a valid email address.');
      if (String(body.password).length < 8) fail('Password must be at least 8 characters.');
      if (db.users.some((u) => u.email === email)) fail('An account with that email already exists. Please sign in.', 409);
      const user = {
        id: uid(),
        firstName: String(body.firstName).trim(),
        surname: String(body.surname).trim(),
        email,
        phone: String(body.phone).trim(),
        role: 'student',
        pass: hash(String(body.password)),
        createdAt: nowISO(),
      };
      db.users.push(user);
      save();
      return { token: makeToken(user), user: publicUser(user) };
    }

    if (path === '/auth/login' && method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const user = db.users.find((u) => u.email === email);
      if (!user || user.pass !== hash(String(body.password || ''))) fail('Invalid email or password.', 401);
      return { token: makeToken(user), user: publicUser(user) };
    }

    if (path === '/auth/me') {
      const user = requireUser(options);
      return { user: publicUser(user) };
    }

    if (path.startsWith('/verify/')) {
      const target = decodeURIComponent(path.replace('/verify/', '')).replace(/-/g, '/').toLowerCase();
      const a = db.applications.find((x) => x.status === 'approved' && x.admissionNumber && x.admissionNumber.toLowerCase() === target);
      if (!a) fail('No admission record matches that number.', 404);
      const p = programOf(a);
      return {
        valid: true,
        admissionNumber: a.admissionNumber,
        student: `${a.applicant.firstName} ${a.applicant.surname}`,
        program: p.name || a.program,
        award: p.award || '',
        issuedAt: a.reviewedAt,
        status: 'Admitted',
      };
    }

    if (path === '/applications/mine') {
      const user = requireUser(options, 'student');
      const mine = db.applications.filter((a) => a.userId === user.id).sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))[0];
      if (!mine) return { application: null };
      const out = { application: sanitize(mine) };
      if (mine.status === 'approved' && mine.admissionNumber) out.admission = admissionPayload(mine);
      return out;
    }

    if (path === '/applications' && method === 'POST') {
      const user = requireUser(options, 'student');
      if (!getProgram(body.program)) fail('Please choose a programme of study.');
      const required = ['firstName', 'surname', 'email', 'phone', 'gender', 'dob', 'address', 'state', 'qualification'];
      const missing = required.filter((k) => !String(body[k] || '').trim());
      if (missing.length) fail('Please complete all required fields.');
      if (!body.photo) fail('A passport photograph is required.');

      const existing = db.applications.find((a) => a.userId === user.id);
      if (existing && existing.status !== 'rejected') fail('You already submitted an application this session.', 409);

      const year = new Date().getFullYear();
      const applicant = {
        firstName: String(body.firstName).trim(),
        middleName: String(body.middleName || '').trim(),
        surname: String(body.surname).trim(),
        email: String(body.email).trim().toLowerCase(),
        phone: String(body.phone).trim(),
        gender: String(body.gender).trim(),
        dob: String(body.dob).trim(),
        address: String(body.address).trim(),
        state: String(body.state).trim(),
        nationality: String(body.nationality || 'Nigerian').trim(),
        qualification: String(body.qualification).trim(),
        guardianName: String(body.guardianName || '').trim(),
        guardianPhone: String(body.guardianPhone || '').trim(),
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

      let app = existing;
      if (app) {
        Object.assign(app, {
          program: body.program,
          applicant,
          checklist,
          programSnapshot: { name: programOf({ program: body.program }).name, school: programOf({ program: body.program }).school, award: programOf({ program: body.program }).award, duration: programOf({ program: body.program }).duration, fee: programOf({ program: body.program }).fee },
          status: 'pending',
          submittedAt: nowISO(),
          reviewedAt: null,
          reviewedBy: null,
          reviewNote: '',
          admissionNumber: null,
        });
      } else {
        db.counters.application += 1;
        app = {
          id: uid(),
          ref: `FA-APP-${year}-${String(db.counters.application).padStart(5, '0')}`,
          userId: user.id,
          program: body.program,
          applicant,
          checklist,
          programSnapshot: { name: programOf({ program: body.program }).name, school: programOf({ program: body.program }).school, award: programOf({ program: body.program }).award, duration: programOf({ program: body.program }).duration, fee: programOf({ program: body.program }).fee },
          intake: `${year}/${year + 1} academic session`,
          status: 'pending',
          submittedAt: nowISO(),
          reviewedAt: null,
          reviewedBy: null,
          reviewNote: '',
          admissionNumber: null,
        };
        db.applications.push(app);
      }
      save();
      return { application: sanitize(app) };
    }

    /* admin */
    if (path === '/admin/stats') {
      requireUser(options, 'admin');
      const apps = db.applications;
      return {
        programmes: Object.keys(db.programs).length,
        students: db.users.filter((u) => u.role === 'student').length,
        total: apps.length,
        pending: apps.filter((a) => a.status === 'pending').length,
        approved: apps.filter((a) => a.status === 'approved').length,
        rejected: apps.filter((a) => a.status === 'rejected').length,
        byProgram: Object.values(db.programs).map((p) => {
          const list = apps.filter((a) => a.program === p.id);
          return {
            id: p.id,
            name: p.name,
            total: list.length,
            pending: list.filter((a) => a.status === 'pending').length,
            approved: list.filter((a) => a.status === 'approved').length,
            rejected: list.filter((a) => a.status === 'rejected').length,
          };
        }),
        recent: apps.slice().sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)).slice(0, 5).map(sanitize),
      };
    }

    if (path === '/admin/applications') {
      requireUser(options, 'admin');
      const list = db.applications.slice().sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)).map(sanitize);
      return { applications: list, total: list.length };
    }

    if (path.startsWith('/admin/applications/') && method !== 'DELETE') {
      const admin = requireUser(options, 'admin');
      const rest = path.replace('/admin/applications/', '').split('/');
      const id = rest[0];
      const action = rest[1];
      const app = db.applications.find((a) => a.id === id || a.ref === id);
      if (!app) fail('Application not found.', 404);

      if (!action) return { application: sanitize(app), documents: { ...app.applicant } };

      if (action === 'approve' && method === 'POST') {
        if (app.status === 'approved') fail('This application has already been approved.', 409);
        app.status = 'approved';
        app.reviewedAt = nowISO();
        app.reviewedBy = `${admin.firstName} ${admin.surname}`;
        app.reviewNote = String(body.note || '').trim();
        if (!app.admissionNumber) {
          db.counters.admission += 1;
          app.admissionNumber = admissionNumber(app.program, db.counters.admission);
        }
        save();
        return { application: sanitize(app) };
      }

      if (action === 'reject' && method === 'POST') {
        const note = String(body.note || '').trim();
        if (!note) fail('Please give a reason for the decision (shown to the applicant).');
        app.status = 'rejected';
        app.reviewedAt = nowISO();
        app.reviewedBy = `${admin.firstName} ${admin.surname}`;
        app.reviewNote = note;
        app.admissionNumber = null;
        save();
        return { application: sanitize(app) };
      }
    }

    if (path === '/admin/students') {
      requireUser(options, 'admin');
      const students = db.users
        .filter((u) => u.role === 'student')
        .map((u) => {
          const app = db.applications.find((a) => a.userId === u.id);
          return {
            id: u.id,
            name: `${u.firstName} ${u.surname}`,
            email: u.email,
            phone: u.phone,
            joined: u.createdAt,
            status: app ? app.status : 'no application',
            admissionNumber: app ? app.admissionNumber : null,
            program: app ? programOf(app).name : '—',
            ref: app ? app.ref : '—',
          };
        })
        .sort((a, b) => new Date(b.joined) - new Date(a.joined));
      return { students };
    }

    /* ---- delete an application (optionally the whole account) ---- */
    if (path.startsWith('/admin/applications/') && method === 'DELETE') {
      requireUser(options, 'admin');
      const id = path.replace('/admin/applications/', '').replace(/\?.*$/, '');
      const index = db.applications.findIndex((a) => a.id === id || a.ref === id);
      if (index < 0) fail('Application not found.', 404);
      const removed = db.applications.splice(index, 1)[0];
      let accountDeleted = false;
      const withAccount = /account=1/.test(path) || body.account === true;
      if (withAccount) {
        const owner = db.users.find((u) => u.id === removed.userId);
        if (owner && owner.role !== 'admin') {
          db.users = db.users.filter((u) => u.id !== owner.id);
          db.applications = db.applications.filter((a) => a.userId !== owner.id);
          accountDeleted = true;
        }
      }
      save();
      return { ok: true, deleted: removed.ref, accountDeleted };
    }

    /* ---- delete a student account ---- */
    if (path.startsWith('/admin/students/') && method === 'DELETE') {
      requireUser(options, 'admin');
      const id = path.replace('/admin/students/', '').replace(/\?.*$/, '');
      const user = db.users.find((u) => u.id === id && u.role === 'student');
      if (!user) fail('Account not found.', 404);
      db.users = db.users.filter((u) => u.id !== user.id);
      db.applications = db.applications.filter((a) => a.userId !== user.id);
      save();
      return { ok: true, deleted: `${user.firstName} ${user.surname}` };
    }

    /* ---- programme & fee management ---- */
    if (path === '/admin/programs' && method === 'POST') {
      requireUser(options, 'admin');
      const value = readProgram(body, null);
      let id = slug(value.name);
      if (db.programs[id]) id = `${id}_${Object.keys(db.programs).length + 1}`;
      db.programs[id] = { id, ...value, createdAt: nowISO(), updatedAt: nowISO() };
      save();
      return { program: publicProgram(db.programs[id]) };
    }

    if (path.startsWith('/admin/programs/')) {
      const admin = requireUser(options, 'admin');
      const id = path.replace('/admin/programs/', '');
      const program = getProgram(id);
      if (!program) fail('Programme not found.', 404);

      if (method === 'PATCH') {
        Object.assign(program, readProgram(body, program), { updatedAt: nowISO() });
        save();
        return { program: publicProgram(program) };
      }

      if (method === 'DELETE') {
        if (Object.keys(db.programs).length <= 1) fail('At least one programme must remain on the catalogue.');
        const linked = db.applications.filter((a) => a.program === id).length;
        const force = /force=1/.test(path) || body.force === true;
        if (linked && !force) {
          fail(`${linked} application${linked === 1 ? '' : 's'} already reference this programme. Remove it anyway? Existing applications keep their details.`, 409);
        }
        delete db.programs[id];
        save();
        return { ok: true, removed: program.name, applicationsKept: linked };
      }
    }

    fail('Not found', 404);
  }

  const ACCENTS = ['cyber', 'ai', 'cop'];

  function readProgram(body, existing) {
    const pick = (key, fallback) => (body[key] !== undefined ? body[key] : existing ? existing[key] : fallback);
    const name = String(pick('name', '') || '').trim();
    if (!name) fail('Programme name is required.');
    const code = String(pick('code', '') || name.slice(0, 3)).trim().toUpperCase();
    if (!/^[A-Z0-9]{2,5}$/.test(code)) fail('Programme code must be 2–5 letters or digits (it appears in admission numbers).');
    const feeAmount = Number(String(pick('feeAmount', 0)).replace(/[^0-9.]/g, ''));
    if (!isFinite(feeAmount) || feeAmount < 0) fail('Enter a valid tuition amount (numbers only).');
    const duration = String(pick('duration', '') || '').trim();
    if (!duration) fail('Programme duration is required (e.g. 24 months).');
    let modules = pick('modules', []);
    if (typeof modules === 'string') modules = modules.split(',').map((m) => m.trim()).filter(Boolean);
    if (!Array.isArray(modules)) modules = [];
    return {
      name,
      code,
      school: String(pick('school', '') || '').trim() || 'School of Computing & Cyber Sciences',
      award: String(pick('award', '') || '').trim() || `Diploma in ${name}`,
      duration,
      summary: String(pick('summary', '') || '').trim(),
      entry: String(pick('entry', '') || '').trim(),
      feeAmount,
      feePeriod: String(pick('feePeriod', 'per session') || 'per session'),
      accent: ACCENTS.includes(pick('accent', '')) ? pick('accent', '') : 'cyber',
      modules: modules.slice(0, 12),
    };
  }

  window.FA_DEMO = {
    handle,
    get active() {
      try {
        return !!localStorage.getItem(KEY);
      } catch {
        return !!memoryCopy;
      }
    },
    reset() {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
      memoryCopy = null;
      db = null;
    },
  };
})();
