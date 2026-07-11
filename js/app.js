/* ========================================================
   Sync Module - نواة POS
   ======================================================== */

Nawa.Sync = {
  _status: 'online',
  _interval: null,
  _pendingChanges: 0,

  init() {
    this._status = navigator.onLine ? 'online' : 'offline';
    this.startPeriodicSync();
    this._setupNetworkListeners();
  },

  _setupNetworkListeners() {
    window.addEventListener('online', () => {
      this._status = 'online';
      this.push();
      this._updateIndicators();
    });

    window.addEventListener('offline', () => {
      this._status = 'offline';
      this._updateIndicators();
    });
  },

  startPeriodicSync() {
    if (this._interval) clearInterval(this._interval);
    this._interval = setInterval(() => {
      if (navigator.onLine && this._pendingChanges > 0) {
        this.push();
      }
    }, 30000);
  },

  async push() {
    if (!navigator.onLine) {
      this._status = 'offline';
      this._updateIndicators();
      return;
    }

    this._status = 'syncing';
    this._updateIndicators();

    try {
      await new Promise(r => setTimeout(r, 800 + Math.random() * 700));
      this._pendingChanges = 0;
      this._status = 'online';
      this._updateIndicators();
    } catch (e) {
      this._status = 'online';
      this._updateIndicators();
    }
  },

  async pull() {
    if (!navigator.onLine) {
      this._status = 'offline';
      this._updateIndicators();
      return;
    }

    this._status = 'syncing';
    this._updateIndicators();

    try {
      await new Promise(r => setTimeout(r, 600 + Math.random() * 500));
      this._status = 'online';
      this._updateIndicators();
    } catch (e) {
      this._status = 'online';
      this._updateIndicators();
    }
  },

  getStatus() {
    if (!navigator.onLine) return 'offline';
    return this._status;
  },

  addPendingChange() {
    this._pendingChanges++;
  },

  _updateIndicators() {
    document.querySelectorAll('.sa-sync-status').forEach(el => {
      const status = this.getStatus();
      el.className = `sa-sync-status ${status}`;
      const labels = { online: 'متصل', offline: 'غير متصل', syncing: 'جاري المزامنة' };
      const dot = el.querySelector('.sa-sync-dot');
      if (dot) dot.insertAdjacentText('afterend', '');
      el.textContent = '';
      const span = document.createElement('span');
      span.className = 'sa-sync-dot';
      el.appendChild(span);
      el.appendChild(document.createTextNode(' ' + (labels[status] || 'متصل')));
    });

    document.querySelectorAll('.sync-indicator').forEach(el => {
      const status = this.getStatus();
      el.className = `sync-indicator ${status}`;
      const labels = { online: 'متصل', offline: 'غير متصل', syncing: 'مزامنة...' };
      el.textContent = labels[status] || 'متصل';
    });
  },

  destroy() {
    if (this._interval) clearInterval(this._interval);
  }
};


/* ========================================================
   Main App Router - نواة POS
   ======================================================== */

