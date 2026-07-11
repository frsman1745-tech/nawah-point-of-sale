(function () {
  var SESSION_KEY = 'nawa_session';
  var SESSION_EXPIRY_MS = 8 * 60 * 60 * 1000;
  var API_BASE = (window.Nawa && window.Nawa.CONFIG) ? window.Nawa.CONFIG.API_BASE : '/api';

  function getNow() { return new Date().toISOString(); }

  function saveSession(data) {
    var session = {
      id: data.id || data.user?.id,
      name: data.name || data.user?.name,
      nameEn: data.nameEn || data.user?.nameEn,
      username: data.username || data.user?.username,
      role: data.role || data.user?.role,
      restaurantId: data.restaurantId || data.user?.restaurantId,
      token: data.token,
      loginAt: getNow(),
      expiresAt: new Date(Date.now() + SESSION_EXPIRY_MS).toISOString()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  var Auth = {
    login: function (username, password) {
      // Try API login first
      return fetch(API_BASE + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      })
      .then(function (res) {
        if (!res.ok) {
          // Fallback to IndexedDB login
          return Auth._fallbackLogin(username, password);
        }
        return res.json();
      })
      .then(function (data) {
        if (!data) return null;
        if (data.token) {
          // API login success
          var session = saveSession(data);
          Auth._logAudit('login', 'employees', session.id, { username: username });
          return session;
        }
        // Fallback login result
        if (data && data.role) {
          var session = saveSession(data);
          Auth._logAudit('login', 'employees', session.id, { username: username });
          return session;
        }
        return null;
      })
      .catch(function (e) {
        console.warn('API login failed, using fallback:', e.message);
        return Auth._fallbackLogin(username, password);
      });
    },

    _fallbackLogin: function (username, password) {
      return window.Nawa.DB.query(window.Nawa.CONFIG.STORES.EMPLOYEES, 'username', username)
        .then(function (results) {
          var user = results.find(function (u) {
            return u.isActive && !u.deletedAt;
          });
          if (!user) return null;
          if (user.password !== password) return null;
          return saveSession(user);
        });
    },

    _logAudit: function (action, store, recordId, data) {
      try {
        var session = Auth.getCurrentUser();
        var token = session ? session.token : null;
        if (!token) return;

        // Try API audit log
        fetch(API_BASE + '/audit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({
            userId: session.id,
            userName: session.name,
            action: action,
            store: store,
            recordId: recordId,
            data: data,
            timestamp: new Date().toISOString()
          })
        }).catch(function () {});
      } catch (e) {}
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

    // API helper with auth token
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
