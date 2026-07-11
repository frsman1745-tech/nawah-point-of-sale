(function () {
  var SESSION_KEY = 'nawa_session';
  var SESSION_EXPIRY_MS = 8 * 60 * 60 * 1000;
  var ADMIN_SESSION_EXPIRY_MS = 720 * 60 * 60 * 1000; // 30 days
  var API_BASE = (window.Nawa && window.Nawa.CONFIG) ? window.Nawa.CONFIG.API_BASE : '/api';

  function getNow() { return new Date().toISOString(); }

  function saveSession(data, role) {
    var expiryMs = role === 'admin' ? ADMIN_SESSION_EXPIRY_MS : SESSION_EXPIRY_MS;
    var session = {
      id: data.id || data.user?.id,
      name: data.name || data.user?.name,
      nameEn: data.nameEn || data.user?.nameEn,
      username: data.username || data.user?.username,
      email: data.email || data.user?.email,
      role: data.role || data.user?.role,
      restaurantId: data.restaurantId || data.user?.restaurantId,
      token: data.token,
      loginAt: getNow(),
      expiresAt: new Date(Date.now() + expiryMs).toISOString()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  var Auth = {
    // Super Admin login (env vars on server)
    superLogin: function (username, password) {
      return fetch(API_BASE + '/auth/super-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'Login failed'); });
        return res.json();
      })
      .then(function (data) {
        return saveSession(data, 'super_admin');
      });
    },

    // Admin login (email + password)
    adminLogin: function (email, password) {
      return fetch(API_BASE + '/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password })
      })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'Login failed'); });
        return res.json();
      })
      .then(function (data) {
        return saveSession(data, 'admin');
      });
    },

    // Cashier login (password only)
    cashierLogin: function (password) {
      return fetch(API_BASE + '/auth/cashier-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password })
      })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'Login failed'); });
        return res.json();
      })
      .then(function (data) {
        return saveSession(data, 'cashier');
      });
    },

    // Legacy login
    login: function (username, password) {
      return fetch(API_BASE + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'Login failed'); });
        return res.json();
      })
      .then(function (data) {
        return saveSession(data);
      })
      .catch(function (e) {
        console.warn('API login failed:', e.message);
        return null;
      });
    },

    // Register new restaurant
    register: function (data) {
      return fetch(API_BASE + '/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      .then(function (res) {
        return res.json().then(function (d) {
          if (!res.ok) throw new Error(d.error || 'Registration failed');
          return d;
        });
      });
    },

    logout: function () {
      var session = this.getCurrentUser();
      if (session && window.Nawa.Audit) {
        window.Nawa.Audit.log('logout', 'employees', session.id, { username: session.username });
      }
      localStorage.removeItem(SESSION_KEY);
    },

    getCurrentUser: function () {
      try {
        var raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        var session = JSON.parse(raw);
        if (new Date(session.expiresAt).getTime() < Date.now()) {
          localStorage.removeItem(SESSION_KEY);
          return null;
        }
        return session;
      } catch (e) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
    },

    getToken: function () {
      var session = this.getCurrentUser();
      return session ? session.token : null;
    },

    isLoggedIn: function () {
      return this.getCurrentUser() !== null;
    },

    requireAuth: function (role) {
      var user = this.getCurrentUser();
      if (!user) {
        window.location.hash = '#/login';
        return null;
      }
      if (role && user.role !== role) {
        window.location.hash = '#/login';
        return null;
      }
      return user;
    },

    apiFetch: function (path, options) {
      var token = this.getToken();
      var headers = (options && options.headers) || {};
      if (token) headers['Authorization'] = 'Bearer ' + token;
      if (options && options.body && typeof options.body === 'object') {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
      }
      return fetch(API_BASE + path, Object.assign({}, options, { headers: headers }));
    }
  };

  window.Nawa = window.Nawa || {};
  window.Nawa.Auth = Auth;
})();
