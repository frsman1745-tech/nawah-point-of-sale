(function () {
  var CFG = window.Nawa.CONFIG;
  var STORE = CFG.STORES.AUDIT_LOG;

  function bufToHex(buf) {
    return Array.from(new Uint8Array(buf))
      .map(function (b) { return b.toString(16).padStart(2, '0'); })
      .join('');
  }

  function sha256(str) {
    var enc = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', enc).then(bufToHex);
  }

  var Audit = {
    log: function (action, store, recordId, data) {
      var dbMod = window.Nawa.DB;
      var authMod = window.Nawa.Auth;
      var user = authMod ? authMod.getCurrentUser() : null;
      var timestamp = new Date().toISOString();

      return dbMod.getAll(STORE).then(function (entries) {
        var prevHash = entries.length > 0 ? entries[entries.length - 1].hash : '0000000000000000000000000000000000000000000000000000000000000000';
        var payload = prevHash + timestamp + (user ? user.id : 'system') + action + JSON.stringify(data || {});
        return sha256(payload).then(function (hash) {
          var entry = {
            id: undefined,
            timestamp: timestamp,
            userId: user ? user.id : 'system',
            userName: user ? user.name : 'system',
            action: action,
            store: store,
            recordId: recordId || '',
            data: data || {},
            hash: hash,
            previousHash: prevHash
          };
          return dbMod.add(STORE, entry);
        });
      });
    },

    getHistory: function (store, recordId) {
      return window.Nawa.DB.getAll(STORE).then(function (entries) {
        return entries.filter(function (e) {
          return e.store === store && e.recordId === recordId && !e.deletedAt;
        }).sort(function (a, b) {
          return new Date(a.timestamp) - new Date(b.timestamp);
        });
      });
    },

    getAll: function (filters) {
      return window.Nawa.DB.getAll(STORE).then(function (entries) {
        var result = entries.filter(function (e) { return !e.deletedAt; });
        if (!filters) return result;
        return result.filter(function (e) {
          if (filters.dateFrom && e.timestamp < filters.dateFrom) return false;
          if (filters.dateTo && e.timestamp > filters.dateTo) return false;
          if (filters.userId && e.userId !== filters.userId) return false;
          if (filters.action && e.action !== filters.action) return false;
          if (filters.store && e.store !== filters.store) return false;
          return true;
        });
      });
    },

    verify: function () {
      return window.Nawa.DB.getAll(STORE).then(function (entries) {
        var sorted = entries.filter(function (e) { return !e.deletedAt; })
          .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });

        if (sorted.length === 0) return Promise.resolve(true);

        var chain = Promise.resolve(true);
        var prevExpected = '0000000000000000000000000000000000000000000000000000000000000000';

        for (var i = 0; i < sorted.length; i++) {
          (function (idx, expectedPrev) {
            chain = chain.then(function (validSoFar) {
              if (!validSoFar) return false;
              var e = sorted[idx];
              if (e.previousHash !== expectedPrev) return false;
              var payload = e.previousHash + e.timestamp + e.userId + e.action + JSON.stringify(e.data || {});
              return sha256(payload).then(function (computed) {
                return computed === e.hash;
              });
            });
          })(i, prevExpected);
          prevExpected = sorted[i].hash;
        }

        return chain;
      });
    },

    export: function () {
      return this.getAll().then(function (entries) {
        var header = 'ID,Timestamp,User ID,User Name,Action,Store,Record ID,Hash,Previous Hash,Data';
        var rows = entries.map(function (e) {
          return [
            e.id,
            e.timestamp,
            e.userId,
            '"' + (e.userName || '').replace(/"/g, '""') + '"',
            e.action,
            e.store,
            e.recordId,
            e.hash,
            e.previousHash,
            '"' + JSON.stringify(e.data || {}).replace(/"/g, '""') + '"'
          ].join(',');
        });
        return header + '\n' + rows.join('\n');
      });
    }
  };

  window.Nawa = window.Nawa || {};
  window.Nawa.Audit = Audit;
})();
