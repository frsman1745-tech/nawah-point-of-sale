(function () {
  var SESSION_KEY = 'nawa_session';
  var SESSION_EXPIRY_MS = 8 * 60 * 60 * 1000;

  function getNow() { return new Date().toISOString(); }
  function tsMs(d) { return new Date(d).getTime(); }

  function saveSession(user) {
    var session = {
      id: user.id,
      name: user.name,
      nameEn: user.nameEn,
      username: user.username,
      role: user.role,
      loginAt: getNow(),
      expiresAt: new Date(Date.now() + SESSION_EXPIRY_MS).toISOString()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  var Auth = {
    login: function (username, password) {
      return window.Nawa.DB.query(window.Nawa.CONFIG.STORES.EMPLOYEES, 'username', username)
        .then(function (results) {
          var user = results.find(function (u) {
            return u.isActive && !u.deletedAt;
          });
          if (!user) return null;
          if (user.password !== password) return null;
          var session = saveSession(user);
          if (window.Nawa.Audit) {
            window.Nawa.Audit.log('login', 'employees', user.id, { username: user.username });
          }
          return session;
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
    }
  };

  window.Nawa = window.Nawa || {};
  window.Nawa.Auth = Auth;
})();