const App = {
  currentPage: null,

  async init() {
    if (Nawa.I18n && Nawa.I18n.init) {
      Nawa.I18n.init();
    }

    try {
      if (Nawa.DB && Nawa.DB.init) {
        await Nawa.DB.init();
      }
    } catch (e) {
      console.warn('DB init warning:', e);
    }

    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/sw.js');
      } catch (e) {
        console.warn('SW registration skipped:', e.message);
      }
    }

    Nawa.Sync.init();

    window.addEventListener('hashchange', () => this.route());

    window.addEventListener('online', () => {
      if (Nawa.Sync && Nawa.Sync.push) Nawa.Sync.push();
    });

    window.addEventListener('offline', () => {
      this._showNetworkStatus('offline');
    });

    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'SYNC_COMPLETE') {
        this._showNetworkStatus('synced');
      }
    });

    this.route();
  },

  route() {
    const hash = window.location.hash || '#/';
    const raw = hash.slice(2);
    const parts = raw.split('/');
    const path = parts[0] || '';
    const params = parts.slice(1);

    switch (path) {
      case '':
      case 'login':
        this.showLogin();
        break;
      case 'pos':
        this.showPOS();
        break;
      case 'admin':
        this.showAdmin();
        break;
      case 'super-admin':
        this.showSuperAdmin();
        break;
      case 'logout':
        this.logout();
        break;
      default:
        this.showLogin();
    }
  },

  async showLogin() {
    this.currentPage = 'login';
    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = this.renderLoginPage();

    const form = document.getElementById('loginForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const errorEl = document.getElementById('loginError');

        if (!username || !password) {
          if (errorEl) {
            errorEl.textContent = 'يرجى إدخال اسم المستخدم وكلمة المرور';
            errorEl.classList.remove('hidden');
          }
          return;
        }

        try {
          let user = null;

          if (Nawa.Auth && Nawa.Auth.login) {
            user = await Nawa.Auth.login(username, password);
          } else {
            user = this._fallbackLogin(username, password);
          }

          if (user && user.role) {
            if (Nawa.I18n && Nawa.I18n.t) {
              // Language already initialized
            }

            switch (user.role) {
              case 'super_admin':
                window.location.hash = '#/super-admin';
                break;
              case 'admin':
                window.location.hash = '#/admin';
                break;
              case 'cashier':
                window.location.hash = '#/pos';
                break;
              default:
                window.location.hash = '#/login';
            }
          } else {
            if (errorEl) {
              errorEl.textContent = 'اسم المستخدم أو كلمة المرور غير صحيحة';
              errorEl.classList.remove('hidden');
            }
          }
        } catch (err) {
          console.error('Login error:', err);
          if (errorEl) {
            errorEl.textContent = 'حدث خطأ أثناء تسجيل الدخول';
            errorEl.classList.remove('hidden');
          }
        }
      });
    }

    const langBtn = document.getElementById('langToggle');
    if (langBtn) {
      langBtn.addEventListener('click', () => {
        if (Nawa.I18n && Nawa.I18n.toggle) {
          Nawa.I18n.toggle();
          this.showLogin();
        }
      });
    }
  },

  _fallbackLogin(username, password) {
    const users = {
      admin: { username: 'admin', password: 'admin123', role: 'admin', name: 'مدير المطعم' },
      cashier: { username: 'cashier', password: 'cashier123', role: 'cashier', name: 'كاشير' },
      superadmin: { username: 'superadmin', password: 'super123', role: 'super_admin', name: 'مدير النظام العام' },
    };

    const user = users[username.toLowerCase()];
    if (user && user.password === password) {
      const session = { username: user.username, role: user.role, name: user.name, loginTime: new Date().toISOString() };
      try { localStorage.setItem('nawa_session', JSON.stringify(session)); } catch (e) {}
      return user;
    }
    return null;
  },

  async showPOS() {
    this.currentPage = 'pos';
    if (!this._checkAuth('cashier')) return;

    const app = document.getElementById('app');
    if (!app) return;

    if (Nawa.POS && Nawa.POS.init) {
      await Nawa.POS.init();
    } else {
      app.innerHTML = this._renderModulePlaceholder('نقطة البيع', 'POS');
    }
  },

  async showAdmin() {
    this.currentPage = 'admin';
    if (!this._checkAuth('admin')) return;

    const app = document.getElementById('app');
    if (!app) return;

    if (Nawa.Admin && Nawa.Admin.init) {
      await Nawa.Admin.init();
    } else {
      app.innerHTML = this._renderModulePlaceholder('لوحة إدارة المطعم', 'Admin');
    }
  },

  async showSuperAdmin() {
    this.currentPage = 'super-admin';
    if (!this._checkAuth('super_admin')) return;

    const app = document.getElementById('app');
    if (!app) return;

    if (Nawa.SuperAdmin && Nawa.SuperAdmin.init) {
      await Nawa.SuperAdmin.init();
    } else {
      app.innerHTML = this._renderModulePlaceholder('لوحة التحكم العام', 'Super Admin');
    }
  },

  _checkAuth(minRole) {
    let session = null;
    try {
      const raw = localStorage.getItem('nawa_session');
      if (raw) session = JSON.parse(raw);
    } catch (e) {}

    if (Nawa.Auth && Nawa.Auth.getSession) {
      session = Nawa.Auth.getSession();
    }

    if (!session) {
      window.location.hash = '#/login';
      return false;
    }

    const hierarchy = { cashier: 1, admin: 2, super_admin: 3 };
    const userLevel = hierarchy[session.role] || 0;
    const requiredLevel = hierarchy[minRole] || 0;

    if (userLevel < requiredLevel) {
      window.location.hash = '#/login';
      return false;
    }

    return true;
  },

  logout() {
    try { localStorage.removeItem('nawa_session'); } catch (e) {}
    if (Nawa.Auth && Nawa.Auth.logout) Nawa.Auth.logout();
    window.location.hash = '#/login';
  },

  renderLoginPage() {
    const currentLang = (Nawa.I18n && Nawa.I18n.getLang) ? Nawa.I18n.getLang() : 'ar';
    const langLabel = currentLang === 'ar' ? 'EN |عربي' : 'عربي |EN';

    return `
    <div class="login-page">
      <div class="login-card">
        <div class="login-logo">
          ${this.getLogo(80)}
        </div>
        <h1 class="login-company">نواة</h1>
        <p class="login-tagline">نظام نقطة البيع للمطاعم</p>
        <form id="loginForm" class="login-form">
          <div class="form-group">
            <label>اسم المستخدم</label>
            <input type="text" id="username" class="form-input" placeholder="أدخل اسم المستخدم" autocomplete="username">
          </div>
          <div class="form-group">
            <label>كلمة المرور</label>
            <input type="password" id="password" class="form-input" placeholder="أدخل كلمة المرور" autocomplete="current-password">
          </div>
          <button type="submit" class="btn btn-primary btn-xl w-full">دخول</button>
          <div id="loginError" class="hidden" style="color:var(--danger,#ef4444);text-align:center;margin-top:12px;"></div>
        </form>
        <button id="langToggle" class="btn btn-ghost login-lang-btn">
          ${langLabel}
        </button>
      </div>
    </div>`;
  },

  getLogo(size) {
    size = size || 80;
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="12" fill="#0D9488"/>
      <ellipse cx="50" cy="50" rx="35" ry="14" stroke="#0D9488" stroke-width="2.5" fill="none" transform="rotate(0 50 50)"/>
      <ellipse cx="50" cy="50" rx="35" ry="14" stroke="#14B8A6" stroke-width="2.5" fill="none" transform="rotate(60 50 50)"/>
      <ellipse cx="50" cy="50" rx="35" ry="14" stroke="#0F766E" stroke-width="2.5" fill="none" transform="rotate(120 50 50)"/>
      <circle cx="85" cy="50" r="5" fill="#14B8A6"/>
      <circle cx="32.5" cy="21.7" r="5" fill="#0D9488"/>
      <circle cx="32.5" cy="78.3" r="5" fill="#0F766E"/>
    </svg>`;
  },

  _renderModulePlaceholder(title, module) {
    return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#f1f5f9;font-family:Segoe UI,sans-serif;">
      <div style="text-align:center;">
        ${this.getLogo(64)}
        <h2 style="margin-top:20px;color:#1e293b;font-size:22px;">${title}</h2>
        <p style="color:#64748b;margin-top:8px;font-size:14px;">الوحدة ${module} قيد التحميل...</p>
        <div style="margin-top:24px;width:48px;height:48px;border:4px solid #e2e8f0;border-top-color:#0d9488;border-radius:50%;animation:spin .8s linear infinite;margin:24px auto 0;"></div>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    </div>`;
  },

  _showNetworkStatus(status) {
    const existing = document.querySelector('.app-network-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'app-network-toast';

    const styles = {
      offline: { bg: '#f59e0b', text: 'أنت غير متصل بالإنترنت' },
      synced: { bg: '#22c55e', text: 'تمت المزامنة بنجاح' },
    };

    const s = styles[status] || styles.offline;

    toast.style.cssText = `
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      background:${s.bg};color:#fff;padding:12px 24px;border-radius:8px;
      font-family:'Segoe UI',sans-serif;font-size:14px;font-weight:600;
      box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:9999;
      animation:netToastIn .3s ease;
    `;
    toast.textContent = s.text;
    document.body.appendChild(toast);

    if (!document.getElementById('netToastStyle')) {
      const style = document.createElement('style');
      style.id = 'netToastStyle';
      style.textContent = `
        @keyframes netToastIn { from { opacity:0; transform:translateX(-50%) translateY(20px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
      `;
      document.head.appendChild(style);
    }

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity .3s';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
};


/* ========================================================
   Login Page Styles (injected on first load)
   ======================================================== */

(function injectLoginStyles() {
  if (document.getElementById('app-login-styles')) return;
  const style = document.createElement('style');
  style.id = 'app-login-styles';
  style.textContent = `
    .login-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      padding: 20px;
    }

    .login-card {
      background: #fff;
      border-radius: 16px;
      padding: 48px 40px 40px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 20px 60px rgba(0,0,0,.3);
      text-align: center;
      position: relative;
    }

    .login-logo {
      display: flex;
      justify-content: center;
      margin-bottom: 16px;
    }

    .login-company {
      font-size: 32px;
      font-weight: 800;
      color: #0d9488;
      margin: 0;
      letter-spacing: -.5px;
    }

    .login-tagline {
      font-size: 14px;
      color: #64748b;
      margin: 6px 0 32px;
    }

    .login-form {
      text-align: right;
    }

    .login-form .form-group {
      margin-bottom: 18px;
    }

    .login-form .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 6px;
    }

    .login-form .form-input {
      width: 100%;
      padding: 12px 16px;
      border: 1.5px solid #e2e8f0;
      border-radius: 10px;
      font-size: 15px;
      font-family: inherit;
      transition: all .2s;
      background: #f8fafc;
    }

    .login-form .form-input:focus {
      outline: none;
      border-color: #0d9488;
      box-shadow: 0 0 0 3px rgba(13,148,136,.12);
      background: #fff;
    }

    .login-form .form-input::placeholder {
      color: #94a3b8;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 24px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all .2s;
      font-family: inherit;
    }

    .btn-primary {
      background: #0d9488;
      color: #fff;
    }

    .btn-primary:hover {
      background: #0f766e;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(13,148,136,.3);
    }

    .btn-ghost {
      background: transparent;
      color: #64748b;
      border: 1.5px solid #e2e8f0;
    }

    .btn-ghost:hover {
      border-color: #0d9488;
      color: #0d9488;
    }

    .btn-xl {
      padding: 14px 24px;
      font-size: 16px;
    }

    .w-full { width: 100%; }

    .hidden { display: none !important; }

    .login-lang-btn {
      position: absolute;
      bottom: 16px;
      left: 16px;
      font-size: 12px;
      padding: 6px 14px;
      border-radius: 8px;
    }

    .login-footer {
      margin-top: 24px;
      font-size: 11px;
      color: #94a3b8;
    }
  `;
  document.head.appendChild(style);
})();


/* ========================================================
   Bootstrap
   ======================================================== */

document.addEventListener('DOMContentLoaded', () => App.init());
