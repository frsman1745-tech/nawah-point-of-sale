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
      // Sync pending orders to server
      const pendingItems = await Nawa.DB.getAll(Nawa.CONFIG.STORES.PENDING_SYNC) || [];
      const token = Nawa.Auth.getToken ? Nawa.Auth.getToken() : null;

      for (const item of pendingItems) {
        try {
          const headers = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = 'Bearer ' + token;

          const res = await fetch(Nawa.CONFIG.API_BASE + (item.endpoint || '/orders'), {
            method: item.method || 'POST',
            headers: headers,
            body: JSON.stringify(item.data)
          });

          if (res.ok) {
            await Nawa.DB.hardDelete(Nawa.CONFIG.STORES.PENDING_SYNC, item.id);
          }
        } catch (e) {
          // Keep item for next sync attempt
        }
      }

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
      const token = Nawa.Auth.getToken ? Nawa.Auth.getToken() : null;
      if (!token) {
        this._status = 'online';
        this._updateIndicators();
        return;
      }

      const headers = { 'Authorization': 'Bearer ' + token };

      // Pull orders
      const ordersRes = await fetch(Nawa.CONFIG.API_BASE + '/orders', { headers });
      if (ordersRes.ok) {
        const orders = await ordersRes.json();
        for (const order of orders) {
          await Nawa.DB.add(Nawa.CONFIG.STORES.ORDERS, order);
        }
      }

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

  async addPendingChange(type, data) {
    try {
      await Nawa.DB.add(Nawa.CONFIG.STORES.PENDING_SYNC, {
        type: type,
        data: data,
        timestamp: Date.now()
      });
      this._pendingCount++;
    } catch (e) {
      console.warn('Failed to queue pending change:', e);
    }
  },

  _updateIndicators() {
    const isAr = (Nawa.I18n && Nawa.I18n.getLang) ? Nawa.I18n.getLang() === 'ar' : true;
    const labels = {
      online: isAr ? 'متصل' : 'Online',
      offline: isAr ? 'غير متصل' : 'Offline',
      syncing: isAr ? 'جاري المزامنة' : 'Syncing...'
    };

    document.querySelectorAll('.sa-sync-status').forEach(el => {
      const status = this.getStatus();
      el.className = `sa-sync-status ${status}`;
      el.textContent = '';
      const span = document.createElement('span');
      span.className = 'sa-sync-dot';
      el.appendChild(span);
      el.appendChild(document.createTextNode(' ' + (labels[status] || labels.online)));
    });

    document.querySelectorAll('.sync-indicator').forEach(el => {
      const status = this.getStatus();
      el.className = `sync-indicator ${status}`;
      el.textContent = labels[status] || labels.online;
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
      case 'register':
        this.showRegister();
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

    // Check if already logged in
    const user = Nawa.Auth ? Nawa.Auth.getCurrentUser() : null;
    if (user) {
      switch (user.role) {
        case 'super_admin': window.location.hash = '#/super-admin'; return;
        case 'admin': window.location.hash = '#/admin'; return;
        case 'cashier': window.location.hash = '#/pos'; return;
      }
    }

    app.innerHTML = this.renderLoginPage();

    // Tab switching
    document.querySelectorAll('.login-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const mode = tab.dataset.mode;
        document.getElementById('cashierFields').classList.toggle('hidden', mode !== 'cashier');
        document.getElementById('adminFields').classList.toggle('hidden', mode !== 'admin');
        document.getElementById('superFields').classList.toggle('hidden', mode !== 'super');
        document.getElementById('loginError').classList.add('hidden');
      });
    });

    // Cashier form
    const cashierForm = document.getElementById('cashierForm');
    if (cashierForm) {
      cashierForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('cashierUsername').value.trim();
        const password = document.getElementById('cashierPassword').value;
        const errorEl = document.getElementById('loginError');
        if (!username || !password) {
          if (errorEl) { errorEl.textContent = Nawa.I18n.t('login_error_fields'); errorEl.classList.remove('hidden'); }
          return;
        }
        try {
          const user = await Nawa.Auth.cashierLogin(username, password);
          if (user && user.role) { window.location.hash = '#/pos'; }
        } catch (err) {
          if (errorEl) { errorEl.textContent = err.message || Nawa.I18n.t('login_error'); errorEl.classList.remove('hidden'); }
        }
      });
    }

    // Admin form
    const adminForm = document.getElementById('adminForm');
    if (adminForm) {
      adminForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('adminEmail').value.trim();
        const password = document.getElementById('adminPassword').value;
        const errorEl = document.getElementById('loginError');
        if (!email || !password) {
          if (errorEl) { errorEl.textContent = Nawa.I18n.t('login_error_fields'); errorEl.classList.remove('hidden'); }
          return;
        }
        try {
          const user = await Nawa.Auth.adminLogin(email, password);
          if (user && user.role) { window.location.hash = '#/admin'; }
        } catch (err) {
          if (errorEl) { errorEl.textContent = err.message || Nawa.I18n.t('login_error'); errorEl.classList.remove('hidden'); }
        }
      });
    }

    // Super admin form
    const superForm = document.getElementById('superForm');
    if (superForm) {
      superForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('superUsername').value.trim();
        const password = document.getElementById('superPassword').value;
        const errorEl = document.getElementById('loginError');
        if (!username || !password) {
          if (errorEl) { errorEl.textContent = Nawa.I18n.t('login_error_fields'); errorEl.classList.remove('hidden'); }
          return;
        }
        try {
          const user = await Nawa.Auth.superLogin(username, password);
          if (user && user.role) { window.location.hash = '#/super-admin'; }
        } catch (err) {
          if (errorEl) { errorEl.textContent = err.message || Nawa.I18n.t('login_error'); errorEl.classList.remove('hidden'); }
        }
      });
    }

    // Language toggle
    const langBtn = document.getElementById('langToggle');
    if (langBtn) {
      langBtn.addEventListener('click', () => {
        if (Nawa.I18n && Nawa.I18n.toggle) { Nawa.I18n.toggle(); this.showLogin(); }
      });
    }
  },

  async showRegister() {
    this.currentPage = 'register';
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = this.renderRegisterPage();

    const form = document.getElementById('registerForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('registerError');
        const successEl = document.getElementById('registerSuccess');
        if (errorEl) errorEl.classList.add('hidden');
        if (successEl) successEl.classList.add('hidden');

        const data = {
          restaurantName: document.getElementById('regRestaurantName').value.trim(),
          ownerName: document.getElementById('regOwnerName').value.trim(),
          email: document.getElementById('regEmail').value.trim(),
          phone: document.getElementById('regPhone').value.trim(),
          password: document.getElementById('regPassword').value,
        };

        if (!data.restaurantName || !data.ownerName || !data.email || !data.password) {
          if (errorEl) { errorEl.textContent = Nawa.I18n.getLang() === 'ar' ? 'يرجى ملء جميع الحقول المطلوبة' : 'Please fill all required fields'; errorEl.classList.remove('hidden'); }
          return;
        }
        if (data.password.length < 6) {
          if (errorEl) { errorEl.textContent = Nawa.I18n.getLang() === 'ar' ? 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' : 'Password must be at least 6 characters'; errorEl.classList.remove('hidden'); }
          return;
        }

        try {
          const result = await Nawa.Auth.register(data);
          if (result.ok) {
            if (successEl) {
              successEl.textContent = Nawa.I18n.getLang() === 'ar' ? 'تم التسجيل بنجاح! في انتظار الموافقة من المدير العام.' : 'Registration successful! Waiting for super admin approval.';
              successEl.classList.remove('hidden');
            }
            form.reset();
          }
        } catch (err) {
          if (errorEl) { errorEl.textContent = err.message || 'Registration failed'; errorEl.classList.remove('hidden'); }
        }
      });
    }

    const langBtn = document.getElementById('langToggle');
    if (langBtn) {
      langBtn.addEventListener('click', () => {
        if (Nawa.I18n && Nawa.I18n.toggle) { Nawa.I18n.toggle(); this.showRegister(); }
      });
    }
  },

  renderRegisterPage() {
    const isAr = (Nawa.I18n && Nawa.I18n.getLang) ? Nawa.I18n.getLang() === 'ar' : true;
    const langLabel = isAr ? 'English' : 'العربية';

    return `
    <div class="login-page">
      <button id="langToggle" class="btn btn-ghost login-lang-btn-top">${langLabel}</button>
      <div class="login-card" style="max-width:480px;">
        <div class="login-logo">${this.getLogo(64)}</div>
        <h1 class="login-company" style="font-size:24px;">${isAr ? 'تسجيل مطعم جديد' : 'Register Restaurant'}</h1>
        <p class="login-tagline">${isAr ? 'املأ البيانات لتقديم طلب التسجيل' : 'Fill in the details to submit a registration request'}</p>

        <div id="registerError" class="hidden" style="color:#ef4444;text-align:center;margin-bottom:12px;font-size:14px;"></div>
        <div id="registerSuccess" class="hidden" style="color:#22c55e;text-align:center;margin-bottom:12px;font-size:14px;font-weight:600;"></div>

        <form id="registerForm" class="login-form">
          <div class="form-group">
            <label>${isAr ? 'اسم المطعم *' : 'Restaurant Name *'}</label>
            <input type="text" id="regRestaurantName" class="form-input" placeholder="${isAr ? 'اسم المطعم' : 'Restaurant name'}">
          </div>
          <div class="form-group">
            <label>${isAr ? 'اسم صاحب المطعم *' : 'Owner Name *'}</label>
            <input type="text" id="regOwnerName" class="form-input" placeholder="${isAr ? 'الاسم الكامل' : 'Full name'}">
          </div>
          <div class="form-group">
            <label>${isAr ? 'البريد الإلكتروني *' : 'Email *'}</label>
            <input type="email" id="regEmail" class="form-input" placeholder="email@example.com" dir="ltr">
          </div>
          <div class="form-group">
            <label>${isAr ? 'رقم الجوال' : 'Phone'}</label>
            <input type="tel" id="regPhone" class="form-input" placeholder="${isAr ? '05XXXXXXXX' : '05XXXXXXXX'}" dir="ltr">
          </div>
          <div class="form-group">
            <label>${isAr ? 'كلمة المرور *' : 'Password *'}</label>
            <input type="password" id="regPassword" class="form-input" placeholder="${isAr ? '6 أحرف على الأقل' : 'Min 6 characters'}" autocomplete="new-password" dir="ltr">
          </div>
          <button type="submit" class="btn btn-primary btn-xl w-full">${isAr ? 'تقديم طلب التسجيل' : 'Submit Registration'}</button>
          <p style="text-align:center;margin-top:16px;font-size:13px;">
            <a href="#/login" style="color:#C9A84C;text-decoration:none;font-weight:600;">${isAr ? 'العودة لتسجيل الدخول' : 'Back to Login'}</a>
          </p>
        </form>
      </div>
    </div>`;
  },

  _fallbackLogin(username, password) {
    // Fallback: try IndexedDB login directly
    return Nawa.DB.query(Nawa.CONFIG.STORES.EMPLOYEES, 'username', username)
      .then(function (results) {
        var user = results.find(function (u) {
          return u.isActive && !u.deletedAt;
        });
        if (!user) return null;
        if (user.password !== password) return null;
        var session = {
          id: user.id,
          username: user.username,
          role: user.role,
          name: user.name,
          nameEn: user.nameEn,
          loginTime: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
        };
        try { localStorage.setItem('nawa_session', JSON.stringify(session)); } catch (e) {}
        return session;
      });
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

    if (Nawa.Auth && Nawa.Auth.getCurrentUser) {
      session = Nawa.Auth.getCurrentUser();
    }

    if (!session) {
      try {
        const raw = localStorage.getItem('nawa_session');
        if (raw) session = JSON.parse(raw);
      } catch (e) {}
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
    if (Nawa.Auth && Nawa.Auth.logout) Nawa.Auth.logout();
    try { localStorage.removeItem('nawa_session'); } catch (e) {}
    window.location.hash = '#/login';
  },

  renderLoginPage() {
    const t = (Nawa.I18n && Nawa.I18n.t) ? Nawa.I18n.t.bind(Nawa.I18n) : (k) => k;
    const currentLang = (Nawa.I18n && Nawa.I18n.getLang) ? Nawa.I18n.getLang() : 'ar';
    const isAr = currentLang === 'ar';
    const langLabel = isAr ? 'English' : 'العربية';
    const langTitle = isAr ? 'Switch to English' : 'التبديل إلى العربية';
    const tagline = isAr ? 'نظام نقطة البيع للمطاعم' : 'Restaurant Point of Sale System';

    return `
    <div class="login-page">
      <button id="langToggle" class="btn btn-ghost login-lang-btn-top" title="${langTitle}">${langLabel}</button>
      <div class="login-card">
        <div class="login-logo">${this.getLogo(80)}</div>
        <h1 class="login-company">${t('app_name').replace(' POS', '')}</h1>
        <p class="login-tagline">${tagline}</p>

        <div class="login-tabs">
          <button class="login-tab active" data-mode="cashier">${isAr ? 'كاشير' : 'Cashier'}</button>
          <button class="login-tab" data-mode="admin">${isAr ? 'مدير المطعم' : 'Restaurant Admin'}</button>
          <button class="login-tab" data-mode="super">${isAr ? 'مدير عام' : 'Super Admin'}</button>
        </div>

        <div id="loginError" class="hidden" style="color:var(--danger,#ef4444);text-align:center;margin-bottom:12px;font-size:14px;"></div>

        <!-- Cashier: username + password -->
        <form id="cashierForm" class="login-form">
          <div id="cashierFields">
            <div class="form-group">
              <label>${isAr ? 'اسم المستخدم' : 'Username'}</label>
              <input type="text" id="cashierUsername" class="form-input" placeholder="${isAr ? 'أدخل اسم المستخدم' : 'Enter username'}" autocomplete="username" dir="ltr">
            </div>
            <div class="form-group">
              <label>${isAr ? 'كلمة المرور' : 'Password'}</label>
              <input type="password" id="cashierPassword" class="form-input" placeholder="${isAr ? 'أدخل كلمة المرور' : 'Enter password'}" autocomplete="current-password" dir="ltr">
            </div>
            <button type="submit" class="btn btn-primary btn-xl w-full">${isAr ? 'دخول' : 'Sign In'}</button>
          </div>
        </form>

        <!-- Admin: email + password -->
        <form id="adminForm" class="login-form">
          <div id="adminFields" class="hidden">
            <div class="form-group">
              <label>${isAr ? 'البريد الإلكتروني' : 'Email'}</label>
              <input type="email" id="adminEmail" class="form-input" placeholder="${isAr ? 'admin@restaurant.com' : 'admin@restaurant.com'}" autocomplete="email" dir="ltr">
            </div>
            <div class="form-group">
              <label>${isAr ? 'كلمة المرور' : 'Password'}</label>
              <input type="password" id="adminPassword" class="form-input" placeholder="${isAr ? 'أدخل كلمة المرور' : 'Enter password'}" autocomplete="current-password" dir="ltr">
            </div>
            <button type="submit" class="btn btn-primary btn-xl w-full">${isAr ? 'تسجيل الدخول' : 'Login'}</button>
            <p style="text-align:center;margin-top:16px;font-size:13px;">
              <a href="#/register" style="color:#C9A84C;text-decoration:none;font-weight:600;">${isAr ? 'تسجيل مطعم جديد' : 'Register Restaurant'}</a>
            </p>
          </div>
        </form>

        <!-- Super Admin: username + password (env vars) -->
        <form id="superForm" class="login-form">
          <div id="superFields" class="hidden">
            <div class="form-group">
              <label>${isAr ? 'اسم المستخدم' : 'Username'}</label>
              <input type="text" id="superUsername" class="form-input" placeholder="${isAr ? 'اسم المستخدم' : 'Username'}" autocomplete="username" dir="ltr">
            </div>
            <div class="form-group">
              <label>${isAr ? 'كلمة المرور' : 'Password'}</label>
              <input type="password" id="superPassword" class="form-input" placeholder="${isAr ? 'أدخل كلمة المرور' : 'Enter password'}" autocomplete="current-password" dir="ltr">
            </div>
            <button type="submit" class="btn btn-primary btn-xl w-full">${isAr ? 'دخول' : 'Sign In'}</button>
          </div>
        </form>
      </div>
    </div>`;
  },

  getLogo(size) {
    size = size || 80;
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="12" fill="#C9A84C"/>
      <ellipse cx="50" cy="50" rx="35" ry="14" stroke="#C9A84C" stroke-width="2.5" fill="none" transform="rotate(0 50 50)"/>
      <ellipse cx="50" cy="50" rx="35" ry="14" stroke="#D4B76A" stroke-width="2.5" fill="none" transform="rotate(60 50 50)"/>
      <ellipse cx="50" cy="50" rx="35" ry="14" stroke="#B8933A" stroke-width="2.5" fill="none" transform="rotate(120 50 50)"/>
      <circle cx="85" cy="50" r="5" fill="#D4B76A"/>
      <circle cx="32.5" cy="21.7" r="5" fill="#C9A84C"/>
      <circle cx="32.5" cy="78.3" r="5" fill="#B8933A"/>
    </svg>`;
  },

  _renderModulePlaceholder(title, module) {
    const loadingText = (Nawa.I18n.getLang() === 'ar') ? 'قيد التحميل...' : 'Loading...';
    return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#F5F3EE;font-family:Segoe UI,sans-serif;">
      <div style="text-align:center;">
        ${this.getLogo(64)}
        <h2 style="margin-top:20px;color:#0E1C3D;font-size:22px;">${title}</h2>
        <p style="color:#8A8F9B;margin-top:8px;font-size:14px;">${module} - ${loadingText}</p>
        <div style="margin-top:24px;width:48px;height:48px;border:4px solid #E5E3DE;border-top-color:#C9A84C;border-radius:50%;animation:spin .8s linear infinite;margin:24px auto 0;"></div>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    </div>`;
  },

  _showNetworkStatus(status) {
    const existing = document.querySelector('.app-network-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'app-network-toast';

    const t = (Nawa.I18n && Nawa.I18n.t) ? Nawa.I18n.t.bind(Nawa.I18n) : (k) => k;
    const isAr = (Nawa.I18n && Nawa.I18n.getLang) ? Nawa.I18n.getLang() === 'ar' : true;
    const styles = {
      offline: { bg: '#f59e0b', text: isAr ? 'أنت غير متصل بالإنترنت' : 'You are offline' },
      synced: { bg: '#22c55e', text: isAr ? 'تمت المزامنة بنجاح' : 'Sync completed' },
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
      position: relative;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0E1C3D 0%, #162B55 50%, #0E1C3D 100%);
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
      color: #C9A84C;
      margin: 0;
      letter-spacing: -.5px;
    }

    .login-tagline {
      font-size: 14px;
      color: #8A8F9B;
      margin: 6px 0 32px;
    }

    .login-form {
      text-align: start;
    }

    .login-form .form-group {
      margin-bottom: 18px;
    }

    .login-form .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #1A1A1A;
      margin-bottom: 6px;
    }

    .login-form .form-input {
      width: 100%;
      padding: 12px 16px;
      border: 1.5px solid #E5E3DE;
      border-radius: 10px;
      font-size: 15px;
      font-family: inherit;
      transition: all .2s;
      background: #FAF9F7;
    }

    .login-form .form-input:focus {
      outline: none;
      border-color: #C9A84C;
      box-shadow: 0 0 0 3px rgba(201,168,76,.12);
      background: #fff;
    }

    .login-form .form-input::placeholder {
      color: #A5A9B3;
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
      background: #0E1C3D;
      color: #fff;
    }

    .btn-primary:hover {
      background: #162B55;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(14,28,61,.3);
    }

    .btn-ghost {
      background: transparent;
      color: #8A8F9B;
      border: 1.5px solid #E5E3DE;
    }

    .btn-ghost:hover {
      border-color: #C9A84C;
      color: #C9A84C;
    }

    .btn-xl {
      padding: 14px 24px;
      font-size: 16px;
    }

    .w-full { width: 100%; }

    .hidden { display: none !important; }

    .login-lang-btn-top {
      position: absolute;
      top: 20px;
      inset-inline-end: 20px;
      font-size: 13px;
      font-weight: 600;
      padding: 8px 18px;
      border-radius: 8px;
      background: #F5F3EE;
      color: #8A8F9B;
      border: 1.5px solid #E5E3DE;
      transition: all 0.2s;
      z-index: 10;
    }

    .login-lang-btn-top:hover {
      background: #C9A84C;
      color: #0E1C3D;
      border-color: #C9A84C;
    }

    .login-footer {
      margin-top: 24px;
      font-size: 11px;
      color: #A5A9B3;
    }

    .login-tabs {
      display: flex;
      gap: 0;
      margin-bottom: 24px;
      border: 1.5px solid #E5E3DE;
      border-radius: 10px;
      overflow: hidden;
    }

    .login-tab {
      flex: 1;
      padding: 10px 8px;
      font-size: 13px;
      font-weight: 600;
      border: none;
      background: #FAF9F7;
      color: #8A8F9B;
      cursor: pointer;
      transition: all .2s;
      font-family: inherit;
    }

    .login-tab:not(:last-child) {
      border-inline-end: 1px solid #E5E3DE;
    }

    .login-tab.active {
      background: #0E1C3D;
      color: #fff;
    }

    .login-tab:hover:not(.active) {
      background: #F0EDE8;
      color: #1A1A1A;
    }
  `;
  document.head.appendChild(style);
})();


/* ========================================================
   Bootstrap
   ======================================================== */

document.addEventListener('DOMContentLoaded', () => App.init());
