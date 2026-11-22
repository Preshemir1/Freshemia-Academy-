/* Freshemia Academy — single-page application
   One website, one router: academy pages, applicant portal and administrator console. */
(function () {
  'use strict';
  const { Auth, api, toast, esc, fmtDate, readImage } = window.FA;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    student: null, // signed-in applicant {token,user}
    admin: null, // signed-in administrator
    programs: [],
    selectedProgram: null,
    uploads: { photo: null, result: null, id: null },
    application: null,
    admission: null,
    // admin console
    adminView: 'overview',
    applications: [],
    students: [],
    stats: null,
    filters: { q: '', program: 'all', status: 'all' },
    adminLoaded: false,
  };

  const VIEWS = ['home', 'auth', 'staff', 'apply', 'dashboard', 'letter', 'id', 'verify', 'admin'];

  /* ================================================================== */
  /* Router                                                             */
  /* ================================================================== */
  function showView(name) {
    VIEWS.forEach((v) => {
      const el = document.getElementById('view-' + v);
      if (el) el.classList.toggle('hidden', v !== name);
    });
    document.body.classList.toggle('admin-mode', name === 'admin');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  async function router() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [pathPart, anchor] = raw.split('#');
    const path = pathPart || '/';
    closeNav();

    if (path === '/') {
      showView('home');
      renderProgramCards();
      if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' }), 60);
      return;
    }

    if (path === '/signup' || path === '/signin') {
      if (state.student) return (location.hash = '#/dashboard');
      if (path === '/signin' && state.admin) {
        toast('You are signed in as an administrator. Opening the console…', 'ok');
        return (location.hash = '#/admin');
      }
      showView('auth');
      setAuthPane(path === '/signup' ? 'signup' : 'signin');
      return;
    }

    if (path === '/staff' || path === '/admin') {
      if (state.admin) {
        if (path === '/staff') return (location.hash = '#/admin');
        showView('admin');
        enterConsole();
        return;
      }
      if (path === '/admin') {
        toast('Please sign in with your staff credentials.', 'err');
        return (location.hash = '#/staff');
      }
      showView('staff');
      return;
    }

    if (path === '/apply') {
      if (!state.student) {
        toast('Please sign in to continue your application.', 'err');
        return (location.hash = '#/signin');
      }
      showView('apply');
      if (!state.selectedProgram) gotoStep(1);
      return;
    }

    if (path === '/dashboard') {
      if (!state.student) {
        toast('Please sign in to open your portal.', 'err');
        return (location.hash = '#/signin');
      }
      showView('dashboard');
      loadDashboard();
      return;
    }

    if (path === '/letter' || path === '/id') {
      if (!state.student) return (location.hash = '#/signin');
      await ensureApplication();
      if (!state.application || state.application.status !== 'approved') {
        toast('Your admission letter becomes available once you are admitted.', 'err');
        return (location.hash = '#/dashboard');
      }
      showView(path.slice(1));
      if (path === '/letter') renderLetter();
      else renderIdCard();
      return;
    }

    if (path.startsWith('/verify')) {
      showView('verify');
      const adm = path.split('/')[2];
      if (adm) {
        $('#verifyInput').value = decodeURIComponent(adm).replace(/-/g, '/');
        runVerify(decodeURIComponent(adm));
      }
      return;
    }

    location.hash = '#/';
  }

  /**
   * Buttons inside the panels delegate to the same handlers as before, but via a
   * synthetic event — sandboxed frames (no allow-forms) block native submission.
   */
  function wireSubmit(formId, buttonId) {
    const form = document.getElementById(formId);
    const btn = document.getElementById(buttonId);
    if (!form) return;
    const fire = () => form.dispatchEvent(new Event('submit'));
    btn?.addEventListener('click', (e) => {
      e.preventDefault();
      fire();
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        fire();
      }
    });
  }

  function closeNav() {
    $('#mainNav')?.classList.remove('open');
  }

  /* ================================================================== */
  /* Shared header / navigation                                         */
  /* ================================================================== */
  function syncChrome() {
    const studentUser = state.student && state.student.user;
    const adminUser = state.admin && state.admin.user;

    const portal = $('#navPortal');
    const signin = $('#navSignin');
    const apply = $('#navApply');
    const adminBtn = $('#navAdmin');

    portal?.classList.toggle('hidden', !studentUser);
    if (portal && studentUser) portal.textContent = `${studentUser.firstName}'s portal`;
    signin?.classList.toggle('hidden', !!studentUser);
    apply?.classList.toggle('hidden', !!studentUser);
    adminBtn?.classList.toggle('hidden', !adminUser);

    const who = $('#portalWho');
    if (who && studentUser) who.innerHTML = `Signed in as <b>${esc(studentUser.email)}</b>`;
    const year = $('#year');
    if (year) year.textContent = new Date().getFullYear();
  }

  /* ================================================================== */
  /* Programme catalogue                                                */
  /* ================================================================== */
  const PROGRAM_ICONS = {
    cybersecurity:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9.5 12l1.8 1.8L15 10"/></svg>',
    artificial_intelligence:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M19 5l-2 2M5 19l2-2M19 19l-2-2"/></svg>',
    computer_operator:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  };

  /** Accent helper so courses added later still get their own colour. */
  function accentOf(id) {
    const program = state.programs.find((p) => p.id === id);
    return `acc-${(program && program.accent) || 'cyber'}`;
  }

  const FALLBACK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z"/><path d="M6 9.8V15c0 1.7 2.7 3 6 3s6-1.3 6-3V9.8"/><path d="M21 7.5v6"/></svg>';

  async function loadPrograms() {
    if (state.programs.length) return state.programs;
    try {
      const { programs } = await api('/programs', { as: 'student' });
      state.programs = programs;
    } catch (e) {
      console.error(e);
    }
    return state.programs;
  }

  async function renderProgramCards() {
    const grid = $('#programGrid');
    if (!grid || grid.dataset.done) return;
    const programs = await loadPrograms();
    grid.innerHTML = programs
      .map(
        (p) => `
      <article class="program-card p-${p.id} ${accentOf(p.id)}">
        <div class="mark">${PROGRAM_ICONS[p.id] || FALLBACK_ICON}</div>
        <div class="school">${esc(p.school)}</div>
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.summary)}</p>
        <div class="tags">${p.modules.slice(0, 3).map((m) => `<span class="tag">${esc(m)}</span>`).join('')}</div>
        <ul class="program-meta">
          <li><span>Award</span><span>${esc(p.award.replace('Advanced Diploma in ', 'Adv. Diploma ').replace('Professional Certificate in ', 'Prof. Cert. '))}</span></li>
          <li><span>Duration</span><span>${esc(p.duration)}</span></li>
          <li><span>Tuition</span><span>${esc(p.fee)}</span></li>
        </ul>
        <button class="btn btn-outline" data-apply="${p.id}">Apply for ${esc(p.name)}</button>
      </article>`
      )
      .join('');
    grid.dataset.done = '1';
    $$('[data-apply]', grid).forEach((btn) =>
      btn.addEventListener('click', () => {
        state.selectedProgram = btn.dataset.apply;
        if (state.student) {
          location.hash = '#/apply';
          resetWizard();
        } else {
          location.hash = '#/signup';
        }
      })
    );
  }

  /* ================================================================== */
  /* Applicant authentication                                           */
  /* ================================================================== */
  function setAuthPane(which) {
    const signup = which === 'signup';
    $('#signupPane').classList.toggle('hidden', !signup);
    $('#loginPane').classList.toggle('hidden', signup);
    $('#authAsideTitle').textContent = signup ? 'Create your applicant account.' : 'Welcome back to your portal.';
    $('#authAsideText').textContent = signup
      ? 'One account gives you the application form, your decision status, admission letter and student ID card.'
      : 'Sign in to check your application status, read the Board’s decision and download your admission documents.';
    $('#signupError').classList.add('hidden');
    $('#loginError').classList.add('hidden');
  }

  $('#toSignup')?.addEventListener('click', () => setAuthPane('signup'));
  $('#toSignin')?.addEventListener('click', () => setAuthPane('signin'));

  function showError(el, message) {
    el.textContent = message;
    el.classList.remove('hidden');
  }

  $('#signupForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#signupBtn');
    const err = $('#signupError');
    err.classList.add('hidden');
    const payload = {
      firstName: $('#suFirst').value.trim(),
      surname: $('#suLast').value.trim(),
      email: $('#suEmail').value.trim(),
      phone: $('#suPhone').value.trim(),
      password: $('#suPassword').value,
    };
    if (!payload.firstName || !payload.surname || !payload.email || !payload.phone || !payload.password) {
      return showError(err, 'Please complete every field to create your account.');
    }
    if (payload.password.length < 8) return showError(err, 'Password must be at least 8 characters.');
    btn.disabled = true;
    btn.textContent = 'Creating account…';
    try {
      const { token, user } = await api('/auth/signup', { method: 'POST', body: payload });
      Auth.set('student', token, user);
      state.student = { token, user };
      syncChrome();
      toast('Account created. Let’s start your application.', 'ok');
      resetWizard();
      location.hash = '#/apply';
    } catch (error) {
      showError(err, error.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create account & continue';
    }
  });

  $('#loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn');
    const err = $('#loginError');
    err.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const { token, user } = await api('/auth/login', {
        method: 'POST',
        body: { email: $('#loginEmail').value.trim(), password: $('#loginPassword').value },
        as: 'none',
      });
      if (user.role === 'admin') {
        Auth.set('admin', token, user);
        state.admin = { token, user };
        syncChrome();
        toast('Staff account recognised — opening the administrator console.', 'ok');
        return (location.hash = '#/admin');
      }
      Auth.set('student', token, user);
      state.student = { token, user };
      syncChrome();
      toast(`Welcome back, ${user.firstName}.`, 'ok');
      location.hash = '#/dashboard';
    } catch (error) {
      showError(err, error.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });

  $('#studentSignout')?.addEventListener('click', () => {
    Auth.clear('student');
    state.student = null;
    state.application = null;
    state.admission = null;
    syncChrome();
    toast('You have signed out.', 'ok');
    location.hash = '#/';
  });

  /* ================================================================== */
  /* Staff authentication                                               */
  /* ================================================================== */
  $('#adminLoginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#admLoginBtn');
    const err = $('#adminLoginError');
    err.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const { token, user } = await api('/auth/login', {
        method: 'POST',
        body: { email: $('#admEmail').value.trim(), password: $('#admPassword').value },
        as: 'none',
      });
      if (user.role !== 'admin') {
        showError(err, 'This is an applicant account. Please use the student portal to sign in.');
        return;
      }
      Auth.set('admin', token, user);
      state.admin = { token, user };
      syncChrome();
      toast(`Signed in as ${user.firstName} ${user.surname}.`, 'ok');
      location.hash = '#/admin';
    } catch (error) {
      showError(err, error.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in to console';
    }
  });

  $('#adminLogout')?.addEventListener('click', () => {
    Auth.clear('admin');
    state.admin = null;
    state.adminLoaded = false;
    syncChrome();
    toast('Signed out of the console.', 'ok');
    location.hash = '#/';
  });

  /* ================================================================== */
  /* Application wizard                                                 */
  /* ================================================================== */
  const NIGERIAN_STATES = ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT Abuja','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara','Outside Nigeria'];
  const stateSelect = $('#fState');
  if (stateSelect) {
    stateSelect.innerHTML = '<option value="">Select…</option>' + NIGERIAN_STATES.map((s) => `<option>${s}</option>`).join('');
  }

  function gotoStep(n) {
    [1, 2, 3, 4].forEach((i) => $('#step' + i)?.classList.toggle('hidden', i !== n));
    $$('#stepper .s').forEach((s) => {
      const i = Number(s.dataset.step);
      s.classList.toggle('active', i === n);
      s.classList.toggle('done', i < n);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (n === 1) renderChooser();
  }

  async function renderChooser() {
    const grid = $('#chooseGrid');
    if (!grid) return;
    const programs = await loadPrograms();
    grid.innerHTML = programs
      .map(
        (p) => `
      <button type="button" class="choose p-${p.id} ${state.selectedProgram === p.id ? 'selected' : ''}" data-prog="${p.id}">
        <span class="tick">✓</span>
        <div class="mark">${PROGRAM_ICONS[p.id] || ''}</div>
        <h4>${esc(p.name)}</h4>
        <div class="school">${esc(p.school)}</div>
        <ul>
          <li><span>Duration</span><b>${esc(p.duration)}</b></li>
          <li><span>Tuition</span><b>${esc(p.fee)}</b></li>
        </ul>
      </button>`
      )
      .join('');
    $$('[data-prog]', grid).forEach((btn) =>
      btn.addEventListener('click', () => {
        state.selectedProgram = btn.dataset.prog;
        $$('[data-prog]', grid).forEach((b) => b.classList.toggle('selected', b === btn));
        $('#toStep2').disabled = false;
      })
    );
    $('#toStep2').disabled = !state.selectedProgram;
  }

  function prefillDetails() {
    const u = (state.student && state.student.user) || {};
    if (!$('#fFirst').value) $('#fFirst').value = u.firstName || '';
    if (!$('#fSurname').value) $('#fSurname').value = u.surname || '';
    if (!$('#fEmail').value) $('#fEmail').value = u.email || '';
    if (!$('#fPhone').value) $('#fPhone').value = u.phone || '';
  }

  function collectDetails() {
    return {
      surname: $('#fSurname').value.trim(),
      firstName: $('#fFirst').value.trim(),
      middleName: $('#fMiddle').value.trim(),
      gender: $('#fGender').value,
      dob: $('#fDob').value,
      email: $('#fEmail').value.trim(),
      phone: $('#fPhone').value.trim(),
      state: $('#fState').value,
      nationality: $('#fNationality').value.trim() || 'Nigerian',
      address: $('#fAddress').value.trim(),
      qualification: $('#fQualification').value,
      guardianName: $('#fGuardian').value.trim(),
      guardianPhone: $('#fGuardianPhone').value.trim(),
    };
  }

  $('#toStep2')?.addEventListener('click', () => {
    prefillDetails();
    gotoStep(2);
  });

  $$('[data-back]').forEach((btn) => btn.addEventListener('click', () => gotoStep(Number(btn.dataset.back))));

  $('#toStep3')?.addEventListener('click', () => {
    const d = collectDetails();
    const missing = [];
    if (!d.surname) missing.push('surname');
    if (!d.firstName) missing.push('first name');
    if (!d.gender) missing.push('gender');
    if (!d.dob) missing.push('date of birth');
    if (!d.email) missing.push('email');
    if (!d.phone) missing.push('phone');
    if (!d.state) missing.push('state');
    if (!d.address) missing.push('address');
    if (!d.qualification) missing.push('qualification');
    const errEl = $('#step2Error');
    if (missing.length) return showError(errEl, 'Please provide: ' + missing.join(', ') + '.');
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(d.email)) return showError(errEl, 'Enter a valid email address.');
    if (!/^[0-9+()\-\s]{7,20}$/.test(d.phone)) return showError(errEl, 'Enter a valid phone number.');
    errEl.classList.add('hidden');
    gotoStep(3);
  });

  function wireUploader(inputId, key, thumbId, statusId) {
    const input = $(inputId);
    if (!input) return;
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const dataUrl = await readImage(file, key === 'photo' ? 800 : 1200, 0.82);
        state.uploads[key] = dataUrl;
        $(thumbId).innerHTML = `<img src="${dataUrl}" alt="">`;
        $(thumbId).closest('.uploader').classList.add('has-file');
        $(statusId).textContent = '✓ Uploaded — ' + file.name.slice(0, 40);
      } catch (err) {
        toast(err.message, 'err');
        input.value = '';
      }
    });
  }
  wireUploader('#photoInput', 'photo', '#photoThumb', '#photoStatus');
  wireUploader('#resultInput', 'result', '#resultThumb', '#resultStatus');
  wireUploader('#idInput', 'id', '#idThumb', '#idStatus');

  $('#submitApplication')?.addEventListener('click', async () => {
    const errEl = $('#step3Error');
    errEl.classList.add('hidden');
    if (!state.uploads.photo) return showError(errEl, 'A passport photograph is required before you can submit.');
    if (!$('#declaration').checked) return showError(errEl, 'Please accept the declaration to submit your application.');
    if (!state.selectedProgram) return showError(errEl, 'Please choose a programme first.');

    const btn = $('#submitApplication');
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    try {
      const payload = {
        program: state.selectedProgram,
        ...collectDetails(),
        photo: state.uploads.photo,
        resultDoc: state.uploads.result,
        idDoc: state.uploads.id,
      };
      const { application } = await api('/applications', { method: 'POST', body: payload });
      state.application = application;
      $('#doneRef').textContent = application.ref;
      gotoStep(4);
      toast('Application submitted successfully.', 'ok');
    } catch (err) {
      showError(errEl, err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit application';
    }
  });

  function resetWizard() {
    [1, 2, 3, 4].forEach((i) => $('#step' + i)?.classList.add('hidden'));
    state.uploads = { photo: null, result: null, id: null };
    $('#photoThumb').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M5.5 19c1.2-2.6 3.6-4 6.5-4s5.3 1.4 6.5 4"/></svg>';
    $('#resultThumb').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>';
    $('#idThumb').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M13 10h6M13 14h5"/></svg>';
    $$('.uploader').forEach((u) => u.classList.remove('has-file'));
    ['#photoStatus', '#resultStatus', '#idStatus'].forEach((s) => ($(s).textContent = ''));
    $('#declaration').checked = false;
    $$('input[type=file]').forEach((f) => (f.value = ''));
    gotoStep(1);
  }

  /* ================================================================== */
  /* Applicant dashboard                                                */
  /* ================================================================== */
  async function ensureApplication() {
    if (!state.student) return null;
    if (state.application) return state.application;
    try {
      const data = await api('/applications/mine');
      state.application = data.application;
      state.admission = data.admission || null;
    } catch (e) {
      console.error(e);
    }
    return state.application;
  }

  async function loadDashboard() {
    const body = $('#dashboardBody');
    body.innerHTML = '<p style="color:var(--muted);padding:30px 0">Loading your portal…</p>';
    state.application = null;
    state.admission = null;
    await ensureApplication();
    const app = state.application;
    const user = state.student.user;

    if (!app) {
      body.innerHTML = `
        <div class="status-hero">
          <span class="badge badge-neutral"><span class="b-dot"></span> No application yet</span>
          <h2 style="margin-top:16px">Welcome, ${esc(user.firstName)}.</h2>
          <p class="lede">You have an account but no submitted application. Choose a programme, complete your details and upload your passport photograph to apply.</p>
          <a href="#/apply" class="btn btn-gold" style="margin-top:10px">Start my application</a>
        </div>`;
      return;
    }

    const progs = state.programs.length ? state.programs : await loadPrograms();
    const prog = progs.find((p) => p.id === app.program) || {};
    const badge =
      app.status === 'approved'
        ? '<span class="badge badge-approved"><span class="b-dot"></span> Admitted</span>'
        : app.status === 'rejected'
        ? '<span class="badge badge-rejected"><span class="b-dot"></span> Not successful</span>'
        : '<span class="badge badge-pending"><span class="b-dot"></span> Under review</span>';

    const detailsCard = `
      <div class="card" style="margin-top:20px">
        <div class="card-head"><h3>Application details</h3><p>Reference ${esc(app.ref)} · submitted ${esc(fmtDate(app.submittedAt, true))}</p></div>
        <div class="card-pad">
          <dl class="dl">
            <dt>Applicant</dt><dd>${esc(app.applicant.firstName)} ${esc(app.applicant.middleName)} ${esc(app.applicant.surname)}</dd>
            <dt>Programme</dt><dd>${esc(prog.name || app.programName)}</dd>
            <dt>Award</dt><dd>${esc(prog.award || app.award)}</dd>
            <dt>School</dt><dd>${esc(prog.school || app.programSchool)}</dd>
            <dt>Session</dt><dd>${esc(app.intake)}</dd>
            <dt>Email</dt><dd>${esc(app.applicant.email)}</dd>
            <dt>Phone</dt><dd>${esc(app.applicant.phone)}</dd>
            <dt>Gender / DOB</dt><dd>${esc(app.applicant.gender)} · ${esc(fmtDate(app.applicant.dob))}</dd>
            <dt>Qualification</dt><dd>${esc(app.applicant.qualification)}</dd>
            <dt>Address</dt><dd>${esc(app.applicant.address)}, ${esc(app.applicant.state)}</dd>
            <dt>Status</dt><dd>${badge}</dd>
            ${app.reviewNote ? `<dt>Board note</dt><dd style="font-weight:500">${esc(app.reviewNote)}</dd>` : ''}
          </dl>
        </div>
      </div>`;

    if (app.status === 'pending') {
      body.innerHTML = `
        <div class="status-hero pending">
          ${badge}
          <h2 style="margin-top:16px">Your application ${esc(app.ref)} is under review.</h2>
          <p class="lede">The Admissions Board is verifying the documents you submitted. You will see the decision here as soon as it is made — most applications are reviewed within 48 working hours.</p>
          <div class="kv">
            <div><span>Reference</span><b class="mono">${esc(app.ref)}</b></div>
            <div><span>Programme</span><b>${esc(prog.name || app.programName)}</b></div>
            <div><span>Submitted</span><b>${esc(fmtDate(app.submittedAt))}</b></div>
            <div><span>Decision</span><b>Pending</b></div>
          </div>
        </div>
        ${detailsCard}
        <div class="alert alert-info" style="margin-top:20px">Keep this reference number safe: <b class="mono">${esc(app.ref)}</b>. You can sign in at any time to check your status.</div>
        <a href="#/" class="btn btn-ghost btn-sm">← Back to academy website</a>`;
      return;
    }

    if (app.status === 'rejected') {
      body.innerHTML = `
        <div class="status-hero rejected">
          ${badge}
          <h2 style="margin-top:16px">Application ${esc(app.ref)} was not successful.</h2>
          <p class="lede">The Admissions Board reviewed your application and was unable to offer you a place on this occasion.</p>
          ${app.reviewNote ? `<div class="alert alert-warn" style="margin-top:6px"><div><b>Reason given:</b> ${esc(app.reviewNote)}</div></div>` : ''}
          <p class="lede" style="font-size:.94rem">You may correct the issue and submit a fresh application for the same or another programme.</p>
          <a href="#/apply" class="btn" style="margin-top:8px">Submit a new application</a>
        </div>
        ${detailsCard}`;
      return;
    }

    body.innerHTML = `
      <div class="admit-banner">
        <p class="eyebrow" style="color:#e6cf90">Offer of admission</p>
        <h2>Congratulations, ${esc(app.applicant.firstName)} — you have been offered admission.</h2>
        <p>You have been admitted to study <b>${esc(prog.name || app.programName)}</b> (${esc(prog.award || app.award)}) for the ${esc(app.intake)}.</p>
        <span class="adm">Admission No. ${esc(app.admissionNumber)}</span>
      </div>
      <div class="action-grid">
        <div class="action-card">
          <strong>Admission letter</strong>
          <p>Official offer letter with your admission number and a QR code for verification.</p>
          <a href="#/letter" class="btn btn-sm">View &amp; print letter</a>
        </div>
        <div class="action-card">
          <strong>Student ID card</strong>
          <p>Build your Freshemia student identity card, ready to print and laminate.</p>
          <a href="#/id" class="btn btn-sm">Build ID card</a>
        </div>
        <div class="action-card">
          <strong>Verification</strong>
          <p>Share your admission number so employers or sponsors can confirm it.</p>
          <a href="#/verify" class="btn btn-sm btn-outline">Verify a letter</a>
        </div>
      </div>
      <div class="kv card" style="padding:22px 26px;margin-top:20px">
        <div><span>Admission number</span><b class="mono">${esc(app.admissionNumber)}</b></div>
        <div><span>Programme</span><b>${esc(prog.name || app.programName)}</b></div>
        <div><span>Date admitted</span><b>${esc(fmtDate(app.reviewedAt))}</b></div>
        <div><span>Approved by</span><b>${esc(app.reviewedBy || 'Admissions Board')}</b></div>
      </div>
      ${app.reviewNote ? `<div class="alert alert-success" style="margin-top:18px"><div>${esc(app.reviewNote)}</div></div>` : ''}
      ${detailsCard}`;
  }

  /* ================================================================== */
  /* Admission letter & ID card                                         */
  /* ================================================================== */
  const CREST = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 3 58 11v20c0 15-11 26-26 30C17 57 6 46 6 31V11z" fill="#0b2545"/><path d="M32 7.5 53.5 14v17c0 12.6-9.2 22.3-21.5 25.9C19.7 53.3 10.5 43.6 10.5 31V14z" fill="none" stroke="#b8912f" stroke-width="1.6"/><path d="M21 25.5h22M21 30.5h22M21 35.5h14" stroke="#e0cd92" stroke-width="2.4" stroke-linecap="round"/><path d="M32 17l2.4 3.4h-4.8z" fill="#b8912f"/></svg>`;

  function commencementDate() {
    const now = new Date();
    const year = now.getMonth() > 0 ? now.getFullYear() + 1 : now.getFullYear();
    return new Date(year, 0, 11).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  }
  function acceptanceDeadline(iso) {
    const d = iso ? new Date(iso) : new Date();
    d.setDate(d.getDate() + 14);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function renderLetter() {
    const app = state.application;
    const adm = state.admission;
    if (!app || !adm) return;
    const a = app.applicant;
    const fullName = [a.firstName, a.middleName, a.surname].filter(Boolean).join(' ');
    $('#letterStage').innerHTML = `
      <div class="letter">
        <div class="letter-watermark">FRESHEMIA</div>
        <div class="letter-head">
          ${CREST}
          <div>
            <div class="lname">FRESHEMIA ACADEMY</div>
            <div class="lsub">Cybersecurity · Artificial Intelligence · Digital Operations</div>
            <div class="laddr">Admissions Office, Jos, Plateau State, Nigeria · admissions@freshemiaacademy.edu.ng · +234 803 000 1122</div>
          </div>
        </div>
        <div class="letter-meta">
          <span>Our ref: <span class="letter-ref">${esc(app.ref)}</span></span>
          <span>Admission no: <span class="letter-ref">${esc(app.admissionNumber)}</span></span>
          <span>Date: ${esc(fmtDate(adm.issuedAt || app.reviewedAt))}</span>
        </div>

        <h3 class="ltitle">Offer of Provisional Admission</h3>

        <div class="letter-grid">
          <div>
            <div class="body">
              <p><b>${esc(fullName)}</b><br>${esc(a.address)}<br>${esc(a.state)}, ${esc(a.nationality)}</p>
              <p>Dear ${esc(a.firstName)},</p>
              <p>Following a careful review of your application and the documents you submitted, the Admissions Board of Freshemia Academy is pleased to offer you <b>provisional admission</b> to study <b>${esc(adm.program)}</b>, leading to the award of <b>${esc(adm.award)}</b>, in the ${esc(adm.school)}, for the ${esc(app.intake)}.</p>
            </div>
            <div style="margin-top:12px">
              <div class="fieldline"><b>Admission number</b><span>${esc(app.admissionNumber)}</span></div>
              <div class="fieldline"><b>Programme</b><span>${esc(adm.program)}</span></div>
              <div class="fieldline"><b>Award</b><span>${esc(adm.award)}</span></div>
              <div class="fieldline"><b>Duration</b><span>${esc(adm.duration)}</span></div>
              <div class="fieldline"><b>Mode of study</b><span>Full-time, on-campus (hybrid option available)</span></div>
              <div class="fieldline"><b>Commencement</b><span>${esc(commencementDate())}</span></div>
              <div class="fieldline"><b>Acceptance deadline</b><span>${esc(acceptanceDeadline(adm.issuedAt))}</span></div>
            </div>
            <div class="body" style="margin-top:14px">
              <p>This offer is subject to satisfactory verification of your original credentials at registration. To accept, sign in to the applicant portal, print the admission letter and student identity card, and report to the Registry with your original documents on or before the acceptance deadline.</p>
              <p>We look forward to welcoming you to the Academy.</p>
            </div>
          </div>
          <div class="letter-qr">
            <img src="${adm.qrDataUrl}" alt="Admission verification QR code">
            <small>SCAN TO VERIFY<br>${esc(app.admissionNumber)}</small>
          </div>
        </div>

        <div class="letter-sign">
          <div>
            <div class="sig-script">Grace Ademola</div>
            <div class="sig-line">Grace Ademola<br>Registrar, Freshemia Academy</div>
          </div>
          <div style="text-align:right">
            <div class="sig-script">Office of Admissions</div>
            <div class="sig-line">Admissions Board<br>${esc(fmtDate(adm.issuedAt || app.reviewedAt))}</div>
          </div>
        </div>

        <div class="letter-foot">
          <span>This letter is computer-generated and valid without a handwritten signature. Verify authenticity at ${esc(adm.verifyUrl)}</span>
          <span>${esc(app.ref)}</span>
        </div>
      </div>`;
  }

  function renderIdCard() {
    const app = state.application;
    const adm = state.admission;
    if (!app || !adm) return;
    const a = app.applicant;
    const fullName = [a.firstName, a.surname].filter(Boolean).join(' ');
    const prog = state.programs.find((p) => p.id === app.program) || {};
    const valid = (() => {
      const d = new Date(adm.issuedAt || Date.now());
      d.setFullYear(d.getFullYear() + 2);
      return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    })();
    $('#idStage').innerHTML = `
      <div>
        <div class="id-card print-page-break">
          <div class="id-top">
            ${CREST}
            <div>
              <div class="n">FRESHEMIA ACADEMY</div>
              <div class="s">Student Identification Card</div>
            </div>
            <span class="chip">${esc(app.intake.split(' ')[0])} Session</span>
          </div>
          <div class="id-body">
            <div class="id-photo"><img src="${a.photo}" alt="Student passport photograph"></div>
            <div>
              <div class="id-name">${esc(fullName)}</div>
              <div class="id-prog">${esc(prog.name || app.programName)}</div>
              <div class="id-rows">
                <div><span>Adm. No.</span><span>${esc(app.admissionNumber)}</span></div>
                <div><span>School</span><span>${esc((prog.school || '').replace('School of ', ''))}</span></div>
                <div><span>Level</span><span>${esc((prog.award || '').includes('Certificate') ? 'Certificate' : 'Diploma')}</span></div>
                <div><span>Valid thru</span><span>${esc(valid)}</span></div>
              </div>
            </div>
          </div>
          <div class="id-bottom">
            <div class="id-sign">Registrar<small>Authorised signature</small></div>
            <img class="id-qr" src="${adm.qrDataUrl}" alt="Verification QR code">
          </div>
          <div class="id-strip"></div>
        </div>
        <div class="id-card" style="margin-top:18px">
          <div class="id-top" style="padding:11px 18px">
            <div>
              <div class="n" style="font-size:12px">TERMS OF USE</div>
              <div class="s">Reverse of card</div>
            </div>
          </div>
          <div class="id-back" style="font-size:9.4px;line-height:1.6">
            <p style="margin:0 0 6px">This card remains the property of Freshemia Academy and must be presented on request by any authorised officer of the Academy. It is not transferable.</p>
            <p style="margin:0 0 6px">If found, please return to the Registry, Freshemia Academy, Jos, Plateau State, Nigeria, or call +234 803 000 1122.</p>
            <p style="margin:0">Authenticity can be confirmed at the Academy verification desk using the QR code on the front of this card.</p>
          </div>
        </div>
      </div>`;
  }

  /* ================================================================== */
  /* Public verification                                                */
  /* ================================================================== */
  async function runVerify(value) {
    const out = $('#verifyResult');
    const clean = String(value || '').trim().replace(/\//g, '-');
    if (!clean) return;
    out.innerHTML = '<p style="color:var(--muted);font-size:.88rem">Checking the register…</p>';
    try {
      const data = await api('/verify/' + encodeURIComponent(clean), { as: 'none' });
      out.innerHTML = `
        <div class="verify-card" style="box-shadow:none;border:none;margin:0;padding:0">
          <div class="verify-seal">✓</div>
          <h3 style="margin-bottom:4px">Valid admission record</h3>
          <p style="color:var(--muted);font-size:.86rem;margin-bottom:18px">This admission number appears on the Academy register.</p>
          <dl class="dl" style="text-align:left">
            <dt>Admission no</dt><dd class="mono">${esc(data.admissionNumber)}</dd>
            <dt>Student</dt><dd>${esc(data.student)}</dd>
            <dt>Programme</dt><dd>${esc(data.program)}</dd>
            <dt>Award</dt><dd>${esc(data.award)}</dd>
            <dt>Date issued</dt><dd>${esc(fmtDate(data.issuedAt))}</dd>
            <dt>Status</dt><dd>${esc(data.status)}</dd>
          </dl>
        </div>`;
    } catch (err) {
      out.innerHTML = `
        <div class="verify-card" style="box-shadow:none;border:none;margin:0;padding:0">
          <div class="verify-seal bad">✕</div>
          <h3 style="margin-bottom:4px">No matching record</h3>
          <p style="color:var(--muted);font-size:.88rem;margin:0">${esc(err.message)} Check the number and try again, or contact the Registry.</p>
        </div>`;
    }
  }

  $('#verifyForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    runVerify($('#verifyInput').value);
  });

  /* ================================================================== */
  /* Administrator console                                              */
  /* ================================================================== */
  const STATUS_BADGE = {
    pending: '<span class="badge badge-pending"><span class="b-dot"></span>Under review</span>',
    approved: '<span class="badge badge-approved"><span class="b-dot"></span>Admitted</span>',
    rejected: '<span class="badge badge-rejected"><span class="b-dot"></span>Declined</span>',
    'no application': '<span class="badge badge-neutral"><span class="b-dot"></span>No application</span>',
  };

  const VIEW_META = {
    overview: ['Admissions overview', 'Live summary of the 2026 / 2027 application cycle.'],
    applications: ['All applications', 'Every application submitted through the applicant portal.'],
    pending: ['Pending review', 'Applications awaiting a decision from the Admissions Board.'],
    admitted: ['Admitted students', 'Applications approved and admission numbers issued.'],
    declined: ['Declined applications', 'Applications that did not meet the entry requirements.'],
    students: ['Registered accounts', 'Every account created on the applicant portal.'],
    programmes: ['Programmes & fees', 'Tuition, course codes and the catalogue published on the website.'],
  };

  async function enterConsole() {
    const user = state.admin.user;
    $('#whoName').textContent = `${user.firstName} ${user.surname} · Administrator`;
    await refreshConsole();
    setConsoleView('overview');
    state.adminLoaded = true;
    // keep the dashboard live while the console is open
    clearInterval(state.poller);
    state.poller = setInterval(() => {
      if (location.hash.startsWith('#/admin') && !document.querySelector('.overlay')) refreshConsole(true);
    }, 15000);
  }

  async function refreshConsole(silent) {
    try {
      const [stats, apps, students, catalogue] = await Promise.all([
        api('/admin/stats'),
        api('/admin/applications'),
        api('/admin/students'),
        api('/programs'),
      ]);
      state.stats = stats;
      state.applications = apps.applications;
      state.students = students.students;
      state.programs = catalogue.programs;
      renderCounts();
      syncProgramFilter();
      renderOverview();
      renderApplications();
      renderStudents();
      if (state.adminView === 'programmes') renderProgrammes();
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        Auth.clear('admin');
        state.admin = null;
        syncChrome();
        toast('Your console session has ended. Please sign in again.', 'err');
        location.hash = '#/staff';
        return;
      }
      if (!silent) toast(e.message, 'err');
    }
  }

  $('#refreshBtn')?.addEventListener('click', async () => {
    await refreshConsole();
    toast('Register refreshed.', 'ok');
  });

  $$('.side-link').forEach((btn) =>
    btn.addEventListener('click', () => setConsoleView(btn.dataset.view))
  );

  function setConsoleView(view) {
    state.adminView = view;
    $$('.side-link').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    const isList = ['applications', 'pending', 'admitted', 'declined'].includes(view);
    $('#paneOverview').classList.toggle('hidden', view !== 'overview');
    $('#paneApplications').classList.toggle('hidden', !isList);
    $('#paneStudents').classList.toggle('hidden', view !== 'students');
    $('#paneProgrammes').classList.toggle('hidden', view !== 'programmes');
    if (view === 'programmes') renderProgrammes();

    const [title, sub] = VIEW_META[view] || VIEW_META.overview;
    $('#pageTitle').textContent = title;
    $('#pageSub').textContent = sub;

    if (isList) {
      const status = view === 'applications' ? 'all' : view === 'admitted' ? 'approved' : view === 'declined' ? 'rejected' : 'pending';
      $('#filterStatus').value = status;
      state.filters.status = status;
      state.filters.q = '';
      state.filters.program = 'all';
      $('#searchInput').value = '';
      $('#filterProgram').value = 'all';
      renderApplications();
    }
  }

  function renderCounts() {
    const s = state.stats || { total: 0, pending: 0, approved: 0, rejected: 0 };
    $('#kTotal').textContent = s.total;
    $('#kPending').textContent = s.pending;
    $('#kApproved').textContent = s.approved;
    $('#kRejected').textContent = s.rejected;
    $('#cntAll').textContent = s.total;
    $('#cntPending').textContent = s.pending;
    $('#cntAdmitted').textContent = s.approved;
    $('#cntDeclined').textContent = s.rejected;
    if ($('#kAccounts')) $('#kAccounts').textContent = s.students || 0;
    if ($('#kProgrammes')) $('#kProgrammes').textContent = s.programmes || Object.keys(state.programs).length;
  }

  /** Keep the "programme" filter in step with the catalogue. */
  function syncProgramFilter() {
    const select = $('#filterProgram');
    if (!select) return;
    const keep = select.value || state.filters.program || 'all';
    select.innerHTML = [
      '<option value="all">All programmes</option>',
      ...state.programs.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`),
    ].join('');
    select.value = state.programs.some((p) => p.id === keep) ? keep : 'all';
    state.filters.program = select.value;
  }

  function renderOverview() {
    const s = state.stats;
    if (!s) return;
    $('#programBreakdown').innerHTML = s.byProgram
      .map((p) => {
        const pct = s.total ? Math.round((p.total / s.total) * 100) : 0;
        return `
        <div class="${accentOf(p.id)}" style="margin-bottom:16px">
          <div class="breakdown-head">
            <b style="color:var(--accent-600);font-weight:700">${esc(p.name)}</b>
            <span style="color:var(--muted)">${p.total} application${p.total === 1 ? '' : 's'} · ${p.pending} pending · ${p.approved} admitted</span>
          </div>
          <div class="breakdown-bar">
            <div style="width:${pct}%;background:linear-gradient(90deg, var(--accent), var(--accent-600))"></div>
          </div>
        </div>`;
      })
      .join('');

    $('#recentBody').innerHTML =
      s.recent.length === 0
        ? emptyRow(6, 'No applications have been submitted yet.')
        : s.recent
            .map(
              (a) => `
        <tr>
          <td>
            <div class="applicant-cell">
              <span class="avatar-sm"><img src="${a.applicant.photo}" alt=""></span>
              <span><b>${esc(a.applicant.firstName)} ${esc(a.applicant.surname)}</b><small>${esc(a.applicant.email)}</small></span>
            </div>
          </td>
          <td class="ref-cell">${esc(a.ref)}</td>
          <td><span class="prog-chip p-${a.program}">${esc(a.programName)}</span></td>
          <td style="color:var(--muted);font-size:.82rem">${esc(fmtDate(a.submittedAt))}</td>
          <td>${STATUS_BADGE[a.status] || ''}</td>
          <td style="text-align:right"><button class="btn btn-sm btn-outline" data-open="${a.id}">Review</button></td>
        </tr>`
            )
            .join('');
    bindOpen();
  }

  function emptyRow(cols, text) {
    return `<tr><td colspan="${cols}"><div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>
      <div>${esc(text)}</div></div></td></tr>`;
  }

  function filteredApplications() {
    const { q, program, status } = state.filters;
    const needle = q.trim().toLowerCase();
    return state.applications.filter((a) => {
      if (program !== 'all' && a.program !== program) return false;
      if (status !== 'all' && a.status !== status) return false;
      if (!needle) return true;
      return [a.ref, a.admissionNumber || '', a.applicant.firstName, a.applicant.middleName, a.applicant.surname, a.applicant.email, a.applicant.phone, a.programName]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }

  function renderApplications() {
    const list = filteredApplications();
    $('#listCount').textContent = `${list.length} record${list.length === 1 ? '' : 's'}`;
    const body = $('#applicationsBody');
    if (!body) return;
    body.innerHTML =
      list.length === 0
        ? emptyRow(7, 'No applications match this filter.')
        : list
            .map(
              (a) => `
      <tr>
        <td>
          <div class="applicant-cell">
            <span class="avatar-sm"><img src="${a.applicant.photo}" alt=""></span>
            <span><b>${esc(a.applicant.firstName)} ${esc(a.applicant.surname)}</b><small>${esc(a.applicant.phone)}</small></span>
          </div>
        </td>
        <td class="ref-cell">${esc(a.ref)}</td>
        <td><span class="prog-chip p-${a.program}">${esc(a.programName)}</span></td>
        <td class="ref-cell">${a.admissionNumber ? esc(a.admissionNumber) : '<span style="color:#b3b9c0">—</span>'}</td>
        <td style="color:var(--muted);font-size:.82rem">${esc(fmtDate(a.submittedAt))}</td>
        <td>${STATUS_BADGE[a.status] || ''}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-sm ${a.status === 'pending' ? '' : 'btn-outline'}" data-open="${a.id}">${a.status === 'pending' ? 'Review' : 'View'}</button>
          <button class="btn btn-sm btn-ghost btn-icon-danger" data-delapp="${a.id}" title="Delete application" aria-label="Delete application">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>
          </button>
        </td>
      </tr>`
            )
            .join('');
    bindOpen();
  }

  function bindOpen() {
    $$('[data-open]').forEach((btn) =>
      btn.addEventListener('click', () => openApplication(btn.dataset.open))
    );
    $$('[data-delapp]').forEach((btn) => {
      const app = state.applications.find((a) => a.id === btn.dataset.delapp);
      if (app) btn.addEventListener('click', () => deleteApplication(app));
    });
  }

  ['searchInput', 'filterProgram', 'filterStatus'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(id === 'searchInput' ? 'input' : 'change', () => {
      if (id === 'searchInput') state.filters.q = el.value;
      if (id === 'filterProgram') state.filters.program = el.value;
      if (id === 'filterStatus') state.filters.status = el.value;
      renderApplications();
    });
  });

  function renderStudents() {
    const body = $('#studentsBody');
    if (!body) return;
    body.innerHTML =
      state.students.length === 0
        ? emptyRow(7, 'No applicant accounts yet.')
        : state.students
            .map(
              (s) => `
      <tr>
        <td><b style="font-weight:600">${esc(s.name)}</b></td>
        <td style="font-size:.82rem;color:var(--ink)">${esc(s.email)}<br><span style="color:var(--muted)">${esc(s.phone)}</span></td>
        <td>${esc(s.program)}</td>
        <td class="ref-cell">${esc(s.ref)}<br><span style="color:var(--muted)">${s.admissionNumber ? esc(s.admissionNumber) : '—'}</span></td>
        <td>${STATUS_BADGE[s.status] || STATUS_BADGE['no application']}</td>
        <td style="color:var(--muted);font-size:.82rem">${esc(fmtDate(s.joined))}</td>
        <td style="text-align:right"><button class="btn btn-sm btn-ghost btn-icon-danger" data-delstudent="${s.id}" title="Delete account" aria-label="Delete account">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>
        </button></td>
      </tr>`
            )
            .join('');

    $$('[data-delstudent]', body).forEach((btn) => {
      const student = state.students.find((s) => s.id === btn.dataset.delstudent);
      if (student) btn.addEventListener('click', () => deleteStudent(student));
    });
  }

  /* ------------------------- Review drawer --------------------------- */
  async function openApplication(id) {
    try {
      const { application, documents } = await api('/admin/applications/' + id);
      renderDrawer(application, documents);
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  function renderDrawer(a, d) {
    const checklist = (a.checklist || [])
      .map((c) => `<li class="${c.ok ? 'y' : 'n'}"><span class="ic">${c.ok ? '✓' : '·'}</span>${esc(c.label)}</li>`)
      .join('');

    const docCard = (label, src, hint) => `
      <div class="doc">
        <div class="doc-img ${src ? '' : 'empty-doc'}" ${src ? `data-zoom="${src}"` : ''}>
          ${src ? `<img src="${src}" alt="${esc(label)}">` : esc(hint || 'Not uploaded')}
        </div>
        <div class="doc-cap"><span>${esc(label)}</span>${src ? '<span class="ok">Uploaded</span>' : '<span class="no">Missing</span>'}</div>
      </div>`;

    const drawer = document.createElement('div');
    drawer.className = 'overlay';
    drawer.innerHTML = `
      <div class="drawer" role="dialog" aria-modal="true">
        <div class="drawer-head">
          <div>
            <h2>${esc(a.applicant.firstName)} ${esc(a.applicant.middleName)} ${esc(a.applicant.surname)}</h2>
            <div class="ref">${esc(a.ref)} · ${esc(a.programName)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            ${STATUS_BADGE[a.status] || ''}
            <button class="btn btn-ghost btn-sm" data-close style="font-size:1.2rem;line-height:1">✕</button>
          </div>
        </div>
        <div class="drawer-body">
          <div class="drawer-section">
            <h4>Documents &amp; credentials</h4>
            <div class="doc-grid">
              ${docCard('Passport photograph', d.photo)}
              ${docCard("O'level / result", d.resultDoc, 'Not uploaded')}
              ${docCard('Means of identification', d.idDoc, 'Not uploaded')}
            </div>
            <ul class="checklist" style="margin-top:14px">${checklist}</ul>
          </div>

          <div class="drawer-section">
            <h4>Applicant details</h4>
            <dl class="dl">
              <dt>Full name</dt><dd>${esc(a.applicant.firstName)} ${esc(a.applicant.middleName)} ${esc(a.applicant.surname)}</dd>
              <dt>Email</dt><dd>${esc(a.applicant.email)}</dd>
              <dt>Phone</dt><dd>${esc(a.applicant.phone)}</dd>
              <dt>Gender</dt><dd>${esc(a.applicant.gender)}</dd>
              <dt>Date of birth</dt><dd>${esc(fmtDate(a.applicant.dob))}</dd>
              <dt>Nationality</dt><dd>${esc(a.applicant.nationality)}</dd>
              <dt>State</dt><dd>${esc(a.applicant.state)}</dd>
              <dt>Address</dt><dd>${esc(a.applicant.address)}</dd>
              <dt>Qualification</dt><dd>${esc(a.applicant.qualification)}</dd>
              <dt>Guardian</dt><dd>${a.applicant.guardianName ? esc(a.applicant.guardianName) + ' · ' + esc(a.applicant.guardianPhone) : '—'}</dd>
            </dl>
          </div>

          <div class="drawer-section">
            <h4>Programme applied for</h4>
            <dl class="dl">
              <dt>Programme</dt><dd>${esc(a.programName)}</dd>
              <dt>School</dt><dd>${esc(a.programSchool)}</dd>
              <dt>Award</dt><dd>${esc(a.award)}</dd>
              <dt>Session</dt><dd>${esc(a.intake)}</dd>
              <dt>Submitted</dt><dd>${esc(fmtDate(a.submittedAt, true))}</dd>
              ${a.reviewedAt ? `<dt>Reviewed</dt><dd>${esc(fmtDate(a.reviewedAt, true))} by ${esc(a.reviewedBy || '—')}</dd>` : ''}
              ${a.admissionNumber ? `<dt>Admission no.</dt><dd class="mono">${esc(a.admissionNumber)}</dd>` : ''}
            </dl>
          </div>

          <div class="drawer-section">
            <h4>Decision note (visible to applicant)</h4>
            <textarea class="input drawer-note" id="reviewNote" rows="3" placeholder="e.g. Entry requirements verified. Welcome to Freshemia Academy.">${esc(a.reviewNote || '')}</textarea>
          </div>
        </div>

        <div class="review-actions">
          <button class="btn btn-ghost btn-icon-danger" id="deleteAppBtn" style="margin-right:auto" title="Delete this application">Delete application</button>
          <button class="btn btn-ghost" data-close>Close</button>
          ${
            a.status === 'approved'
              ? '<span class="badge badge-approved" style="align-self:center"><span class="b-dot"></span>Admission issued</span>'
              : `<button class="btn btn-danger" id="rejectBtn">Reject application</button>
                 <button class="btn btn-success" id="approveBtn">Approve &amp; issue admission</button>`
          }
        </div>
      </div>`;

    document.body.appendChild(drawer);
    document.body.style.overflow = 'hidden';

    const close = () => {
      drawer.remove();
      document.body.style.overflow = '';
    };
    $$('[data-close]', drawer).forEach((b) => b.addEventListener('click', close));
    drawer.addEventListener('click', (e) => {
      if (e.target === drawer) close();
    });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', onEsc);
      }
    });

    $$('[data-zoom]', drawer).forEach((el) =>
      el.addEventListener('click', () => {
        const box = document.createElement('div');
        box.className = 'lightbox';
        box.innerHTML = `<img src="${el.dataset.zoom}" alt="">`;
        box.addEventListener('click', () => box.remove());
        document.body.appendChild(box);
      })
    );

    $('#approveBtn', drawer)?.addEventListener('click', async () => {
      const btn = $('#approveBtn', drawer);
      btn.disabled = true;
      btn.textContent = 'Approving…';
      try {
        await api(`/admin/applications/${a.id}/approve`, {
          method: 'POST',
          body: { note: $('#reviewNote', drawer).value },
        });
        toast(`${a.applicant.firstName} ${a.applicant.surname} has been admitted.`, 'ok');
        close();
        await refreshConsole();
      } catch (e) {
        toast(e.message, 'err');
        btn.disabled = false;
        btn.textContent = 'Approve & issue admission';
      }
    });

    $('#deleteAppBtn', drawer)?.addEventListener('click', () => {
      close();
      deleteApplication(a);
    });

    $('#rejectBtn', drawer)?.addEventListener('click', () => {
      const note = $('#reviewNote', drawer).value.trim();
      openRejectModal(note, async (reason) => {
        try {
          await api(`/admin/applications/${a.id}/reject`, { method: 'POST', body: { note: reason } });
          toast('Application declined and the applicant notified.', 'ok');
          close();
          await refreshConsole();
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    });
  }

  function openRejectModal(prefill, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-card">
        <h3>Decline this application</h3>
        <p>The reason below is shown to the applicant in their portal. Please be specific about the requirement that was not met.</p>
        <textarea class="input" id="rejectReason" rows="3" placeholder="e.g. Mathematics credit is outstanding.">${esc(prefill || '')}</textarea>
        <div style="font-size:.78rem;color:var(--red);margin-top:8px" id="rejectErr"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-cancel>Cancel</button>
          <button class="btn btn-danger" data-confirm>Decline application</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    $('[data-cancel]', modal).addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
    $('[data-confirm]', modal).addEventListener('click', () => {
      const reason = $('#rejectReason', modal).value.trim();
      if (!reason) {
        $('#rejectErr', modal).textContent = 'A reason is required.';
        return;
      }
      close();
      onConfirm(reason);
    });
  }

  /* -------------------- Programme & fee management ------------------- */
  function renderProgrammes() {
    const body = $('#programmesBody');
    if (!body) return;
    const counts = {};
    state.applications.forEach((a) => {
      counts[a.program] = (counts[a.program] || 0) + 1;
    });

    body.innerHTML = state.programs.length
      ? state.programs
          .map(
            (p) => `
        <tr class="${accentOf(p.id)}">
          <td>
            <div class="prog-name-cell">
              <span class="prog-dot" aria-hidden="true"></span>
              <span>
                <b>${esc(p.name)}</b>
                <small>${esc(p.school || '')}</small>
              </span>
            </div>
          </td>
          <td class="ref-cell">${esc(p.code || '—')}</td>
          <td>${esc(p.duration || '—')}</td>
          <td>
            <div class="fee-editor">
              <span class="fee-cur">₦</span>
              <input class="input fee-input" type="number" min="0" step="1000" value="${Number(p.feeAmount) || 0}" data-fee="${esc(p.id)}" aria-label="Tuition for ${esc(p.name)}">
              <select class="input fee-period" data-period="${esc(p.id)}" aria-label="Billing period">
                ${['per session', 'per term', 'per year']
              .map((x) => `<option${x === p.feePeriod ? ' selected' : ''}>${x}</option>`)
              .join('')}
              </select>
              <button class="btn btn-sm btn-outline" data-savefee="${esc(p.id)}">Save</button>
            </div>
          </td>
          <td><span class="chip-count">${counts[p.id] || 0}</span></td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn btn-sm btn-outline" data-editprog="${esc(p.id)}">Edit</button>
            <button class="btn btn-sm btn-ghost btn-icon-danger" data-delprog="${esc(p.id)}" title="Remove programme" aria-label="Remove programme">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>
            </button>
          </td>
        </tr>`
          )
          .join('')
      : emptyRow(6, 'No programmes yet — add the first one to open admissions.');

    $$('[data-savefee]', body).forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = btn.dataset.savefee;
        const amount = Number($(`[data-fee="${id}"]`, body).value);
        const period = $(`[data-period="${id}"]`, body).value;
        if (!isFinite(amount) || amount < 0) return toast('Enter a valid tuition amount.', 'err');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
          await api('/admin/programs/' + id, { method: 'PATCH', body: { feeAmount: amount, feePeriod: period } });
          toast('Tuition updated — the website shows the new price immediately.', 'ok');
          await refreshConsole();
          refreshPublicProgrammes();
        } catch (e) {
          toast(e.message, 'err');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Save';
        }
      })
    );

    $$('[data-editprog]', body).forEach((btn) =>
      btn.addEventListener('click', () => {
        const program = state.programs.find((p) => p.id === btn.dataset.editprog);
        if (program) openProgrammeModal(program);
      })
    );

    $$('[data-delprog]', body).forEach((btn) =>
      btn.addEventListener('click', () => {
        const program = state.programs.find((p) => p.id === btn.dataset.delprog);
        if (program) deleteProgramme(program);
      })
    );
  }

  /** Open the "new / edit programme" form. */
  function openProgrammeModal(program) {
    const editing = !!program;
    const p = program || {
      id: '',
      name: '',
      code: '',
      school: 'School of Computing & Cyber Sciences',
      award: '',
      duration: '24 months (4 semesters)',
      feeAmount: 150000,
      feePeriod: 'per session',
      accent: 'cyber',
      summary: '',
      entry: '',
      modules: [],
    };

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-card modal-wide acc-${esc(p.accent || 'cyber')}">
        <h3>${editing ? 'Edit programme' : 'Add a programme'}</h3>
        <p>${editing ? 'Changes are published to the website straight away.' : 'The new course appears on the website and in the application form immediately.'}</p>
        <div class="modal-grid">
          <div class="field"><label>Programme name <span class="req">*</span></label><input class="input" id="pName" value="${esc(p.name)}" placeholder="e.g. Cloud Engineering"></div>
          <div class="field"><label>Code <span class="req">*</span></label><input class="input" id="pCode" value="${esc(p.code)}" maxlength="5" placeholder="CLD"><div class="help">2–5 characters, used in admission numbers.</div></div>
          <div class="field"><label>School / department</label><input class="input" id="pSchool" value="${esc(p.school || '')}"></div>
          <div class="field"><label>Award</label><input class="input" id="pAward" value="${esc(p.award || '')}" placeholder="Diploma in Cloud Engineering"></div>
          <div class="field"><label>Duration <span class="req">*</span></label><input class="input" id="pDuration" value="${esc(p.duration || '')}" placeholder="24 months (4 semesters)"></div>
          <div class="field"><label>Tuition <span class="req">*</span></label>
            <div style="display:flex;gap:8px">
              <input class="input" id="pFee" type="number" min="0" step="1000" value="${Number(p.feeAmount) || 0}" style="flex:1">
              <select class="input" id="pPeriod" style="width:130px">
                ${['per session', 'per term', 'per year'].map((x) => `<option${x === p.feePeriod ? ' selected' : ''}>${x}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field"><label>Colour</label>
            <select class="input" id="pAccent">
              <option value="cyber"${p.accent === 'cyber' ? ' selected' : ''}>Teal — technology</option>
              <option value="ai"${p.accent === 'ai' ? ' selected' : ''}>Violet — artificial intelligence</option>
              <option value="cop"${p.accent === 'cop' ? ' selected' : ''}>Amber — professional</option>
            </select>
          </div>
          <div class="field"><label>Modules</label><input class="input" id="pModules" value="${esc((p.modules || []).join(', '))}" placeholder="Comma separated"></div>
          <div class="field modal-span"><label>Short description</label><textarea class="input" id="pSummary" rows="2">${esc(p.summary || '')}</textarea></div>
          <div class="field modal-span"><label>Entry requirements</label><input class="input" id="pEntry" value="${esc(p.entry || '')}"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-cancel>Cancel</button>
          <button class="btn btn-gold" data-save>${editing ? 'Save changes' : 'Add programme'}</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    const close = () => modal.remove();
    $('[data-cancel]', modal).addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });

    $('[data-save]', modal).addEventListener('click', async () => {
      const body = {
        name: $('#pName', modal).value.trim(),
        code: $('#pCode', modal).value.trim().toUpperCase(),
        school: $('#pSchool', modal).value.trim(),
        award: $('#pAward', modal).value.trim(),
        duration: $('#pDuration', modal).value.trim(),
        feeAmount: Number($('#pFee', modal).value),
        feePeriod: $('#pPeriod', modal).value,
        accent: $('#pAccent', modal).value,
        modules: $('#pModules', modal).value,
        summary: $('#pSummary', modal).value.trim(),
        entry: $('#pEntry', modal).value.trim(),
      };
      const btn = $('[data-save]', modal);
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        if (editing) await api('/admin/programs/' + p.id, { method: 'PATCH', body });
        else await api('/admin/programs', { method: 'POST', body });
        close();
        toast(editing ? 'Programme updated.' : 'Programme added — it is live on the website.', 'ok');
        await refreshConsole();
        refreshPublicProgrammes();
      } catch (e) {
        toast(e.message, 'err');
        btn.disabled = false;
        btn.textContent = editing ? 'Save changes' : 'Add programme';
      }
    });
  }

  function deleteProgramme(program) {
    openConfirm(
      {
        title: 'Remove this programme?',
        message: `${program.name} will no longer be offered on the website or in the application form. Applications already received keep their details.`,
        confirmLabel: 'Remove programme',
      },
      async (_, modal) => {
        try {
          await api('/admin/programs/' + program.id, { method: 'DELETE' });
          toast(`${program.name} removed from the catalogue.`, 'ok');
          await refreshConsole();
          refreshPublicProgrammes();
        } catch (e) {
          if (e.status === 409) {
            modal.remove();
            openConfirm(
              {
                title: 'Programme already in use',
                message: e.message,
                confirmLabel: 'Remove anyway',
              },
              async () => {
                try {
                  await api('/admin/programs/' + program.id + '?force=1', { method: 'DELETE' });
                  toast(`${program.name} removed; existing applications are intact.`, 'ok');
                  await refreshConsole();
                  refreshPublicProgrammes();
                } catch (err) {
                  toast(err.message, 'err');
                }
              }
            );
            return;
          }
          toast(e.message, 'err');
        }
      }
    );
  }

  /* ---------------------- Deleting records ------------------------- */
  function deleteApplication(app) {
    openConfirm(
      {
        title: 'Delete this application?',
        message: `${app.ref} — ${app.applicant.firstName} ${app.applicant.surname}. The application, its passport photograph and uploaded documents are removed permanently.`,
        confirmLabel: 'Delete application',
        checkbox: { label: 'Also delete the applicant’s portal account' },
      },
      async (checked) => {
        try {
          const res = await api(`/admin/applications/${app.id}${checked ? '?account=1' : ''}`, { method: 'DELETE' });
          toast(
            res.accountDeleted ? `${app.ref} and the applicant’s account were deleted.` : `${app.ref} deleted.`,
            'ok'
          );
          await refreshConsole();
        } catch (e) {
          toast(e.message, 'err');
        }
      }
    );
  }

  function deleteStudent(student) {
    openConfirm(
      {
        title: 'Delete this account?',
        message: `${student.name} (${student.email}) and any application linked to the account will be removed permanently.`,
        confirmLabel: 'Delete account',
      },
      async () => {
        try {
          await api('/admin/students/' + student.id, { method: 'DELETE' });
          toast(`${student.name} deleted.`, 'ok');
          await refreshConsole();
        } catch (e) {
          toast(e.message, 'err');
        }
      }
    );
  }

  /** Reusable confirmation dialog (optionally with a tick box). */
  function openConfirm(opts, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-card danger">
        <h3>${esc(opts.title)}</h3>
        <p>${esc(opts.message)}</p>
        ${
          opts.checkbox
            ? `<label class="check-row"><input type="checkbox" id="confirmCheck"> <span>${esc(opts.checkbox.label)}</span></label>`
            : ''
        }
        <div class="modal-actions">
          <button class="btn btn-ghost" data-cancel>Cancel</button>
          <button class="btn btn-danger" data-confirm>${esc(opts.confirmLabel || 'Confirm')}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    $('[data-cancel]', modal).addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
    $('[data-confirm]', modal).addEventListener('click', () => {
      const checked = opts.checkbox ? $('#confirmCheck', modal).checked : false;
      close();
      onConfirm(checked, modal);
    });
  }

  /* ------------------- keep the public site in sync ------------------ */
  function refreshPublicProgrammes() {
    const grid = $('#programGrid');
    if (grid) {
      grid.dataset.done = '';
      grid.innerHTML = '';
      renderProgramCards();
    }
    if (!state.selectedProgram && $('#chooseGrid')) renderChooser();
  }

  $('#addProgrammeBtn')?.addEventListener('click', () => openProgrammeModal(null));

  /* ================================================================== */
  /* Theme (light / dark)                                               */
  /* ================================================================== */
  const THEME_KEY = 'fa_theme';

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(mode) {
    if (mode === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      /* storage blocked — theme still applies for this visit */
    }
  }

  document.querySelectorAll('.theme-toggle').forEach((btn) =>
    btn.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      toast(next === 'dark' ? 'Dark mode on.' : 'Light mode on.', 'ok');
    })
  );

  /* ================================================================== */
  /* Boot                                                               */
  /* ================================================================== */
  $('#navToggle')?.addEventListener('click', () => $('#mainNav').classList.toggle('open'));
  window.addEventListener('hashchange', router);

  wireSubmit('loginForm', 'loginBtn');
  wireSubmit('signupForm', 'signupBtn');
  wireSubmit('adminLoginForm', 'admLoginBtn');
  wireSubmit('verifyForm', 'verifyBtn');

  /* Offline (single-file) mode notice */
  function showOfflineBanner() {
    const banner = $('#demoBanner');
    if (banner) banner.classList.remove('hidden');
  }
  window.addEventListener('fa:offline', showOfflineBanner);
  $('#dismissDemo')?.addEventListener('click', () => $('#demoBanner')?.classList.add('hidden'));

  (async function boot() {
    const year = $('#year');
    if (year) year.textContent = new Date().getFullYear();

    // Restore both sessions independently.
    const studentSession = Auth.get('student');
    if (studentSession) {
      try {
        const { user } = await api('/auth/me', { as: 'student' });
        state.student = { token: studentSession.token, user };
      } catch {
        Auth.clear('student');
      }
    }
    const adminSession = Auth.get('admin');
    if (adminSession) {
      try {
        const { user } = await api('/auth/me', { as: 'admin' });
        if (user.role === 'admin') state.admin = { token: adminSession.token, user };
        else Auth.clear('admin');
      } catch {
        Auth.clear('admin');
      }
    }

    syncChrome();
    await loadPrograms();
    if (window.FA.offline) showOfflineBanner();
    router();
  })();
})();
