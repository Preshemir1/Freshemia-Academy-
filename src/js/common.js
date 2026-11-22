/* Shared helpers for the Freshemia Academy portal */
(function () {
  'use strict';

  const KEYS = {
    student: { token: 'fa_student_token', user: 'fa_student_user' },
    admin: { token: 'fa_admin_token', user: 'fa_admin_user' },
  };

  /* Some browsers block localStorage for file:// pages — degrade to memory. */
  const mem = {};
  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return k in mem ? mem[k] : null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {
        mem[k] = v;
      }
    },
    remove(k) {
      try {
        localStorage.removeItem(k);
      } catch {
        delete mem[k];
      }
    },
  };

  /**
   * Two independent session slots (applicant + administrator) live side by side in
   * the same browser, so signing into the console never disturbs an applicant session.
   */
  const Auth = {
    get(role) {
      const k = KEYS[role];
      if (!k) return null;
      const token = store.get(k.token) || '';
      if (!token) return null;
      let user = null;
      try {
        user = JSON.parse(store.get(k.user) || 'null');
      } catch {
        user = null;
      }
      return { token, user };
    },
    get student() {
      return this.get('student');
    },
    get admin() {
      return this.get('admin');
    },
    get studentUser() {
      const s = this.get('student');
      return s ? s.user : null;
    },
    get adminUser() {
      const s = this.get('admin');
      return s ? s.user : null;
    },
    set(role, token, user) {
      const k = KEYS[role];
      store.set(k.token, token);
      store.set(k.user, JSON.stringify(user));
    },
    clear(role) {
      const k = KEYS[role];
      store.remove(k.token);
      store.remove(k.user);
    },
  };

  let offline = false;

  function goOffline() {
    if (offline) return;
    offline = true;
    window.FA.offline = true;
    window.dispatchEvent(new CustomEvent('fa:offline'));
  }

  /** When there is no API server, the bundled demo engine answers instead. */
  function useDemo(path, options, role) {
    if (!window.FA_DEMO) return Promise.reject(new Error('The portal server is not reachable.'));
    goOffline();
    try {
      return Promise.resolve(window.FA_DEMO.handle(path, options));
    } catch (err) {
      if (err && err.status === 401) Auth.clear(role);
      return Promise.reject(err);
    }
  }

  /**
   * Fetch wrapper. The token used is chosen from the endpoint: everything under
   * /admin uses the administrator session, everything else the applicant session.
   */
  async function api(path, options = {}) {
    const { as, ...rest } = options;
    const role = as || (path.startsWith('/admin') ? 'admin' : 'student');
    const opts = { headers: { ...(rest.headers || {}) }, ...rest };
    if (opts.body && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const session = Auth.get(role);
    if (session) opts.headers.Authorization = 'Bearer ' + session.token;

    // Opened straight from disk: no server to talk to.
    if (location.protocol === 'file:') return useDemo(path, opts, role);

    let res;
    try {
      res = await fetch('/api' + path, opts);
    } catch {
      // file:// or no server at all
      return useDemo(path, opts, role);
    }
    // A static host without the API returns HTML here — fall back to the demo engine.
    if (!(res.headers.get('content-type') || '').includes('application/json')) {
      return useDemo(path, opts, role);
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* empty body */
    }
    if (!res.ok) {
      const message = (data && (data.error || data.message)) || 'Something went wrong. Please try again.';
      const error = new Error(message);
      error.status = res.status;
      error.data = data;
      if (res.status === 401) Auth.clear(role);
      throw error;
    }
    return data;
  }

  function toast(message, type = '') {
    let stack = document.getElementById('toasts');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.id = 'toasts';
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 300);
    }, 4200);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDate(iso, withTime) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const opts = { day: '2-digit', month: 'long', year: 'numeric' };
    if (withTime) {
      opts.hour = '2-digit';
      opts.minute = '2-digit';
    }
    return d.toLocaleDateString('en-GB', opts);
  }

  /** Read an image file, downscale it and return a data URL (keeps uploads small). */
  function readImage(file, maxDim = 900, quality = 0.82) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'));
      if (file.size > 8 * 1024 * 1024) return reject(new Error('That image is larger than 8MB.'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That image could not be opened.'));
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  const STATUS_LABEL = {
    pending: 'Under review',
    approved: 'Admitted',
    rejected: 'Not successful',
    'no application': 'No application',
  };

  const FA = { Auth, api, toast, esc, fmtDate, readImage, STATUS_LABEL, offline: false };
  window.FA = FA;
})();
