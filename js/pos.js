var Nawa = window.Nawa || {};

Nawa.POS = {
  state: {
    cart: [],
    currentTable: null,
    currentFloor: null,
    currentCategory: null,
    searchQuery: '',
    employee: null,
    floors: [],
    tables: [],
    products: [],
    categories: [],
    attendanceRecord: null,
    orderNote: '',
    orders: [],
    parallelOrders: [],
    activeOrderIdx: -1,
    splitMode: null,
    splitParts: [],
    splitPaid: 0,
    currentCustomer: null,
    discount: null,
    discountPresets: []
  },

  TAX_RATE: 0,
  _syncTimer: null,
  _searchDebounce: null,
  _listenersAttached: false,

  // ===========================
  // INITIALIZATION
  // ===========================
  async init() {
    const root = document.getElementById('app');
    if (root) {
      root.innerHTML = `
        <div class="pos-loading" style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;">
          <div class="spinner spinner-lg"></div>
          <span style="color:var(--text-secondary);font-size:0.9375rem;">${Nawa.I18n.t('loading')}</span>
        </div>`;
    }

    try {
      this.state.employee = Nawa.Auth.getCurrentUser();
    } catch (e) {
      this.state.employee = null;
    }

    await Promise.all([
      this._loadFloors(),
      this._loadTables(),
      this._loadProducts(),
      this._loadCategories(),
      this._loadOrders(),
      this._loadDiscountPresets(),
      this._loadSettings()
    ]);

    await this._syncFromServer();

    await this._checkAttendance();

    if (this.state.floors.length > 0 && !this.state.currentFloor) {
      this.state.currentFloor = this.state.floors[0].id;
    }

    this.render();
    this._setupEventListeners();
    this._startSyncTimer();
  },

  async _loadFloors() {
    try {
      this.state.floors = await Nawa.DB.getAll(Nawa.CONFIG.STORES.FLOORS) || [];
    } catch (e) {
      this.state.floors = [];
    }
  },

  async _loadTables() {
    try {
      this.state.tables = await Nawa.DB.getAll(Nawa.CONFIG.STORES.TABLES) || [];
    } catch (e) {
      this.state.tables = [];
    }
  },

  async _loadProducts() {
    try {
      this.state.products = await Nawa.DB.getAll(Nawa.CONFIG.STORES.PRODUCTS) || [];
    } catch (e) {
      this.state.products = [];
    }
  },

  async _loadCategories() {
    try {
      this.state.categories = await Nawa.DB.getAll(Nawa.CONFIG.STORES.CATEGORIES) || [];
    } catch (e) {
      this.state.categories = [];
    }
  },

  async _loadOrders() {
    try {
      this.state.orders = await Nawa.DB.getAll(Nawa.CONFIG.STORES.ORDERS) || [];
    } catch (e) {
      this.state.orders = [];
    }
  },

  async _loadDiscountPresets() {
    try {
      const res = await Nawa.Auth.apiFetch('/discounts');
      if (res.ok) {
        this.state.discountPresets = await res.json();
      } else {
        this.state.discountPresets = [];
      }
    } catch (e) {
      this.state.discountPresets = [];
    }
  },

  async _loadSettings() {
    try {
      var settingsArr = await Nawa.DB.getAll(Nawa.CONFIG.STORES.SETTINGS) || [];
      var settings = {};
      settingsArr.forEach(function (s) { settings[s.key] = s.value; });
      try {
        var res = await Nawa.Auth.apiFetch('/settings');
        if (res.ok) {
          var serverSettings = await res.json();
          serverSettings.forEach(function (s) { settings[s.key] = s.value; });
          for (var i = 0; i < serverSettings.length; i++) {
            var existing = settingsArr.find(function (x) { return x.key === serverSettings[i].key; });
            if (existing) {
              await Nawa.DB.update(Nawa.CONFIG.STORES.SETTINGS, existing.id, { value: serverSettings[i].value });
            } else {
              await Nawa.DB.add(Nawa.CONFIG.STORES.SETTINGS, { key: serverSettings[i].key, value: serverSettings[i].value });
            }
          }
        }
      } catch (e) {}
      this.state.settings = settings;
      var taxRate = parseFloat(settings.taxRate);
      if (!isNaN(taxRate) && taxRate >= 0 && taxRate <= 100) {
        this.TAX_RATE = taxRate / 100;
      }
    } catch (e) {
      this.state.settings = {};
    }
  },

  async _syncFromServer() {
    if (!Nawa.Auth || !Nawa.Auth.apiFetch) return;
    var self = this;
    var DB = Nawa.DB;
    var S = Nawa.CONFIG.STORES;

    try {
      var res = await Nawa.Auth.apiFetch('/products');
      if (res.ok) {
        var serverProducts = await res.json();
        if (serverProducts.length > 0) {
          self.state.products = serverProducts.map(function (p) {
            return { id: p.id, name: p.name, nameEn: p.nameEn, price: p.price, barcode: p.barcode, categoryId: p.categoryId, notes: p.notes, active: p.active };
          });
          await DB.clear(S.PRODUCTS);
          for (var i = 0; i < self.state.products.length; i++) {
            try { await DB.add(S.PRODUCTS, self.state.products[i]); } catch (e) {}
          }
        }
      }
    } catch (e) {}

    try {
      var res = await Nawa.Auth.apiFetch('/categories');
      if (res.ok) {
        var serverCats = await res.json();
        if (serverCats.length > 0) {
          self.state.categories = serverCats.map(function (c) {
            return { id: c.id, name: c.name, sortOrder: c.sortOrder };
          });
          await DB.clear(S.CATEGORIES);
          for (var i = 0; i < self.state.categories.length; i++) {
            try { await DB.add(S.CATEGORIES, self.state.categories[i]); } catch (e) {}
          }
        }
      }
    } catch (e) {}

    try {
      var res = await Nawa.Auth.apiFetch('/tables');
      if (res.ok) {
        var serverTables = await res.json();
        if (serverTables.length > 0) {
          self.state.tables = serverTables.map(function (t) {
            return { id: t.id, number: t.number, name: t.name, seats: t.seats, floorId: t.floorId, shape: t.shape || 'square', status: t.status };
          });
          await DB.clear(S.TABLES);
          for (var i = 0; i < self.state.tables.length; i++) {
            try { await DB.add(S.TABLES, self.state.tables[i]); } catch (e) {}
          }
        }
      }
    } catch (e) {}

    try {
      var res = await Nawa.Auth.apiFetch('/floors');
      if (res.ok) {
        var serverFloors = await res.json();
        if (serverFloors.length > 0) {
          self.state.floors = serverFloors.map(function (f) {
            return { id: f.id, name: f.name, sortOrder: f.sortOrder };
          });
          await DB.clear(S.FLOORS);
          for (var i = 0; i < self.state.floors.length; i++) {
            try { await DB.add(S.FLOORS, self.state.floors[i]); } catch (e) {}
          }
        }
      }
    } catch (e) {}

    try {
      var res = await Nawa.Auth.apiFetch('/discounts');
      if (res.ok) {
        var serverDiscounts = await res.json();
        self.state.discountPresets = serverDiscounts.filter(function (d) { return d.active !== false; });
      }
    } catch (e) {}

    try {
      var res = await Nawa.Auth.apiFetch('/settings');
      if (res.ok) {
        var serverSettings = await res.json();
        serverSettings.forEach(function (s) { self.state.settings[s.key] = s.value; });
        var taxRate = parseFloat(self.state.settings.taxRate);
        if (!isNaN(taxRate) && taxRate >= 0 && taxRate <= 100) {
          self.TAX_RATE = taxRate / 100;
        }
      }
    } catch (e) {}
  },

  async _checkAttendance() {
    this.state.attendanceRecord = null;
    if (!Nawa.Auth || !Nawa.Auth.apiFetch) return;
    try {
      var res = await Nawa.Auth.apiFetch('/attendance/today');
      if (res.ok) {
        var data = await res.json();
        var rec = Array.isArray(data) ? data.find(function (a) { return !a.clockOut; }) || data[0] || null : data;
        this.state.attendanceRecord = rec;
      }
    } catch (e) {}
  },

  async _clockIn() {
    if (!Nawa.Auth || !Nawa.Auth.apiFetch) return;
    var isAr = Nawa.I18n.getLang() === 'ar';
    var balanceStr = prompt(isAr ? 'الرصيد الافتتاحي للصندوق (ل.س):' : 'Opening cash balance (SYP):', '0');
    if (balanceStr === null) return;
    var balance = parseFloat(balanceStr) || 0;
    try {
      var res = await Nawa.Auth.apiFetch('/attendance/clock-in', { method: 'POST' });
      if (res.ok) {
        var data = await res.json();
        this.state.attendanceRecord = data;
        try {
          await Nawa.Auth.apiFetch('/cash-drawer/open', { method: 'POST', body: JSON.stringify({ openingBalance: balance }) });
        } catch (e) {}
        this.render();
        this._showToast(Nawa.I18n.t('clock_in_success'), 'success');
      } else {
        var err = await res.json().catch(function () { return {}; });
        this._showToast(err.error || Nawa.I18n.t('error_generic'), 'error');
      }
    } catch (e) {
      this._showToast(Nawa.I18n.t('error_generic'), 'error');
    }
  },

  async _clockOut() {
    if (!Nawa.Auth || !Nawa.Auth.apiFetch) return;
    var isAr = Nawa.I18n.getLang() === 'ar';
    if (!confirm(isAr ? 'هل تريد تسجيل الانصراف وتسجيل الخروج؟' : 'Clock out and sign out?')) return;
    try {
      var drawerRes = await Nawa.Auth.apiFetch('/cash-drawer/today');
      var drawer = drawerRes && drawerRes.id ? drawerRes : null;
      if (drawer) {
        var countStr = prompt(isAr ? 'المبلغ الفعلي في الصندوق (ل.س):' : 'Actual cash in drawer (SYP):', drawer.expectedBalance || '0');
        if (countStr === null) return;
        await Nawa.Auth.apiFetch('/cash-drawer/close', { method: 'PUT', body: JSON.stringify({ closingBalance: parseFloat(countStr) || 0 }) });
        var diff = (parseFloat(countStr) || 0) - (drawer.expectedBalance || 0);
        this._showToast(isAr ? 'الفرق: ' + diff.toLocaleString() + ' ل.س' : 'Difference: ' + diff.toLocaleString() + ' SYP', diff === 0 ? 'success' : 'warning');
      }
      if (this.state.attendanceRecord && this.state.attendanceRecord.id) {
        await Nawa.Auth.apiFetch('/attendance/' + this.state.attendanceRecord.id + '/clock-out', { method: 'PUT' }).catch(function () {});
      }
      this._showToast(Nawa.I18n.t('clock_out_success'), 'success');
      setTimeout(function () {
        Nawa.Auth.logout();
        window.location.hash = '#/login';
      }, 1500);
    } catch (e) {
      Nawa.Auth.logout();
      window.location.hash = '#/login';
    }
  },

  logout() {
    var isAr = Nawa.I18n.getLang() === 'ar';
    if (!confirm(isAr ? 'هل تريد تسجيل الخروج؟' : 'Are you sure you want to logout?')) return;
    Nawa.Auth.logout();
    window.location.hash = '#/login';
  },

  _showToast(message, type) {
    var toast = document.createElement('div');
    toast.className = 'pos-toast pos-toast-' + (type || 'info');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.classList.add('show'); }, 10);
    setTimeout(function () { toast.classList.remove('show'); setTimeout(function () { toast.remove(); }, 300); }, 3000);
  },

  _renderAttendanceBtn() {
    var rec = this.state.attendanceRecord;
    var t = Nawa.I18n.t;
    var isAr = Nawa.I18n.getLang() === 'ar';
    var time = '';
    if (rec && rec.clockIn) {
      time = new Date(rec.clockIn).toLocaleTimeString(isAr ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' });
    }
    if (rec && !rec.clockOut) {
      return '<div style="display:flex;align-items:center;gap:6px;margin-left:8px;">' +
        '<span style="font-size:0.75rem;color:#22c55e;font-weight:600;display:flex;align-items:center;gap:4px;">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
          t('clocked_in_at') + ' ' + time +
        '</span>' +
        '<button onclick="Nawa.POS._clockOut()" style="background:#dc2626;color:#fff;border:none;padding:5px 14px;border-radius:8px;font-size:0.8125rem;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
          t('clock_out') +
        '</button>' +
      '</div>';
    }
    return '<button onclick="Nawa.POS._clockIn()" style="background:#16a34a;color:#fff;border:none;padding:5px 14px;border-radius:8px;font-size:0.8125rem;font-weight:600;cursor:pointer;margin-left:8px;display:flex;align-items:center;gap:4px;">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
      t('clock_in') +
    '</button>';
  },

  // ===========================
  // RENDERING
  // ===========================
  render() {
    const root = document.getElementById('app');
    if (!root) return;

    const lang = Nawa.I18n.getLang();
    document.body.dir = lang === 'ar' ? 'rtl' : 'ltr';

    root.innerHTML = `
      <div class="pos-layout">
        ${this.renderHeader()}
        ${this._renderOrderTabs()}
        <div class="pos-body">
          <div class="pos-products-panel">
            ${this.renderCategories()}
            ${this.renderQuickFire()}
            <div class="pos-search-bar">
              <input type="text" class="form-input pos-search-input" placeholder="${Nawa.I18n.t('search')}" value="${this._escapeHtml(this.state.searchQuery)}" />
            </div>
            <div class="pos-product-grid" id="pos-product-grid">
              ${this.renderProducts()}
            </div>
          </div>
          <div class="pos-cart-panel">
            ${this.renderCart()}
          </div>
        </div>
        ${this.renderFloorTabs()}
      </div>
      <div id="pos-table-modal" class="modal-overlay hidden">
        ${this.renderTableModal()}
      </div>
      <div id="pos-payment-modal" class="modal-overlay hidden"></div>
      <div id="pos-receipt-modal" class="modal-overlay hidden"></div>
      <div id="pos-hold-modal" class="modal-overlay hidden"></div>
      <div id="pos-history-modal" class="modal-overlay hidden"></div>
      <div id="pos-customer-modal" class="modal-overlay hidden"></div>
      <div id="pos-discount-modal" class="modal-overlay hidden"></div>
    `;
  },

  renderHeader() {
    const emp = this.state.employee;
    const tableName = this.state.currentTable
      ? this._getTableLabel(this.state.currentTable)
      : Nawa.I18n.t('table');
    const customer = this.state.currentCustomer;
    const lang = Nawa.I18n.getLang();

    const customerLabel = customer
      ? this._escapeHtml(customer.name) + (customer.points ? ' <span style="color:#C9A84C;font-size:0.7rem;">' + customer.points + ' pts</span>' : '')
      : Nawa.I18n.t('no_customer');
    const customerClass = customer ? ' pos-customer-selected' : '';

    return `
      <header class="pos-header">
        <div class="pos-header-right">
          <div class="pos-logo">
            <span class="pos-logo-text">${Nawa.CONFIG.APP_NAME}</span>
          </div>
          <button class="btn btn-ghost pos-table-btn" id="pos-select-table">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            <span>${tableName}</span>
          </button>
          <button class="btn btn-ghost pos-customer-btn${customerClass}" id="pos-select-customer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span>${customerLabel}</span>
          </button>
          <button class="btn btn-ghost pos-history-btn" id="pos-order-history-btn" style="display:flex;align-items:center;gap:6px;padding:8px 14px;font-size:0.8125rem;font-weight:600;border-radius:8px;" title="${Nawa.I18n.t('order_history')}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <span>${Nawa.I18n.t('order_history')}</span>
          </button>
          <button class="btn btn-ghost" onclick="window.location.hash='#/kds'" style="display:flex;align-items:center;gap:6px;padding:8px 14px;font-size:0.8125rem;font-weight:600;border-radius:8px;" title="${Nawa.I18n.t('kitchen_display')}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            <span>${Nawa.I18n.t('kitchen_display')}</span>
          </button>
        </div>
        <div class="pos-header-left">
          <span class="pos-employee-name">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            ${emp ? this._escapeHtml(emp.name || emp.username || '') : ''}
          </span>
          ${this._renderAttendanceBtn()}
          <button onclick="Nawa.POS.logout()" style="background:#dc2626;color:#fff;border:none;padding:5px 14px;border-radius:8px;font-size:0.8125rem;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;" title="${Nawa.I18n.t('logout')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            ${Nawa.I18n.t('logout')}
          </button>
          <button class="btn btn-ghost btn-icon" id="pos-lang-toggle" title="${Nawa.I18n.t('language')}">
            ${lang === 'ar' ? 'EN' : 'عربي'}
          </button>
          <input type="text" id="pos-barcode-input" placeholder="${Nawa.I18n.getLang() === 'ar' ? 'مسح الباركود' : 'Scan barcode'}" style="width:140px;padding:5px 10px;border:1px solid var(--border,#E5E7EB);border-radius:6px;font-size:0.8125rem;background:var(--bg-secondary);color:var(--text-primary);direction:ltr;text-align:center;" autocomplete="off">
          <div class="pos-sync-indicator" id="pos-sync-indicator" title="${Nawa.I18n.t('status')}">
            <span class="pos-sync-dot"></span>
          </div>
        </div>
      </header>`;
  },

  renderQuickFire() {
    var html = '';
    try {
      var orders = this.state.orders;
      var freq = {};
      for (var i = 0; i < orders.length; i++) {
        var items = orders[i].items || [];
        for (var j = 0; j < items.length; j++) {
          var pid = items[j].productId;
          if (!pid) continue;
          freq[pid] = (freq[pid] || 0) + items[j].quantity;
        }
      }
      var sorted = Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; }).slice(0, 6);
      if (sorted.length === 0) return '';
      var products = this.state.products;
      var buttons = [];
      for (var k = 0; k < sorted.length; k++) {
        var product = products.find(function (p) { return String(p.id) === String(sorted[k]); });
        if (!product) continue;
        var name = Nawa.I18n.getLang() === 'ar' ? (product.name || product.nameEn) : (product.nameEn || product.name);
        buttons.push('<button class="pos-quickfire-btn" data-product-id="' + product.id + '" style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px 14px;border-radius:10px;border:1px solid var(--border);background:var(--bg-secondary);cursor:pointer;min-width:90px;gap:4px;"><span style="font-size:0.8125rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px;">' + this._escapeHtml(name) + '</span><span style="font-size:0.75rem;color:var(--text-secondary);">' + this.formatPrice(product.price) + '</span></button>');
      }
      if (buttons.length > 0) {
        html = '<div style="padding:4px 0;"><div style="font-size:0.75rem;font-weight:600;color:var(--text-secondary);padding:0 12px 4px;">' + Nawa.I18n.t('quick_fire') + '</div><div style="display:flex;gap:8px;overflow-x:auto;padding:0 12px 8px;">' + buttons.join('') + '</div></div>';
      }
    } catch (e) {}
    return html;
  },

  renderCategories() {
    const cats = this.state.categories;
    const currentCat = this.state.currentCategory;

    const allActive = !currentCat ? 'active' : '';
    const pills = cats.map(cat => {
      const active = currentCat === cat.id ? 'active' : '';
      const label = Nawa.I18n.getLang() === 'ar' ? (cat.name || cat.nameEn) : (cat.nameEn || cat.name);
      return `<button class="pos-cat-pill ${active}" data-category-id="${cat.id}">${this._escapeHtml(label)}</button>`;
    }).join('');

    return `
      <div class="pos-categories" id="pos-categories">
        <div class="pos-categories-scroll">
          <button class="pos-cat-pill ${allActive}" data-category-id="">${Nawa.I18n.t('all')}</button>
          ${pills}
        </div>
      </div>`;
  },

  renderProducts() {
    let products = this._getFilteredProducts();

    if (products.length === 0) {
      return `<div class="pos-products-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <span>${Nawa.I18n.t('no_data')}</span>
      </div>`;
    }

    return products.map(product => {
      const name = Nawa.I18n.getLang() === 'ar' ? (product.name || product.nameEn) : (product.nameEn || product.name);
      const emoji = product.emoji || product.image || '';
      const hasImage = emoji && (emoji.startsWith('http') || emoji.startsWith('/') || emoji.startsWith('data:'));
      const display = hasImage
        ? `<img src="${this._escapeHtml(emoji)}" alt="" class="pos-product-img" />`
        : `<span class="pos-product-emoji">${emoji || '📦'}</span>`;

      return `
        <div class="pos-product-card" data-product-id="${product.id}">
          <div class="pos-product-thumb">${display}</div>
          <div class="pos-product-info">
            <span class="pos-product-name">${this._escapeHtml(name)}</span>
            <span class="pos-product-price">${this.formatPrice(product.price)}</span>
          </div>
        </div>`;
    }).join('');
  },

  renderCart() {
    const cart = this.state.cart;
    const table = this.state.currentTable;
    const tableName = table ? this._getTableLabel(table) : Nawa.I18n.t('table');
    const { subtotal, tax, total } = this.getCartTotal();
    const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

    const items = cart.map((item, index) => {
      const name = Nawa.I18n.getLang() === 'ar' ? (item.name || item.nameEn) : (item.nameEn || item.name);
      const noteDisplay = item.notes ? `<span class="pos-cart-item-notes">${this._escapeHtml(item.notes)}</span>` : '';
      return `
        <div class="pos-cart-item" data-cart-index="${index}">
          <div class="pos-cart-item-info">
            <span class="pos-cart-item-name">${this._escapeHtml(name)}</span>
            <span class="pos-cart-item-unit-price">${this.formatPrice(item.price)}</span>
            ${noteDisplay}
          </div>
          <div class="pos-cart-item-controls">
            <button class="pos-qty-btn pos-qty-minus" data-action="minus" data-index="${index}">−</button>
            <span class="pos-qty-value">${item.quantity}</span>
            <button class="pos-qty-btn pos-qty-plus" data-action="plus" data-index="${index}">+</button>
          </div>
          <div class="pos-cart-item-subtotal">${this.formatPrice(item.subtotal)}</div>
          <div class="pos-cart-item-actions">
            <button class="pos-cart-item-note-btn${item.notes ? ' has-note' : ''}" data-action="item-note" data-index="${index}" title="${Nawa.I18n.t('item_note')}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button class="pos-cart-item-remove" data-action="remove" data-index="${index}" title="${Nawa.I18n.t('delete')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        </div>`;
    }).join('');

    const cartItemsHtml = cart.length === 0
      ? `<div class="pos-cart-empty">
           <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
           <span>${Nawa.I18n.t('cart_empty')}</span>
         </div>`
      : items;

    return `
      <div class="pos-cart">
        <div class="pos-cart-header">
          <h3 class="pos-cart-title">${Nawa.I18n.t('current_order')}</h3>
          <span class="pos-cart-table-label">${tableName}</span>
          <span class="pos-cart-count badge badge-info">${cartCount}</span>
        </div>
        <div class="pos-cart-items" id="pos-cart-items">
          ${cartItemsHtml}
        </div>
        <div class="pos-order-note" style="padding:0 12px;">
          <textarea class="form-input pos-note-input" placeholder="${Nawa.I18n.t('order_note_placeholder')}" rows="2" style="resize:none;font-size:0.8125rem;">${this._escapeHtml(this.state.orderNote)}</textarea>
        </div>
        <div class="pos-cart-summary">
          <div class="pos-cart-row">
            <span>${Nawa.I18n.t('subtotal')}</span>
            <span id="pos-subtotal">${this.formatPrice(subtotal)}</span>
          </div>
          <div class="pos-cart-row">
            <span>${Nawa.I18n.t('tax')} (${Math.round(this.TAX_RATE * 100)}%)</span>
            <span id="pos-tax">${this.formatPrice(tax)}</span>
          </div>
          ${this.state.discount ? `
          <div class="pos-cart-row pos-discount-display" style="color:#16a34a;">
            <span>${Nawa.I18n.t('discount')}: ${this._escapeHtml(this.state.discount.name)} ${this.state.discount.type === 'percent' ? '(' + this.state.discount.value + '%)' : ''}</span>
            <span>-${this.formatPrice(this.getCartTotal().discountAmount)}</span>
          </div>
          ` : ''}
          <div class="pos-cart-row pos-cart-total">
            <span>${Nawa.I18n.t('total')}</span>
            <span id="pos-total">${this.formatPrice(total)}</span>
          </div>
        </div>
        <div class="pos-discount-actions" style="padding:4px 12px;">
          ${this.state.discount
            ? '<button class="btn btn-outline btn-sm pos-discount-btn" id="pos-discount-remove-btn" style="width:100%;font-size:0.8125rem;display:flex;align-items:center;justify-content:center;gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> ' + Nawa.I18n.t('discount_remove') + '</button>'
            : '<button class="btn btn-outline btn-sm pos-discount-btn" id="pos-discount-btn" style="width:100%;font-size:0.8125rem;display:flex;align-items:center;justify-content:center;gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> ' + Nawa.I18n.t('discount_apply') + '</button>'
          }
        </div>
        <div class="pos-cart-actions">
          <button class="btn btn-outline btn-sm" id="pos-hold-btn" ${cart.length === 0 ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="12" width="4" height="8"/><rect x="10" y="8" width="4" height="12"/><rect x="17" y="4" width="4" height="16"/></svg>
            ${Nawa.I18n.t('hold_order')}
          </button>
          <button class="btn btn-danger btn-sm" id="pos-cancel-btn" ${cart.length === 0 ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            ${Nawa.I18n.t('cancel')}
          </button>
          <button class="btn btn-success btn-lg pos-pay-btn" id="pos-pay-btn" ${cart.length === 0 ? 'disabled' : ''}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            ${Nawa.I18n.t('pay')} ${this.formatPrice(total)}
          </button>
        </div>
      </div>`;
  },

  renderFloorTabs() {
    const floors = this.state.floors;
    if (floors.length === 0) return '';

    const tabs = floors.map(floor => {
      const label = Nawa.I18n.getLang() === 'ar' ? (floor.name || floor.nameEn) : (floor.nameEn || floor.name);
      const active = this.state.currentFloor === floor.id ? 'active' : '';
      return `<button class="pos-floor-tab ${active}" data-floor-id="${floor.id}">${this._escapeHtml(label)}</button>`;
    }).join('');

    return `
      <div class="pos-floor-tabs" id="pos-floor-tabs">
        <div class="pos-floor-tabs-scroll">
          ${tabs}
        </div>
      </div>`;
  },

  renderTableModal() {
    const floors = this.state.floors;
    const floorId = this.state.currentFloor;
    const tables = this.state.tables.filter(t => t.floorId === floorId);
    const currentTableId = this.state.currentTable;
    const orders = this.state.orders || [];
    const isAr = Nawa.I18n.getLang() === 'ar';

    const isTakeaway = currentTableId === null;

    // Floor background color
    const currentFloorObj = floors.find(f => f.id === floorId);
    const floorBgColor = (currentFloorObj && currentFloorObj.color) ? currentFloorObj.color : '#e8e6e1';

    const floorTabsHtml = floors.length > 0 ? `
      <div class="pos-modal-floor-tabs">
        ${floors.map(floor => {
          const label = isAr ? (floor.name || floor.nameEn) : (floor.nameEn || floor.name);
          const active = floorId === floor.id ? 'active' : '';
          return `<button class="pos-modal-floor-tab ${active}" data-floor-id="${floor.id}" data-action="switch-modal-floor">${this._escapeHtml(label)}</button>`;
        }).join('')}
      </div>` : '';

    const takeawaySelected = isTakeaway ? ' selected' : '';
    const takeawayHtml = `
      <div class="pos-table-shape pos-table-takeaway${takeawaySelected}" data-action="select-takeaway">
        <svg class="pos-takeaway-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 8h1a4 4 0 1 1 0 8h-1"/>
          <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/>
          <line x1="6" y1="2" x2="6" y2="4"/>
          <line x1="10" y1="2" x2="10" y2="4"/>
          <line x1="14" y1="2" x2="14" y2="4"/>
        </svg>
        <span class="pos-table-shape-number">${Nawa.I18n.t('takeaway')}</span>
      </div>`;

    const renderTable = (table) => {
      const isSelected = currentTableId === table.id;
      const isOccupied = table.status === 'occupied';
      const isReserved = table.status === 'reserved';
      const label = table.name || table.number || table.id;
      const shape = table.shape || 'square';
      const seats = table.seats || 4;
      const customW = table.width || 0;
      const customH = table.height || 0;
      const tableColor = table.color || '';
      let shapeClass = 'square';
      if (shape === 'round') shapeClass = 'round';
      else if (shape === 'rectangle') shapeClass = 'rect';
      else if (shape === 'pill') shapeClass = 'pill';

      let statusClass = 'free';
      if (isOccupied) statusClass = 'occupied';
      else if (isReserved) statusClass = 'reserved';
      if (isSelected) statusClass += ' selected';

      let orderInfo = '';
      if (isOccupied) {
        const activeOrder = orders.find(o => o.tableId === table.id && (o.status === 'active' || o.status === 'held'));
        if (activeOrder) {
          const time = new Date(activeOrder.createdAt).toLocaleTimeString(isAr ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' });
          const empName = activeOrder.employeeName || '';
          orderInfo = `<span class="pos-table-order-info">${time}${empName ? ' · ' + empName : ''}</span>`;
        }
      }

      const seatCount = isOccupied ? seats : '0/' + seats;

      let customStyle = '';
      if (customW > 0) customStyle += 'width:' + customW + 'px;';
      if (customH > 0) customStyle += 'min-height:' + customH + 'px;height:' + customH + 'px;';

      return `
        <div class="pos-table-shape ${shapeClass} ${statusClass}" data-table-id="${table.id}" data-action="select-table" style="${customStyle}${tableColor ? '--table-color:' + tableColor + ';' : ''}">
          <span class="pos-table-shape-number">${this._escapeHtml(String(label))}</span>
          <span class="pos-table-shape-seats">${seatCount}</span>
          ${orderInfo}
        </div>`;
    };

    let tableShapesHtml = '';
    if (tables.length > 0) {
      tableShapesHtml = tables.map(renderTable).join('');
    } else if (floors.length > 0) {
      tableShapesHtml = `<div class="pos-table-empty">${Nawa.I18n.t('no_data')}</div>`;
    } else {
      const allTables = this.state.tables;
      if (allTables.length > 0) {
        tableShapesHtml = allTables.map(renderTable).join('');
      } else {
        tableShapesHtml = `<div class="pos-table-empty">${Nawa.I18n.t('no_data')}</div>`;
      }
    }

    return `
      <div class="modal pos-table-modal">
        <div class="modal-header">
          <h3>${Nawa.I18n.t('table')}</h3>
          <button class="btn btn-ghost btn-icon pos-modal-close" data-action="close-table-modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        ${floorTabsHtml}
        <div class="modal-body" style="padding:0;">
          <div class="pos-table-plan" style="background:${this._escapeHtml(floorBgColor)};">
            ${takeawayHtml}
            ${tableShapesHtml}
          </div>
          <div class="pos-table-legend">
            <span class="pos-legend-item"><span class="pos-legend-dot pos-legend-free"></span>${Nawa.I18n.t('available')}</span>
            <span class="pos-legend-item"><span class="pos-legend-dot pos-legend-occupied"></span>${Nawa.I18n.t('occupied')}</span>
            <span class="pos-legend-item"><span class="pos-legend-dot pos-legend-reserved"></span>${Nawa.I18n.t('reserved')}</span>
          </div>
        </div>
      </div>`;
  },

  // ===========================
  // CART OPERATIONS
  // ===========================
  addToCart(product) {
    const existing = this.state.cart.find(item => item.productId === product.id);
    if (existing) {
      existing.quantity += 1;
      existing.subtotal = existing.quantity * existing.price;
    } else {
      const name = Nawa.I18n.getLang() === 'ar' ? (product.name || product.nameEn) : (product.nameEn || product.name);
      this.state.cart.push({
        productId: product.id,
        name: product.name || '',
        nameEn: product.nameEn || '',
        price: product.price || 0,
        quantity: 1,
        subtotal: product.price || 0,
        notes: ''
      });
    }

    this._animateAddToCart(product.id);
    this.render();
    this.showNotification(Nawa.I18n.t('add_to_order'), 'success');
  },

  removeFromCart(index) {
    if (index < 0 || index >= this.state.cart.length) return;
    this.state.cart.splice(index, 1);
    this.render();
  },

  showItemNoteModal(index) {
    if (index < 0 || index >= this.state.cart.length) return;
    var self = this;
    var item = this.state.cart[index];
    var name = Nawa.I18n.getLang() === 'ar' ? (item.name || item.nameEn) : (item.nameEn || item.name);
    var currentNote = item.notes || '';
    var note = prompt(Nawa.I18n.t('item_note') + ' — ' + name + ':', currentNote);
    if (note !== null) {
      item.notes = note.trim();
      this.render();
    }
  },

  updateQuantity(index, delta) {
    if (index < 0 || index >= this.state.cart.length) return;

    const item = this.state.cart[index];
    item.quantity += delta;

    if (item.quantity <= 0) {
      this.state.cart.splice(index, 1);
    } else {
      item.subtotal = item.quantity * item.price;
    }

    this.render();
  },

  clearCart() {
    if (this.state.cart.length === 0) return;

    if (!confirm(Nawa.I18n.t('confirm_clear_order'))) return;

    this.state.cart = [];
    this.state.discount = null;
    this.render();
    this.showNotification(Nawa.I18n.t('cart_cleared'), 'info');
  },

  _newParallelOrder() {
    var self = this;
    var isAr = Nawa.I18n.getLang() === 'ar';
    if (this.state.cart.length > 0) {
      this.state.parallelOrders.push({
        id: Date.now().toString(),
        cart: JSON.parse(JSON.stringify(this.state.cart)),
        tableId: this.state.currentTable,
        floorId: this.state.currentFloor,
        discount: this.state.discount ? Object.assign({}, this.state.discount) : null,
        customer: this.state.currentCustomer ? Object.assign({}, this.state.currentCustomer) : null,
        orderNote: this.state.orderNote || '',
        createdAt: new Date().toISOString()
      });
    }
    this.state.cart = [];
    this.state.currentTable = null;
    this.state.currentFloor = null;
    this.state.discount = null;
    this.state.currentCustomer = null;
    this.state.orderNote = '';
    this.state.activeOrderIdx = -1;
    this.render();
  },

  _switchParallelOrder(idx) {
    var self = this;
    var po = this.state.parallelOrders[idx];
    if (!po) return;
    if (this.state.cart.length > 0 && this.state.activeOrderIdx === -1) {
      this.state.parallelOrders.push({
        id: Date.now().toString(),
        cart: JSON.parse(JSON.stringify(this.state.cart)),
        tableId: this.state.currentTable,
        floorId: this.state.currentFloor,
        discount: this.state.discount ? Object.assign({}, this.state.discount) : null,
        customer: this.state.currentCustomer ? Object.assign({}, this.state.currentCustomer) : null,
        orderNote: this.state.orderNote || '',
        createdAt: new Date().toISOString()
      });
      if (idx >= this.state.parallelOrders.length - 1) {
        idx = this.state.parallelOrders.length - 2;
      }
    } else if (this.state.cart.length > 0 && this.state.activeOrderIdx >= 0) {
      var cur = this.state.parallelOrders[this.state.activeOrderIdx];
      if (cur) {
        cur.cart = JSON.parse(JSON.stringify(this.state.cart));
        cur.tableId = this.state.currentTable;
        cur.floorId = this.state.currentFloor;
        cur.discount = this.state.discount ? Object.assign({}, this.state.discount) : null;
        cur.customer = this.state.currentCustomer ? Object.assign({}, this.state.currentCustomer) : null;
        cur.orderNote = this.state.orderNote || '';
      }
    }
    this.state.cart = JSON.parse(JSON.stringify(po.cart));
    this.state.currentTable = po.tableId;
    this.state.currentFloor = po.floorId;
    this.state.discount = po.discount ? Object.assign({}, po.discount) : null;
    this.state.currentCustomer = po.customer ? Object.assign({}, po.customer) : null;
    this.state.orderNote = po.orderNote || '';
    this.state.activeOrderIdx = idx;
    this.render();
  },

  _closeParallelOrder(idx) {
    var isAr = Nawa.I18n.getLang() === 'ar';
    if (!confirm(isAr ? 'هل تريد إغلاق هذا الطلب بدون دفع؟' : 'Close this order without paying?')) return;
    this.state.parallelOrders.splice(idx, 1);
    if (this.state.activeOrderIdx === idx) {
      this.state.cart = [];
      this.state.currentTable = null;
      this.state.currentFloor = null;
      this.state.discount = null;
      this.state.currentCustomer = null;
      this.state.orderNote = '';
      this.state.activeOrderIdx = -1;
    } else if (this.state.activeOrderIdx > idx) {
      this.state.activeOrderIdx--;
    }
    this.render();
  },

  _afterPayment() {
    if (this.state.activeOrderIdx >= 0) {
      this.state.parallelOrders.splice(this.state.activeOrderIdx, 1);
      if (this.state.parallelOrders.length > 0) {
        var idx = Math.min(this.state.activeOrderIdx, this.state.parallelOrders.length - 1);
        this._switchParallelOrder(idx);
      } else {
        this.state.activeOrderIdx = -1;
      }
    }
  },

  _renderOrderTabs() {
    var self = this;
    var isAr = Nawa.I18n.getLang() === 'ar';
    var tabs = '';
    this.state.parallelOrders.forEach(function (po, idx) {
      var label = (idx + 1);
      var tbl = null;
      if (po.tableId) {
        for (var i = 0; i < self.state.tables.length; i++) {
          if (self.state.tables[i].id === po.tableId) { tbl = self.state.tables[i]; break; }
        }
      }
      if (tbl) label = tbl.name || '#' + (tbl.number || (idx + 1));
      var count = po.cart.reduce(function (s, item) { return s + (item.quantity || 1); }, 0);
      var active = self.state.activeOrderIdx === idx ? ' order-tab-active' : '';
      tabs += '<div class="order-tab' + active + '" data-po-idx="' + idx + '" style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:0.8125rem;font-weight:600;background:' + (active ? 'var(--primary,#C9A84C);color:#fff;' : 'var(--bg-secondary,#f1f5f9);color:var(--text-primary,#1A1A1A);') + 'border:1px solid var(--border,#E5E7EB);white-space:nowrap;">';
      tabs += '<span>' + self._escapeHtml(String(label)) + '</span>';
      tabs += '<span style="background:' + (active ? 'rgba(255,255,255,0.3)' : 'var(--border,#E5E7EB)') + ';border-radius:10px;padding:1px 6px;font-size:0.7rem;">' + count + '</span>';
      tabs += '<button class="order-tab-close" data-po-close="' + idx + '" style="background:none;border:none;cursor:pointer;color:' + (active ? '#fff' : 'var(--text-secondary,#8A8F9B)') + ';padding:0;margin:0;font-size:1rem;line-height:1;">&times;</button>';
      tabs += '</div>';
    });
    if (tabs) {
      return '<div class="order-tabs" style="display:flex;gap:6px;padding:0 12px 8px;overflow-x:auto;flex-shrink:0;">' +
        tabs +
        '<div class="order-tab order-tab-new" id="pos-new-order-tab" style="display:flex;align-items:center;justify-content:center;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:0.8125rem;font-weight:600;background:var(--bg-secondary,#f1f5f9);border:1px dashed var(--primary,#C9A84C);color:var(--primary,#C9A84C);white-space:nowrap;" title="' + (isAr ? 'طلب جديد' : 'New Order') + '">+</div>' +
        '</div>';
    }
    return '';
  },

  applyDiscount(preset) {
    if (!preset) return;
    this.state.discount = { name: preset.name, type: preset.type, value: preset.value };
    this.render();
    this.showNotification(Nawa.I18n.t('discount_applied') + ': ' + preset.name, 'success');
  },

  applyCustomDiscount(type, value, name) {
    this.state.discount = { name: name || Nawa.I18n.t('discount'), type: type, value: value };
    this.render();
    this.showNotification(Nawa.I18n.t('discount_applied'), 'success');
  },

  removeDiscount() {
    this.state.discount = null;
    this.render();
    this.showNotification(Nawa.I18n.t('discount_removed'), 'info');
  },

  getCartTotal() {
    const subtotal = this.state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = subtotal * this.TAX_RATE;
    const preDiscountTotal = subtotal + tax;
    let discountAmount = 0;
    if (this.state.discount) {
      const d = this.state.discount;
      if (d.type === 'percent') {
        discountAmount = subtotal * (d.value / 100);
      } else {
        discountAmount = Math.min(d.value, subtotal);
      }
    }
    const total = Math.max(preDiscountTotal - discountAmount, 0);
    return { subtotal, tax, total, discountAmount };
  },

  // ===========================
  // ORDER OPERATIONS
  // ===========================
  async holdOrder() {
    if (this.state.cart.length === 0) return;

    const { subtotal, tax, total, discountAmount } = this.getCartTotal();
    const order = {
      id: this._generateId(),
      items: JSON.parse(JSON.stringify(this.state.cart)),
      subtotal,
      tax,
      total,
      discountType: this.state.discount ? this.state.discount.type : null,
      discountValue: this.state.discount ? this.state.discount.value : 0,
      discountAmount,
      discountName: this.state.discount ? this.state.discount.name : '',
      tableId: this.state.currentTable || null,
      floorId: this.state.currentFloor || null,
      employeeId: this.state.employee ? (this.state.employee.id || this.state.employee.username) : null,
      customerId: this.state.currentCustomer ? this.state.currentCustomer.id : null,
      customerName: this.state.currentCustomer ? this.state.currentCustomer.name : null,
      status: 'held',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await Nawa.DB.add(Nawa.CONFIG.STORES.ORDERS, order);
      try { Nawa.Auth.apiFetch('/orders', { method: 'POST', body: order }); } catch (e) { console.warn('Order sync failed:', e); }
      await Nawa.Audit.log('order_held', Nawa.CONFIG.STORES.ORDERS, order.id, { tableId: order.tableId, itemCount: this.state.cart.length, total });
      this.state.cart = [];
      this.render();
      this.showNotification(Nawa.I18n.t('hold_order'), 'success');
    } catch (e) {
      this.showNotification(Nawa.I18n.t('error_generic'), 'error');
    }
  },

  async submitOrder() {
    if (this.state.cart.length === 0) {
      this.showNotification(Nawa.I18n.t('no_data'), 'warning');
      return;
    }

    const { subtotal, tax, total } = this.getCartTotal();
    const order = {
      id: this._generateId(),
      items: JSON.parse(JSON.stringify(this.state.cart)),
      subtotal,
      tax,
      total,
      tableId: this.state.currentTable || null,
      floorId: this.state.currentFloor || null,
      employeeId: this.state.employee ? (this.state.employee.id || this.state.employee.username) : null,
      customerId: this.state.currentCustomer ? this.state.currentCustomer.id : null,
      customerName: this.state.currentCustomer ? this.state.currentCustomer.name : null,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await Nawa.DB.add(Nawa.CONFIG.STORES.ORDERS, order);
      try { Nawa.Auth.apiFetch('/orders', { method: 'POST', body: order }); } catch (e) { console.warn('Order sync failed:', e); }

      if (this.state.currentTable) {
        await this._updateTableStatus(this.state.currentTable, 'occupied', order.id);
      }

      await Nawa.Audit.log('order_submitted', Nawa.CONFIG.STORES.ORDERS, order.id, { tableId: order.tableId, itemCount: this.state.cart.length, total });

      this.generateReceipt(order);

      this.state.cart = [];
      this.render();
      this.showNotification(Nawa.I18n.t('success_order'), 'success');
    } catch (e) {
      this.showNotification(Nawa.I18n.t('error_generic'), 'error');
    }
  },

  async cancelOrder() {
    if (this.state.cart.length === 0) return;

    if (!confirm(Nawa.I18n.t('confirm_clear_order'))) return;

    try {
      await Nawa.Audit.log('order_cancelled', Nawa.CONFIG.STORES.ORDERS, null, { tableId: this.state.currentTable, itemCount: this.state.cart.length, total: this.getCartTotal().total });
    } catch (e) {
      // audit log failed, continue with cancellation
    }

    this.state.cart = [];
    this.state.discount = null;
    this.render();
    this.showNotification(Nawa.I18n.t('cancel'), 'info');
  },

  // ===========================
  // TABLE OPERATIONS
  // ===========================
  selectFloor(floorId) {
    this.state.currentFloor = floorId;
    this.render();
  },

  async selectTable(table) {
    this.state.currentTable = table.id;
    this.hideTableModal();
    this.render();

    try {
      const heldOrder = await this._findHeldOrderForTable(table.id);
      if (heldOrder && heldOrder.items && heldOrder.items.length > 0) {
        this.state.cart = JSON.parse(JSON.stringify(heldOrder.items));
        await Nawa.DB.update(Nawa.CONFIG.STORES.ORDERS, heldOrder.id, { status: 'active' });
        this.render();
        this.showNotification(Nawa.I18n.t('recall_order'), 'info');
      }
    } catch (e) {
      // no held order, continue with empty cart
    }
  },

  async transferTable(fromTableId, toTableId) {
    try {
      const order = await this._findActiveOrderForTable(fromTableId);
      if (order) {
        await Nawa.DB.update(Nawa.CONFIG.STORES.ORDERS, order.id, { tableId: toTableId });
        await this._updateTableStatus(fromTableId, 'available', null);
        await this._updateTableStatus(toTableId, 'occupied', order.id);
        await Nawa.Audit.log('table_transfer', Nawa.CONFIG.STORES.ORDERS, order.id, { from: fromTableId, to: toTableId });
        this.showNotification(Nawa.I18n.t('success_save'), 'success');
      }
    } catch (e) {
      this.showNotification(Nawa.I18n.t('error_generic'), 'error');
    }
  },

  // ===========================
  // SEARCH & FILTER
  // ===========================
  searchProducts(query) {
    this.state.searchQuery = (query || '').trim();
    this.render();
  },

  filterByCategory(categoryId) {
    this.state.currentCategory = categoryId || null;
    this.render();
  },

  _getFilteredProducts() {
    let products = this.state.products;

    if (this.state.currentCategory) {
      products = products.filter(p => p.categoryId === this.state.currentCategory);
    }

    const q = this.state.searchQuery.toLowerCase();
    if (q) {
      products = products.filter(p => {
        const nameAr = (p.name || '').toLowerCase();
        const nameEn = (p.nameEn || '').toLowerCase();
        const barcode = (p.barcode || '').toLowerCase();
        return nameAr.includes(q) || nameEn.includes(q) || barcode.includes(q);
      });
    }

    return products;
  },

  // ===========================
  // PAYMENT
  // ===========================
  async processPayment() {
    if (this.state.cart.length === 0) return;

    this.state.splitMode = null;
    this.state.splitParts = [];
    this.state.splitPaid = 0;

    const { subtotal, tax, total, discountAmount } = this.getCartTotal();
    const modal = document.getElementById('pos-payment-modal');
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${Nawa.I18n.t('payment')}</h3>
          <button class="btn btn-ghost btn-icon" data-action="close-payment-modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="pos-payment-due">
            <span>${Nawa.I18n.t('total')}</span>
            <span class="pos-payment-total">${this.formatPrice(total)}</span>
          </div>
          <div class="pos-payment-summary">
            <div class="pos-cart-row">
              <span>${Nawa.I18n.t('subtotal')}</span>
              <span>${this.formatPrice(subtotal)}</span>
            </div>
            <div class="pos-cart-row">
              <span>${Nawa.I18n.t('tax')} (${Math.round(this.TAX_RATE * 100)}%)</span>
              <span>${this.formatPrice(tax)}</span>
            </div>
            ${discountAmount > 0 ? '<div class="pos-cart-row" style="color:#16a34a;"><span>' + Nawa.I18n.t('discount') + '</span><span>-' + this.formatPrice(discountAmount) + '</span></div>' : ''}
          </div>
          ${this.state.currentCustomer && this.state.currentCustomer.points > 0 ? '<div class="pos-redeem-section" style="margin-top:12px;padding:10px;background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);border-radius:8px;"><div style="display:flex;align-items:center;justify-content:space-between;"><span style="font-size:0.8125rem;font-weight:600;">🔄 ' + Nawa.I18n.getLang() === 'ar' ? 'نقاط الولاء المتاحة: ' : 'Loyalty points: ' + '<span style="color:#C9A84C;">' + this.state.currentCustomer.points + '</span></span><button class="btn btn-outline btn-sm" id="pos-redeem-pts-btn" style="font-size:0.75rem;">' + (Nawa.I18n.getLang() === 'ar' ? 'استبدال' : 'Redeem') + '</button></div></div>' : ''}
          <div style="margin-top:12px;display:flex;gap:8px;">
            <button class="btn btn-sm pos-pay-method-btn active" data-pay-method="cash" style="flex:1;padding:8px;border:2px solid var(--primary,#C9A84C);background:rgba(201,168,76,0.1);border-radius:8px;font-weight:600;font-size:0.8125rem;cursor:pointer;">${Nawa.I18n.getLang() === 'ar' ? '💵 نقداً' : '💵 Cash'}</button>
            <button class="btn btn-sm pos-pay-method-btn" data-pay-method="card" style="flex:1;padding:8px;border:2px solid var(--border,#E5E7EB);background:var(--bg-secondary);border-radius:8px;font-weight:600;font-size:0.8125rem;cursor:pointer;">💳 Card</button>
            <button class="btn btn-sm pos-pay-method-btn" data-pay-method="gift_card" style="flex:1;padding:8px;border:2px solid var(--border,#E5E7EB);background:var(--bg-secondary);border-radius:8px;font-weight:600;font-size:0.8125rem;cursor:pointer;">🎁 Gift Card</button>
          </div>
          <div id="pos-gift-card-section" style="display:none;margin-top:8px;padding:8px;background:rgba(201,168,76,0.05);border-radius:8px;">
            <input type="text" id="pos-gift-card-code" class="form-input" placeholder="${Nawa.I18n.getLang() === 'ar' ? 'أدخل رمز بطاقة الهدايا' : 'Enter gift card code'}" style="text-transform:uppercase;direction:ltr;text-align:center;font-weight:600;letter-spacing:2px;">
            <div style="margin-top:6px;display:flex;gap:6px;">
              <button class="btn btn-sm" id="pos-gift-card-check" style="flex:1;background:var(--primary,#C9A84C);color:#fff;border:none;border-radius:6px;padding:6px;font-weight:600;cursor:pointer;">${Nawa.I18n.getLang() === 'ar' ? 'تحقق' : 'Check'}</button>
            </div>
            <div id="pos-gift-card-info" style="margin-top:6px;font-size:0.8125rem;display:none;"></div>
          </div>
          <div class="form-group" style="margin-top:16px;">
            <label class="form-label">${Nawa.I18n.t('amount_received')}</label>
            <input type="number" class="form-input pos-payment-input" id="pos-amount-received" step="0.01" min="0" placeholder="0.00" autofocus />
          </div>
          <div class="pos-payment-change" id="pos-payment-change" style="margin-top:12px;">
            <span>${Nawa.I18n.t('change')}</span>
            <span class="pos-change-value">${this.formatPrice(0)}</span>
          </div>
        </div>
        <div class="modal-footer" style="flex-wrap:wrap;gap:8px;">
          <button class="btn btn-ghost" data-action="close-payment-modal">${Nawa.I18n.t('cancel')}</button>
          <button class="btn btn-outline btn-split-bill" data-action="open-split-bill">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            ${Nawa.I18n.t('split_bill')}
          </button>
          <button class="btn btn-success btn-lg" id="pos-confirm-payment" disabled>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            ${Nawa.I18n.t('confirm_payment')}
          </button>
        </div>
      </div>`;

    const amountInput = document.getElementById('pos-amount-received');
    const confirmBtn = document.getElementById('pos-confirm-payment');
    const changeDisplay = document.getElementById('pos-payment-change');

    if (amountInput) {
      amountInput.focus();
      amountInput.addEventListener('input', () => {
        const received = parseFloat(amountInput.value) || 0;
        const change = received - total;
        const changeEl = changeDisplay.querySelector('.pos-change-value');
        if (changeEl) {
          changeEl.textContent = this.formatPrice(Math.max(0, change));
          changeEl.style.color = change >= 0 ? 'var(--success)' : 'var(--danger)';
        }
        if (confirmBtn) {
          confirmBtn.disabled = received < total;
        }
      });
    }

    var redeemBtn = document.getElementById('pos-redeem-pts-btn');
    if (redeemBtn) {
      var self = this;
      redeemBtn.addEventListener('click', async function () {
        var cust = self.state.currentCustomer;
        if (!cust || !cust.points) return;
        var isAr = Nawa.I18n.getLang() === 'ar';
        var ptsStr = prompt(isAr ? 'عدد النقاط للاستبدال (المتاح: ' + cust.points + '):' : 'Points to redeem (available: ' + cust.points + '):', cust.points);
        if (ptsStr === null) return;
        var pts = parseInt(ptsStr) || 0;
        if (pts <= 0 || pts > cust.points) return;
        try {
          var res = await Nawa.Auth.apiFetch('/customers/' + cust.id + '/redeem-points', { method: 'POST', body: { points: pts } });
          if (res && !res.error) {
            self.state.currentCustomer.points = res.points;
            self._showToast(isAr ? 'تم استبدال ' + pts + ' نقطة' : pts + ' points redeemed', 'success');
            self.processPayment();
          }
        } catch (e) {}
      });
    }

    if (confirmBtn) {
      var payMethod = 'cash';
      document.querySelectorAll('.pos-pay-method-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          document.querySelectorAll('.pos-pay-method-btn').forEach(function (b) { b.style.borderColor = 'var(--border,#E5E7EB)'; b.style.background = 'var(--bg-secondary)'; b.classList.remove('active'); });
          btn.style.borderColor = 'var(--primary,#C9A84C)';
          btn.style.background = 'rgba(201,168,76,0.1)';
          btn.classList.add('active');
          payMethod = btn.dataset.payMethod;
          var gcSection = document.getElementById('pos-gift-card-section');
          if (gcSection) gcSection.style.display = payMethod === 'gift_card' ? 'block' : 'none';
          if (payMethod !== 'gift_card' && amountInput) { amountInput.disabled = false; amountInput.focus(); }
        });
      });
      var gcCheckBtn = document.getElementById('pos-gift-card-check');
      if (gcCheckBtn) {
        gcCheckBtn.addEventListener('click', async function () {
          var code = ((document.getElementById('pos-gift-card-code') || {}).value || '').trim();
          var infoEl = document.getElementById('pos-gift-card-info');
          if (!code) return;
          try {
            var res = await Nawa.Auth.apiFetch('/gift-cards/check/' + encodeURIComponent(code));
            if (res && !res.error && res.balance !== undefined) {
              infoEl.style.display = 'block';
              infoEl.style.color = '#16a34a';
              infoEl.innerHTML = '✅ ' + (Nawa.I18n.getLang() === 'ar' ? 'الرصيد: ' : 'Balance: ') + res.balance.toLocaleString() + ' ل.س';
              if (amountInput) {
                amountInput.value = Math.min(res.balance, total);
                amountInput.dispatchEvent(new Event('input'));
              }
            } else {
              infoEl.style.display = 'block';
              infoEl.style.color = '#ef4444';
              infoEl.innerHTML = '❌ ' + (Nawa.I18n.getLang() === 'ar' ? 'البطاقة غير موجودة' : 'Card not found');
            }
          } catch (e) {
            infoEl.style.display = 'block';
            infoEl.style.color = '#ef4444';
            infoEl.innerHTML = '❌ ' + (Nawa.I18n.getLang() === 'ar' ? 'خطأ' : 'Error');
          }
        });
      }

      confirmBtn.addEventListener('click', async () => {
        const received = parseFloat(amountInput.value) || 0;
        if (received < total) return;
        if (payMethod === 'gift_card') {
          var gcCode = ((document.getElementById('pos-gift-card-code') || {}).value || '').trim();
          if (!gcCode) { this.showNotification(Nawa.I18n.getLang() === 'ar' ? 'أدخل رمز البطاقة' : 'Enter card code', 'error'); return; }
          try {
            var redeemRes = await Nawa.Auth.apiFetch('/gift-cards/redeem', { method: 'POST', body: { code: gcCode, amount: total } });
            if (redeemRes && redeemRes.error) { this.showNotification(redeemRes.error, 'error'); return; }
          } catch (e) { this.showNotification(Nawa.I18n.getLang() === 'ar' ? 'خطأ في البطاقة' : 'Card error', 'error'); return; }
        }

        const order = {
          id: this._generateId(),
          items: JSON.parse(JSON.stringify(this.state.cart)),
          subtotal,
          tax,
          total,
          discountType: this.state.discount ? this.state.discount.type : null,
          discountValue: this.state.discount ? this.state.discount.value : 0,
          discountAmount: this.getCartTotal().discountAmount,
          discountName: this.state.discount ? this.state.discount.name : '',
          note: this.state.orderNote,
          amountReceived: received,
          change: received - total,
          paymentMethod: payMethod,
          tableId: this.state.currentTable || null,
          floorId: this.state.currentFloor || null,
          employeeId: this.state.employee ? (this.state.employee.id || this.state.employee.username) : null,
          customerId: this.state.currentCustomer ? this.state.currentCustomer.id : null,
          customerName: this.state.currentCustomer ? this.state.currentCustomer.name : null,
          status: 'paid',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        try {
          await Nawa.DB.add(Nawa.CONFIG.STORES.ORDERS, order);
          try { Nawa.Auth.apiFetch('/orders', { method: 'POST', body: order }); } catch (e) { console.warn('Order sync failed:', e); }

          if (this.state.currentTable) {
            await this._updateTableStatus(this.state.currentTable, 'available', null);
          }

          await Nawa.Audit.log('payment_processed', Nawa.CONFIG.STORES.ORDERS, order.id, { tableId: order.tableId, total: order.total, amountReceived: received, change: received - total, paymentMethod: 'cash' });

          modal.classList.add('hidden');
          this.generateReceipt(order);
          this.state.cart = [];
          this.state.orderNote = '';
          this.state.currentTable = null;
          this.state.currentCustomer = null;
          this.state.discount = null;
          this._afterPayment();
          this.render();
          this.showNotification(Nawa.I18n.t('success_payment'), 'success');
        } catch (e) {
          this.showNotification(Nawa.I18n.t('error_generic'), 'error');
        }
      });
    }
  },

  // ===========================
  // RECEIPT
  // ===========================
  generateReceipt(order) {
    const modal = document.getElementById('pos-receipt-modal');
    if (!modal) return;

    const tableName = order.tableId ? this._getTableLabelById(order.tableId) : Nawa.I18n.t('none');
    const empName = this.state.employee ? (this.state.employee.name || this.state.employee.username || '') : '';
    const date = new Date(order.createdAt).toLocaleString(Nawa.I18n.getLang() === 'ar' ? 'ar-SA' : 'en-US');
    const orderNum = order.id ? order.id.slice(-6).toUpperCase() : '------';

    const rows = (order.items || []).map(item => {
      const name = Nawa.I18n.getLang() === 'ar' ? (item.name || item.nameEn) : (item.nameEn || item.name);
      const noteLine = item.notes ? `<div style="font-size:0.7rem;color:#999;font-style:italic;margin-top:2px;">↳ ${this._escapeHtml(item.notes)}</div>` : '';
      return `
        <tr>
          <td>${this._escapeHtml(name)}${noteLine}</td>
          <td class="text-center">${item.quantity}</td>
          <td class="text-center">${this.formatPrice(item.price)}</td>
          <td class="text-end">${this.formatPrice(item.subtotal)}</td>
        </tr>`;
    }).join('');

    modal.classList.remove('hidden');
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${Nawa.I18n.t('receipt')}</h3>
          <button class="btn btn-ghost btn-icon" data-action="close-receipt-modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="pos-receipt" id="pos-receipt-content">
            <div class="pos-receipt-header">
              <div class="pos-receipt-logo">نواة POS</div>
              <div class="pos-receipt-company">${Nawa.CONFIG.COMPANY_NAME}</div>
              <div class="pos-receipt-divider">===========================</div>
            </div>
            <div class="pos-receipt-meta">
              <div>${Nawa.I18n.t('order_id')}: ${orderNum}</div>
              <div>${Nawa.I18n.t('date')}: ${date}</div>
              <div>${Nawa.I18n.t('table')}: ${tableName}</div>
              <div>${Nawa.I18n.t('employee')}: ${this._escapeHtml(empName)}</div>
              ${order.customerName ? '<div>' + Nawa.I18n.t('customer') + ': ' + this._escapeHtml(order.customerName) + '</div>' : ''}
            </div>
            <div class="pos-receipt-divider">---------------------------</div>
            <table class="pos-receipt-table">
              <thead>
                <tr>
                  <th>${Nawa.I18n.t('item')}</th>
                  <th class="text-center">${Nawa.I18n.t('quantity')}</th>
                  <th class="text-center">${Nawa.I18n.t('price')}</th>
                  <th class="text-end">${Nawa.I18n.t('subtotal')}</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <div class="pos-receipt-divider">---------------------------</div>
            <div class="pos-receipt-totals">
              <div class="pos-cart-row">
                <span>${Nawa.I18n.t('subtotal')}</span>
                <span>${this.formatPrice(order.subtotal)}</span>
              </div>
              <div class="pos-cart-row">
                <span>${Nawa.I18n.t('tax')} (${Math.round(this.TAX_RATE * 100)}%)</span>
                <span>${this.formatPrice(order.tax)}</span>
              </div>
              ${order.discountAmount > 0 ? `
              <div class="pos-cart-row" style="color:#16a34a;">
                <span>${Nawa.I18n.t('discount')}: ${this._escapeHtml(order.discountName || '')}</span>
                <span>-${this.formatPrice(order.discountAmount)}</span>
              </div>` : ''}
              <div class="pos-cart-row pos-cart-total">
                <span>${Nawa.I18n.t('total')}</span>
                <span>${this.formatPrice(order.total)}</span>
              </div>
              ${order.amountReceived != null ? `
                <div class="pos-cart-row">
                  <span>${Nawa.I18n.t('amount_received')}</span>
                  <span>${this.formatPrice(order.amountReceived)}</span>
                </div>
                <div class="pos-cart-row">
                  <span>${Nawa.I18n.t('change')}</span>
                  <span>${this.formatPrice(order.change || 0)}</span>
                </div>` : ''}
              ${order.payments && order.payments.length > 1 ? `
                <div style="margin-top:8px;border-top:1px dashed var(--border);padding-top:8px;">
                  <div style="font-size:0.75rem;font-weight:600;color:var(--text-secondary);margin-bottom:4px;">${Nawa.I18n.t('split_bill')}:</div>
                  ${order.payments.map(function(p, i) {
                    const methodLabel = p.method === 'card' ? Nawa.I18n.t('credit_card') : Nawa.I18n.t('cash');
                    return '<div class="pos-cart-row" style="font-size:0.8125rem;"><span>' + (i + 1) + '. ' + methodLabel + '</span><span>' + Nawa.POS.formatPrice(p.amount) + '</span></div>';
                  }).join('')}
                </div>` : ''}
            </div>
            <div class="pos-receipt-divider">===========================</div>
            <div class="pos-receipt-footer">
              <div>${Nawa.I18n.t('welcome')}</div>
              <div>${Nawa.CONFIG.COMPANY_NAME}</div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-action="close-receipt-modal">${Nawa.I18n.t('close')}</button>
          <button class="btn btn-primary" id="pos-print-receipt">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            ${Nawa.I18n.t('print')}
          </button>
        </div>
      </div>`;

    const printBtn = document.getElementById('pos-print-receipt');
    if (printBtn) {
      printBtn.addEventListener('click', () => this.printReceipt(order));
    }
  },

  printReceipt(order) {
    const content = document.getElementById('pos-receipt-content');
    if (!content) return;

    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) {
      this.showNotification(Nawa.I18n.t('error_network'), 'warning');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>${Nawa.I18n.t('receipt')}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Tajawal', 'Courier New', monospace;
            font-size: 13px;
            direction: rtl;
            padding: 16px;
            color: #000;
            max-width: 300px;
            margin: 0 auto;
          }
          .pos-receipt-header { text-align: center; margin-bottom: 12px; }
          .pos-receipt-logo { font-size: 20px; font-weight: 700; }
          .pos-receipt-company { font-size: 12px; color: #666; }
          .pos-receipt-divider { text-align: center; color: #999; margin: 8px 0; letter-spacing: 2px; }
          .pos-receipt-meta div { margin-bottom: 4px; font-size: 12px; }
          .pos-receipt-table { width: 100%; border-collapse: collapse; margin: 8px 0; }
          .pos-receipt-table th { font-size: 11px; border-bottom: 1px dashed #ccc; padding: 4px 0; text-align: right; }
          .pos-receipt-table td { padding: 4px 0; font-size: 12px; }
          .pos-receipt-totals { margin-top: 8px; }
          .pos-receipt-totals .pos-cart-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 12px; }
          .pos-receipt-totals .pos-cart-total { font-weight: 700; font-size: 14px; border-top: 1px dashed #ccc; padding-top: 6px; margin-top: 6px; }
          .pos-receipt-footer { text-align: center; margin-top: 12px; font-size: 11px; color: #666; }
          .text-center { text-align: center; }
          .text-end { text-align: left; }
          @media print {
            body { padding: 0; }
          }
        </style>
      </head>
      <body>${content.innerHTML}</body>
      </html>`);
    printWindow.document.close();

    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    }, 300);
  },

  // ===========================
  // SYNC
  // ===========================
  async syncToServer() {
    try {
      const pendingItems = await Nawa.DB.getAll(Nawa.CONFIG.STORES.PENDING_SYNC) || [];
      if (pendingItems.length === 0) {
        this._updateSyncIndicator('synced');
        return;
      }

      this._updateSyncIndicator('syncing');

      // Simulated server sync
      for (const item of pendingItems) {
        await Nawa.DB.hardDelete(Nawa.CONFIG.STORES.PENDING_SYNC, item.id);
      }

      this._updateSyncIndicator('synced');
      this.showNotification(Nawa.I18n.t('success_sync'), 'success');
    } catch (e) {
      this._updateSyncIndicator('error');
    }
  },

  _updateSyncIndicator(status) {
    const indicator = document.getElementById('pos-sync-indicator');
    if (!indicator) return;

    const dot = indicator.querySelector('.pos-sync-dot');
    if (!dot) return;

    dot.className = 'pos-sync-dot';
    switch (status) {
      case 'synced':
        dot.classList.add('pos-sync-synced');
        break;
      case 'syncing':
        dot.classList.add('pos-sync-syncing');
        break;
      case 'error':
        dot.classList.add('pos-sync-error');
        break;
      default:
        break;
    }
  },

  _startSyncTimer() {
    if (this._syncTimer) clearInterval(this._syncTimer);
    if (this._pullTimer) clearInterval(this._pullTimer);
    const interval = Nawa.CONFIG.SYNC_INTERVAL || 300000;
    this._syncTimer = setInterval(() => this.syncToServer(), interval);
    this._pullTimer = setInterval(async () => {
      await this._syncFromServer();
      this.render();
    }, interval);
  },

  // ===========================
  // EVENT LISTENERS
  // ===========================
  _setupEventListeners() {
    const app = document.getElementById('app');
    if (!app) return;

    app.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action], [data-product-id], [data-category-id], [data-floor-id], [data-cart-index], [data-po-idx], [data-po-close], [data-cart-item-idx]');

      // Order tab switch
      var poTab = e.target.closest('[data-po-idx]');
      if (poTab && !e.target.closest('[data-po-close]')) {
        var idx = parseInt(poTab.dataset.poIdx, 10);
        this._switchParallelOrder(idx);
        return;
      }
      // Order tab close
      var poClose = e.target.closest('[data-po-close]');
      if (poClose) {
        var cidx = parseInt(poClose.dataset.poClose, 10);
        this._closeParallelOrder(cidx);
        return;
      }
      // New order tab
      if (e.target.id === 'pos-new-order-tab' || e.target.closest('#pos-new-order-tab')) {
        this._newParallelOrder();
        return;
      }
      if (!target) return;

      // Quick-fire button
      if (target.classList.contains('pos-quickfire-btn')) {
        var pid = target.dataset.productId;
        var product = this.state.products.find(p => String(p.id) === String(pid));
        if (product) this.addToCart(product);
        return;
      }

      // Product click
      const productId = target.closest('[data-product-id]');
      if (productId) {
        const pid = productId.dataset.productId;
        const product = this.state.products.find(p => String(p.id) === String(pid));
        if (product) this.addToCart(product);
        return;
      }

      // Category pill
      const catPill = target.closest('[data-category-id]');
      if (catPill && catPill.classList.contains('pos-cat-pill')) {
        this.filterByCategory(catPill.dataset.categoryId);
        return;
      }

      // Floor tab
      const floorTab = target.closest('[data-floor-id]');
      if (floorTab && floorTab.classList.contains('pos-floor-tab')) {
        this.selectFloor(floorTab.dataset.floorId);
        return;
      }

      // Cart quantity controls
      const action = target.dataset.action;
      const index = parseInt(target.dataset.index, 10);

      // Modal floor tab (switches floor inside table modal without closing it)
      if (action === 'switch-modal-floor') {
        const mfId = target.dataset.floorId;
        if (mfId) {
          this.state.currentFloor = mfId;
          const modal = document.getElementById('pos-table-modal');
          if (modal && !modal.classList.contains('hidden')) {
            modal.innerHTML = this.renderTableModal();
          }
        }
        return;
      }

      // Takeaway select
      if (action === 'select-takeaway') {
        this.state.currentTable = null;
        this.hideTableModal();
        this.render();
        return;
      }

      if (action === 'plus' && !isNaN(index)) {
        this.updateQuantity(index, 1);
        return;
      }
      if (action === 'minus' && !isNaN(index)) {
        this.updateQuantity(index, -1);
        return;
      }
      if (action === 'remove' && !isNaN(index)) {
        this.removeFromCart(index);
        return;
      }
      if (action === 'item-note' && !isNaN(index)) {
        this.showItemNoteModal(index);
        return;
      }

      // Table select
      if (action === 'select-table') {
        const tableId = target.dataset.tableId;
        const table = this.state.tables.find(t => String(t.id) === String(tableId));
        if (table) this.selectTable(table);
        return;
      }

      // Modal close actions
      if (action === 'close-table-modal') {
        this.hideTableModal();
        return;
      }
      if (action === 'close-payment-modal') {
        if (this.state.splitMode) {
          this.cancelSplitBill();
        } else {
          const pm = document.getElementById('pos-payment-modal');
          if (pm) pm.classList.add('hidden');
        }
        return;
      }
      if (action === 'close-receipt-modal') {
        const rm = document.getElementById('pos-receipt-modal');
        if (rm) rm.classList.add('hidden');
        return;
      }
      if (action === 'close-history-modal') {
        const hm = document.getElementById('pos-history-modal');
        if (hm) hm.classList.add('hidden');
        return;
      }
      if (action === 'close-customer-modal') {
        this.hideCustomerModal();
        return;
      }
      if (action === 'pos-add-customer') {
        this._showAddCustomerForm();
        return;
      }
      if (action === 'pos-clear-customer') {
        this.state.currentCustomer = null;
        this.hideCustomerModal();
        this.render();
        return;
      }

      // Split bill actions
      if (action === 'open-split-bill') {
        this.initSplitBill();
        return;
      }
      if (action === 'split-select-equal') {
        this.initSplitBill('equal');
        return;
      }
      if (action === 'split-select-custom') {
        this.initSplitBill('custom');
        return;
      }
      if (action === 'split-cancel') {
        this.cancelSplitBill();
        return;
      }
      if (action === 'split-toggle-method') {
        const mi = parseInt(target.dataset.splitIndex, 10);
        if (!isNaN(mi)) this.toggleSplitPartMethod(mi);
        return;
      }
      if (action === 'split-pay') {
        const pi = parseInt(target.dataset.splitIndex, 10);
        if (!isNaN(pi)) this.paySplitPart(pi);
        return;
      }
      if (action === 'split-add-part') {
        this.addCustomSplitPart();
        return;
      }
      if (action === 'split-remove-part') {
        const ri = parseInt(target.dataset.splitIndex, 10);
        if (!isNaN(ri)) this.removeCustomSplitPart(ri);
        return;
      }
    });

    // Header buttons (outside delegation area) - attach once only
    if (!this._listenersAttached) {
      document.addEventListener('click', (e) => {
        if (e.target.closest('#pos-select-table')) {
          this.showTableModal();
          return;
        }
        if (e.target.closest('#pos-lang-toggle')) {
          const lang = Nawa.I18n.getLang();
          if (typeof Nawa.I18n.setLang === 'function') {
            Nawa.I18n.setLang(lang === 'ar' ? 'en' : 'ar');
          }
          this.render();
          return;
        }
        if (e.target.closest('#pos-hold-btn')) {
          this.holdOrder();
          return;
        }
        if (e.target.closest('#pos-cancel-btn')) {
          this.cancelOrder();
          return;
        }
        if (e.target.closest('#pos-discount-btn')) {
          this.showDiscountModal();
          return;
        }
        if (e.target.closest('#pos-discount-remove-btn')) {
          this.removeDiscount();
          return;
        }
        if (e.target.closest('#pos-pay-btn')) {
          this.processPayment();
          return;
        }
        if (e.target.closest('#pos-order-history-btn')) {
          this.showOrderHistory();
          return;
        }
        if (e.target.closest('#pos-select-customer')) {
          this.showCustomerModal();
          return;
        }
        if (e.target.closest('#pos-discount-modal-close')) {
          this.hideDiscountModal();
          return;
        }
        if (e.target.closest('#pos-disc-apply-custom')) {
          const type = document.getElementById('pos-disc-type').value;
          const value = parseFloat(document.getElementById('pos-disc-value').value) || 0;
          if (value > 0) {
            this.applyCustomDiscount(type, value, null);
            this.hideDiscountModal();
          }
          return;
        }
        const presetBtn = e.target.closest('.pos-discount-preset-btn');
        if (presetBtn) {
          try {
            const preset = JSON.parse(decodeURIComponent(presetBtn.dataset.discountPreset));
            this.applyDiscount(preset);
            this.hideDiscountModal();
          } catch (e) {}
          return;
        }
      });

    // Search input
    app.addEventListener('input', (e) => {
      if (e.target.classList.contains('pos-search-input')) {
        clearTimeout(this._searchDebounce);
        this._searchDebounce = setTimeout(() => {
          this.state.searchQuery = e.target.value;
          const grid = document.getElementById('pos-product-grid');
          if (grid) {
            grid.innerHTML = this.renderProducts();
          }
        }, 250);
      }
      if (e.target.classList.contains('pos-note-input')) {
        this.state.orderNote = e.target.value;
      }
      if (e.target.classList.contains('pos-customer-search-input')) {
        clearTimeout(this._customerSearchDebounce);
        var self = this;
        this._customerSearchDebounce = setTimeout(function () {
          self._loadCustomerModalData(e.target.value);
        }, 300);
      }
      if (e.target.classList.contains('split-amount-input')) {
        const idx = parseInt(e.target.dataset.splitIndex, 10);
        if (!isNaN(idx)) this.updateSplitPartAmount(idx, e.target.value);
      }
    });

    // Keyboard shortcut: Escape to close modals, Enter for barcode
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        var bcInput = document.getElementById('pos-barcode-input');
        if (document.activeElement === bcInput && bcInput.value.trim()) {
          var barcode = bcInput.value.trim();
          var product = this.state.products.find(function (p) { return p.barcode === barcode; });
          if (product) {
            this.addToCart(product);
            this.showNotification(Nawa.I18n.getLang() === 'ar' ? 'تمت الإضافة: ' + product.name : 'Added: ' + (product.nameEn || product.name), 'success');
          } else {
            this.showNotification(Nawa.I18n.getLang() === 'ar' ? 'لم يتم العثور على المنتج' : 'Product not found', 'warning');
          }
          bcInput.value = '';
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'Escape') {
        this.hideTableModal();
        const pm = document.getElementById('pos-payment-modal');
        if (pm) {
          if (this.state.splitMode) {
            this.cancelSplitBill();
          } else {
            pm.classList.add('hidden');
          }
        }
        const rm = document.getElementById('pos-receipt-modal');
        if (rm) rm.classList.add('hidden');
        const hm = document.getElementById('pos-history-modal');
        if (hm) hm.classList.add('hidden');
        const dm = document.getElementById('pos-discount-modal');
        if (dm) dm.classList.add('hidden');
        this.hideCustomerModal();
      }
    });
    this._listenersAttached = true;
    }
  },

  // ===========================
  // TABLE MODAL
  // ===========================
  showTableModal() {
    const modal = document.getElementById('pos-table-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.innerHTML = this.renderTableModal();
  },

  hideTableModal() {
    const modal = document.getElementById('pos-table-modal');
    if (modal) modal.classList.add('hidden');
  },

  // ===========================
  // SPLIT BILL
  // ===========================
  initSplitBill(mode) {
    if (this.state.cart.length === 0) return;
    const { total } = this.getCartTotal();

    if (mode === 'equal') {
      const count = parseInt(prompt(Nawa.I18n.t('split_parts'), '2'), 10);
      if (!count || count < 2 || count > 10) return;
      const partAmount = Math.round((total / count) * 100) / 100;
      const parts = [];
      for (let i = 0; i < count; i++) {
        const isLast = i === count - 1;
        const amount = isLast
          ? Math.round((total - partAmount * (count - 1)) * 100) / 100
          : partAmount;
        parts.push({ amount, method: 'cash', paid: false });
      }
      this.state.splitMode = 'equal';
      this.state.splitParts = parts;
      this.state.splitPaid = 0;
    } else if (mode === 'custom') {
      this.state.splitMode = 'custom';
      this.state.splitParts = [
        { amount: 0, method: 'cash', paid: false },
        { amount: 0, method: 'cash', paid: false }
      ];
      this.state.splitPaid = 0;
    } else {
      this.showSplitChoice();
      return;
    }

    this.renderSplitModal();
  },

  showSplitChoice() {
    const modal = document.getElementById('pos-payment-modal');
    if (!modal) return;

    const { total } = this.getCartTotal();

    modal.classList.remove('hidden');
    modal.innerHTML = `
      <div class="modal split-modal">
        <div class="modal-header">
          <h3>${Nawa.I18n.t('split_bill')}</h3>
          <button class="btn btn-ghost btn-icon" data-action="close-payment-modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="split-remaining-bar">
            <span>${Nawa.I18n.t('total')}</span>
            <span class="split-remaining-value">${this.formatPrice(total)}</span>
          </div>
          <div class="split-choice-grid">
            <button class="split-choice-card" data-action="split-select-equal">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              <span class="split-choice-title">${Nawa.I18n.t('split_equal')}</span>
              <span class="split-choice-desc">${Nawa.I18n.t('split_parts')}: 2, 3, 4...</span>
            </button>
            <button class="split-choice-card" data-action="split-select-custom">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span class="split-choice-title">${Nawa.I18n.t('split_custom')}</span>
              <span class="split-choice-desc">${Nawa.I18n.t('amount_due')}</span>
            </button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-action="close-payment-modal">${Nawa.I18n.t('cancel')}</button>
        </div>
      </div>`;
  },

  addCustomSplitPart() {
    if (this.state.splitParts.length >= 10) return;
    this.state.splitParts.push({ amount: 0, method: 'cash', paid: false });
    this.renderSplitModal();
  },

  removeCustomSplitPart(index) {
    if (this.state.splitParts.length <= 2) return;
    this.state.splitParts.splice(index, 1);
    this.renderSplitModal();
  },

  updateSplitPartAmount(index, amount) {
    const val = parseFloat(amount) || 0;
    this.state.splitParts[index].amount = val;
  },

  toggleSplitPartMethod(index) {
    const part = this.state.splitParts[index];
    part.method = part.method === 'cash' ? 'card' : 'cash';
    this.renderSplitModal();
  },

  cancelSplitBill() {
    this.state.splitMode = null;
    this.state.splitParts = [];
    this.state.splitPaid = 0;
    const modal = document.getElementById('pos-payment-modal');
    if (modal) modal.classList.add('hidden');
  },

  async paySplitPart(index) {
    const part = this.state.splitParts[index];
    if (!part || part.paid) return;

    const { total } = this.getCartTotal();

    if (this.state.splitMode === 'custom') {
      if (part.amount <= 0) {
        this._showToast(Nawa.I18n.t('error_validation'), 'warning');
        return;
      }
      const currentTotal = this.state.splitParts.reduce((s, p, i) => i === index ? s : s + p.amount, 0);
      if (currentTotal + part.amount > total + 0.01) {
        this._showToast(Nawa.I18n.t('error_validation'), 'warning');
        return;
      }
    }

    part.paid = true;
    this.state.splitPaid += part.amount;
    this.renderSplitModal();

    const remaining = Math.round((total - this.state.splitPaid) * 100) / 100;
    if (remaining <= 0.01) {
      await this._completeSplitOrder();
    }
  },

  async _completeSplitOrder() {
    const { subtotal, tax, total, discountAmount } = this.getCartTotal();
    const payments = this.state.splitParts.map(p => ({
      amount: p.amount,
      method: p.method,
      paid: true
    }));

    const totalReceived = payments.reduce((s, p) => s + p.amount, 0);

    const order = {
      id: this._generateId(),
      items: JSON.parse(JSON.stringify(this.state.cart)),
      subtotal,
      tax,
      total,
      discountType: this.state.discount ? this.state.discount.type : null,
      discountValue: this.state.discount ? this.state.discount.value : 0,
      discountAmount,
      discountName: this.state.discount ? this.state.discount.name : '',
      note: this.state.orderNote,
      amountReceived: totalReceived,
      change: Math.round((totalReceived - total) * 100) / 100,
      paymentMethod: 'split',
      payments: payments,
      tableId: this.state.currentTable || null,
      floorId: this.state.currentFloor || null,
      employeeId: this.state.employee ? (this.state.employee.id || this.state.employee.username) : null,
      customerId: this.state.currentCustomer ? this.state.currentCustomer.id : null,
      customerName: this.state.currentCustomer ? this.state.currentCustomer.name : null,
      status: 'paid',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await Nawa.DB.add(Nawa.CONFIG.STORES.ORDERS, order);

      if (this.state.currentTable) {
        await this._updateTableStatus(this.state.currentTable, 'available', null);
      }

      await Nawa.Audit.log('payment_processed', Nawa.CONFIG.STORES.ORDERS, order.id, { tableId: order.tableId, total: order.total, paymentMethod: 'split', parts: payments.length });

      this.state.splitMode = null;
      this.state.splitParts = [];
      this.state.splitPaid = 0;

      const pm = document.getElementById('pos-payment-modal');
      if (pm) pm.classList.add('hidden');

      this.generateReceipt(order);
      this.state.cart = [];
      this.state.orderNote = '';
      this.state.currentTable = null;
      this.state.currentCustomer = null;
      this.state.discount = null;
      this.render();
      this._showToast(Nawa.I18n.t('split_complete'), 'success');
    } catch (e) {
      this._showToast(Nawa.I18n.t('error_generic'), 'error');
    }
  },

  renderSplitModal() {
    const modal = document.getElementById('pos-payment-modal');
    if (!modal) return;

    const { total } = this.getCartTotal();
    const remaining = Math.round((total - this.state.splitPaid) * 100) / 100;
    const isCustom = this.state.splitMode === 'custom';

    const partsHtml = this.state.splitParts.map((part, i) => {
      const statusIcon = part.paid
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
        : '';
      const paidClass = part.paid ? ' split-part-paid' : '';

      const cashActive = part.method === 'cash' ? ' active' : '';
      const cardActive = part.method === 'card' ? ' active' : '';

      const amountInput = isCustom && !part.paid
        ? `<input type="number" class="form-input split-amount-input" value="${part.amount || ''}" step="0.01" min="0" placeholder="0.00" data-split-index="${i}" data-action="split-amount-change" />`
        : `<span class="split-part-amount-value">${this.formatPrice(part.amount)}</span>`;

      const removeBtn = isCustom && !part.paid && this.state.splitParts.length > 2
        ? `<button class="btn btn-ghost btn-icon split-remove-btn" data-action="split-remove-part" data-split-index="${i}" title="${Nawa.I18n.t('delete')}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>`
        : '';

      const payBtn = part.paid
        ? `<span class="split-paid-label">${statusIcon} ${Nawa.I18n.t('split_paid')}</span>`
        : `<button class="btn btn-success btn-sm split-pay-btn" data-action="split-pay" data-split-index="${i}">${Nawa.I18n.t('split_pay_part')}</button>`;

      return `
        <div class="split-part-card${paidClass}">
          <div class="split-part-header">
            <span class="split-part-label">${Nawa.I18n.t('split_parts')} ${i + 1}</span>
            ${removeBtn}
          </div>
          <div class="split-part-body">
            ${amountInput}
            <div class="split-method-toggle">
              <button class="split-method-btn${cashActive}" data-action="split-toggle-method" data-split-index="${i}" ${part.paid ? 'disabled' : ''}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 10v4"/><path d="M6 10h.01M18 10h.01"/></svg>
                ${Nawa.I18n.t('cash')}
              </button>
              <button class="split-method-btn${cardActive}" data-action="split-toggle-method" data-split-index="${i}" ${part.paid ? 'disabled' : ''}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                ${Nawa.I18n.t('credit_card')}
              </button>
            </div>
            ${payBtn}
          </div>
        </div>`;
    }).join('');

    const addPartBtn = isCustom
      ? `<button class="btn btn-outline btn-sm split-add-btn" data-action="split-add-part" style="width:100%;margin-top:8px;">+ ${Nawa.I18n.t('add')}</button>`
      : '';

    modal.classList.remove('hidden');
    modal.innerHTML = `
      <div class="modal split-modal">
        <div class="modal-header">
          <h3>${Nawa.I18n.t('split_bill')}</h3>
          <button class="btn btn-ghost btn-icon" data-action="split-cancel">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="split-remaining-bar">
            <span>${Nawa.I18n.t('split_remaining')}</span>
            <span class="split-remaining-value">${this.formatPrice(Math.max(0, remaining))}</span>
          </div>
          <div class="split-parts-list">
            ${partsHtml}
          </div>
          ${addPartBtn}
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-action="split-cancel">${Nawa.I18n.t('split_cancel')}</button>
        </div>
      </div>`;
  },

  // ===========================
  // CUSTOMER OPERATIONS
  // ===========================
  showCustomerModal() {
    var modal = document.getElementById('pos-customer-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.innerHTML = this.renderCustomerModal();
    this._loadCustomerModalData();
  },

  hideCustomerModal() {
    var modal = document.getElementById('pos-customer-modal');
    if (modal) modal.classList.add('hidden');
  },

  renderCustomerModal() {
    return `
      <div class="modal pos-customer-modal">
        <div class="modal-header">
          <h3>${Nawa.I18n.t('select_customer')}</h3>
          <button class="btn btn-ghost btn-icon" data-action="close-customer-modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="modal-body" style="padding:0;">
          <div style="padding:12px 16px;border-bottom:1px solid var(--border);">
            <input type="text" class="form-input pos-customer-search-input" placeholder="${Nawa.I18n.t('search_customers')}" />
          </div>
          <div class="pos-customer-list" id="pos-customer-list">
            <div class="admin-loading" style="padding:40px;text-align:center;"><div class="spinner-lg"></div></div>
          </div>
        </div>
        <div class="modal-footer" style="justify-content:space-between;">
          <button class="btn btn-outline" data-action="pos-clear-customer">${Nawa.I18n.t('no_customer')}</button>
          <button class="btn btn-primary" data-action="pos-add-customer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            ${Nawa.I18n.t('add_customer')}
          </button>
        </div>
      </div>`;
  },

  async _loadCustomerModalData(searchQuery) {
    var self = this;
    var listEl = document.getElementById('pos-customer-list');
    if (!listEl) return;

    try {
      var url = '/customers' + (searchQuery ? '?search=' + encodeURIComponent(searchQuery) : '');
      var res = await Nawa.Auth.apiFetch(url);
      if (res.ok) {
        var customers = await res.json();
        self._customerListData = customers;
        self._renderCustomerList(listEl, customers);
      } else {
        listEl.innerHTML = '<div class="admin-empty" style="padding:40px;"><div class="admin-empty-title">' + Nawa.I18n.t('no_data') + '</div></div>';
      }
    } catch (e) {
      listEl.innerHTML = '<div class="admin-empty" style="padding:40px;"><div class="admin-empty-title">' + Nawa.I18n.t('error_network') + '</div></div>';
    }
  },

  _renderCustomerList(container, customers) {
    if (!container) return;
    var self = this;
    var currentId = this.state.currentCustomer ? this.state.currentCustomer.id : null;

    if (!customers || customers.length === 0) {
      container.innerHTML = '<div class="admin-empty" style="padding:40px;"><div class="admin-empty-title">' + Nawa.I18n.t('no_data') + '</div></div>';
      return;
    }

    var html = '';
    customers.forEach(function (c) {
      var selected = currentId === c.id ? ' selected' : '';
      var lastVisit = c.lastVisit ? new Date(c.lastVisit).toLocaleDateString(Nawa.I18n.getLang() === 'ar' ? 'ar-SA' : 'en-US') : '--';
      html += '<div class="pos-customer-card' + selected + '" data-customer-id="' + c.id + '">';
      html += '<div class="pos-customer-card-main">';
      html += '<div class="pos-customer-card-avatar">' + self._escapeHtml((c.name || '').charAt(0)) + '</div>';
      html += '<div class="pos-customer-card-info">';
      html += '<div class="pos-customer-card-name">' + self._escapeHtml(c.name) + '</div>';
      html += '<div class="pos-customer-card-phone">' + self._escapeHtml(c.phone || '') + '</div>';
      html += '</div></div>';
      html += '<div class="pos-customer-card-stats">';
      html += '<span class="pos-customer-card-stat">' + (c.orderCount || 0) + ' ' + Nawa.I18n.t('customer_orders') + '</span>';
      if (c.points) html += '<span class="pos-customer-card-stat" style="color:var(--primary,#C9A84C);font-weight:700;">' + (c.points || 0) + ' pts</span>';
      html += '</div></div>';
    });

    container.innerHTML = html;

    container.querySelectorAll('.pos-customer-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var cid = card.getAttribute('data-customer-id');
        var customer = (self._customerListData || []).find(function (c) { return c.id === cid; });
        if (customer) {
          self.state.currentCustomer = { id: customer.id, name: customer.name };
          self.hideCustomerModal();
          self.render();
        }
      });
    });
  },

  async _showAddCustomerForm() {
    var self = this;
    var modal = document.getElementById('pos-customer-modal');
    if (!modal) return;

    modal.innerHTML = `
      <div class="modal pos-customer-modal">
        <div class="modal-header">
          <h3>${Nawa.I18n.t('add_customer')}</h3>
          <button class="btn btn-ghost btn-icon" data-action="close-customer-modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">${Nawa.I18n.t('customer_name')} *</label>
            <input type="text" class="form-input" id="pos-cust-name" placeholder="${Nawa.I18n.t('customer_name')}" />
          </div>
          <div class="form-group">
            <label class="form-label">${Nawa.I18n.t('customer_phone')}</label>
            <input type="tel" class="form-input" id="pos-cust-phone" placeholder="${Nawa.I18n.t('customer_phone')}" dir="ltr" />
          </div>
          <div class="form-group">
            <label class="form-label">${Nawa.I18n.t('customer_notes')}</label>
            <textarea class="form-input" id="pos-cust-notes" rows="2" style="resize:vertical;" placeholder="${Nawa.I18n.t('customer_notes')}"></textarea>
          </div>
          <div id="pos-cust-error" class="hidden" style="color:var(--danger,#ef4444);text-align:center;margin-bottom:8px;font-size:0.8125rem;"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-action="close-customer-modal">${Nawa.I18n.t('cancel')}</button>
          <button class="btn btn-primary" id="pos-cust-save">${Nawa.I18n.t('save')}</button>
        </div>
      </div>`;

    var saveBtn = document.getElementById('pos-cust-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        var name = (document.getElementById('pos-cust-name') || {}).value || '';
        var phone = (document.getElementById('pos-cust-phone') || {}).value || '';
        var notes = (document.getElementById('pos-cust-notes') || {}).value || '';
        var errEl = document.getElementById('pos-cust-error');

        if (!name.trim()) {
          if (errEl) { errEl.textContent = Nawa.I18n.t('error_required_field'); errEl.classList.remove('hidden'); }
          return;
        }

        try {
          var res = await Nawa.Auth.apiFetch('/customers', {
            method: 'POST',
            body: { name: name.trim(), phone: phone.trim(), notes: notes.trim() }
          });
          if (res.ok) {
            var saved = await res.json();
            self.state.currentCustomer = { id: saved.id, name: saved.name };
            self.hideCustomerModal();
            self.render();
            self.showNotification(Nawa.I18n.t('success_save'), 'success');
          } else {
            var err = await res.json();
            if (errEl) { errEl.textContent = err.error || Nawa.I18n.t('error_generic'); errEl.classList.remove('hidden'); }
          }
        } catch (e) {
          if (errEl) { errEl.textContent = Nawa.I18n.t('error_network'); errEl.classList.remove('hidden'); }
        }
      });
    }
  },

  // ===========================
  // DISCOUNT MODAL
  // ===========================
  showDiscountModal() {
    const modal = document.getElementById('pos-discount-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.innerHTML = this.renderDiscountModal();
  },

  hideDiscountModal() {
    const modal = document.getElementById('pos-discount-modal');
    if (modal) modal.classList.add('hidden');
  },

  renderDiscountModal() {
    const t = Nawa.I18n.t;
    const presets = (this.state.discountPresets || []).filter(d => d.active !== false);
    const isAr = (Nawa.I18n.getLang() === 'ar');
    let html = '<div class="modal pos-discount-modal">';
    html += '<div class="modal-header"><h3>' + t('discount_apply') + '</h3>';
    html += '<button class="btn btn-ghost btn-icon" id="pos-discount-modal-close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>';
    html += '<div class="modal-body">';
    if (presets.length > 0) {
      html += '<div style="margin-bottom:16px;">';
      html += '<label class="form-label">' + t('discount_presets') + '</label>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:8px;">';
      presets.forEach(function (d) {
        const typeIcon = d.type === 'percent' ? '%' : ' ل.س';
        html += '<button class="btn pos-discount-preset-btn" data-discount-preset="' + encodeURIComponent(JSON.stringify({ name: d.name, type: d.type, value: d.value })) + '" style="padding:12px;border:2px solid var(--border);border-radius:10px;background:var(--card);cursor:pointer;text-align:center;font-weight:700;display:flex;flex-direction:column;align-items:center;gap:4px;">';
        html += '<span style="font-size:1.25rem;">' + this._escapeHtml(d.name) + '</span>';
        html += '<span style="font-size:0.875rem;color:var(--navy);">' + d.value + typeIcon + '</span>';
        html += '</button>';
      });
      html += '</div></div>';
    }
    html += '<div style="border-top:1px solid var(--border);padding-top:16px;">';
    html += '<label class="form-label">' + t('discount_apply') + ' (' + (isAr ? 'مخصص' : 'Custom') + ')</label>';
    html += '<div style="display:flex;gap:8px;margin-top:8px;">';
    html += '<select class="form-input" id="pos-disc-type" style="flex:1;"><option value="percent">' + t('discount_percent') + '</option><option value="fixed">' + t('discount_fixed') + '</option></select>';
    html += '<input type="number" class="form-input" id="pos-disc-value" placeholder="' + t('discount_value') + '" min="0" step="1" style="flex:1;">';
    html += '<button class="btn btn-primary" id="pos-disc-apply-custom">' + t('discount_apply') + '</button>';
    html += '</div></div>';
    html += '</div></div>';
    return html;
  },

  // ===========================
  // UTILITY
  // ===========================
  formatPrice(amount) {
    const num = parseFloat(amount) || 0;
    const isAr = (Nawa.I18n && Nawa.I18n.getLang) ? Nawa.I18n.getLang() === 'ar' : true;
    const currency = isAr ? 'ل.س' : 'SYP';
    return num.toFixed(2) + ' ' + currency;
  },

  showNotification(message, type) {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type || 'info'}`;

    const icons = {
      success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
      error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
      warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
    };

    toast.innerHTML = `${icons[type] || icons.info}<span>${this._escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  // ===========================
  // ORDER HISTORY
  // ===========================
  async showOrderHistory() {
    const modal = document.getElementById('pos-history-modal');
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.innerHTML = `
      <div class="modal pos-history-modal">
        <div class="modal-header">
          <h3>${Nawa.I18n.t('order_history')}</h3>
          <button class="btn btn-ghost btn-icon" data-action="close-history-modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="modal-body" style="padding:0;">
          <div class="pos-history-search" style="padding:12px 16px;border-bottom:1px solid var(--border);">
            <input type="text" class="form-input pos-history-search-input" placeholder="${Nawa.I18n.t('search_orders')}..." />
          </div>
          <div class="pos-history-list" id="pos-history-list">
            <div class="admin-loading" style="padding:40px;text-align:center;"><div class="spinner-lg"></div></div>
          </div>
        </div>
      </div>`;

    var self = this;
    var listEl = document.getElementById('pos-history-list');

    try {
      var res = await Nawa.Auth.apiFetch('/orders/history?limit=50');
      if (res.ok) {
        var orders = await res.json();
        self._orderHistoryData = orders;
        self._renderOrderHistoryList(listEl, orders);
      } else {
        listEl.innerHTML = '<div class="admin-empty"><div class="admin-empty-title">' + Nawa.I18n.t('error_generic') + '</div></div>';
      }
    } catch (e) {
      listEl.innerHTML = '<div class="admin-empty"><div class="admin-empty-title">' + Nawa.I18n.t('error_network') + '</div></div>';
    }

    var searchInput = modal.querySelector('.pos-history-search-input');
    if (searchInput) {
      var debounce;
      searchInput.addEventListener('input', function () {
        clearTimeout(debounce);
        debounce = setTimeout(function () {
          var term = searchInput.value.toLowerCase();
          var filtered = (self._orderHistoryData || []).filter(function (o) {
            var orderNum = o.id ? o.id.slice(-6).toUpperCase() : '';
            return orderNum.toLowerCase().indexOf(term) !== -1;
          });
          self._renderOrderHistoryList(listEl, filtered);
        }, 250);
      });
    }
  },

  _renderOrderHistoryList(container, orders) {
    if (!container) return;
    var self = this;
    var lang = Nawa.I18n.getLang();
    var t = Nawa.I18n.t;

    if (!orders || orders.length === 0) {
      container.innerHTML = '<div class="admin-empty" style="padding:40px;"><div class="admin-empty-title">' + t('no_orders_yet') + '</div></div>';
      return;
    }

    var html = '';
    orders.forEach(function (order) {
      var orderNum = order.id ? order.id.slice(-6).toUpperCase() : '------';
      var itemCount = order.items ? order.items.reduce(function (s, i) { return s + (i.quantity || 1); }, 0) : 0;
      var statusClass = order.status === 'paid' || order.status === 'completed' ? 'paid' : (order.status === 'cancelled' ? 'cancelled' : (order.status === 'held' ? 'held' : 'pending'));
      var statusLabel = order.status === 'paid' ? t('status_paid') : (order.status === 'completed' ? t('status_completed') : (order.status === 'cancelled' ? t('status_cancelled') : (order.status === 'held' ? t('status_held') : t('status_active'))));

      var tableName = order.tableId || t('none');
      var time = order.createdAt ? new Date(order.createdAt).toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '--';

      html += '<div class="pos-history-item" data-history-id="' + self._escapeHtml(order.id) + '">';
      html += '<div class="pos-history-item-left">';
      html += '<div class="pos-history-item-num">#' + orderNum + '</div>';
      html += '<div class="pos-history-item-meta">' + time + ' · ' + self._escapeHtml(tableName) + '</div>';
      html += '</div>';
      html += '<div class="pos-history-item-right">';
      html += '<div class="pos-history-item-total">' + self.formatPrice(order.total) + '</div>';
      html += '<div class="pos-history-item-info">' + itemCount + ' ' + t('order_items_count') + ' · <span class="admin-order-status ' + statusClass + '" style="font-size:0.7rem;padding:2px 6px;"><span class="admin-order-status-dot"></span>' + statusLabel + '</span></div>';
      html += '</div>';
      html += '</div>';
    });

    container.innerHTML = html;

    container.querySelectorAll('.pos-history-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var id = item.getAttribute('data-history-id');
        var order = (self._orderHistoryData || []).find(function (o) { return o.id === id; });
        if (order) self._showOrderHistoryDetail(order);
      });
    });
  },

  _showOrderHistoryDetail(order) {
    var self = this;
    var lang = Nawa.I18n.getLang();
    var t = Nawa.I18n.t;
    var orderNum = order.id ? order.id.slice(-6).toUpperCase() : '------';
    var date = order.createdAt ? new Date(order.createdAt).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US') : '--';

    var rows = (order.items || []).map(function (item) {
      var name = lang === 'ar' ? (item.name || item.nameEn) : (item.nameEn || item.name);
      var noteHtml = item.notes ? '<div style="font-size:0.6875rem;color:#888;font-style:italic;margin-top:2px;">↳ ' + self._escapeHtml(item.notes) + '</div>' : '';
      return '<div class="pos-history-detail-row"><span>' + self._escapeHtml(name || t('item')) + noteHtml + '</span><span>× ' + (item.quantity || 1) + '</span><span>' + self.formatPrice((item.price || 0) * (item.quantity || 1)) + '</span></div>';
    }).join('');

    var modal = document.getElementById('pos-history-modal');
    if (!modal) return;

    modal.innerHTML = `
      <div class="modal pos-history-modal">
        <div class="modal-header">
          <h3>${t('order_detail')} #${orderNum}</h3>
          <button class="btn btn-ghost btn-icon" data-action="close-history-modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="pos-history-detail-meta">
            <div><strong>${t('date')}:</strong> ${date}</div>
            <div><strong>${t('order_table')}:</strong> ${self._escapeHtml(order.tableId || t('none'))}</div>
            <div><strong>${t('payment_method')}:</strong> ${order.paymentMethod === 'card' ? t('credit_card') : t('cash')}</div>
          </div>
          <div class="pos-history-detail-items">${rows}</div>
          <div class="pos-history-detail-totals">
            ${order.discountAmount > 0 ? '<div class="pos-cart-row" style="color:#16a34a;"><span>' + t('discount') + ': ' + self._escapeHtml(order.discountName || '') + '</span><span>-' + self.formatPrice(order.discountAmount) + '</span></div>' : ''}
            <div class="pos-cart-row pos-cart-total"><span>${t('total')}</span><span>${self.formatPrice(order.total)}</span></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-action="close-history-modal">${t('close')}</button>
        </div>
      </div>`;
  },

  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  },

  _escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(str).replace(/[&<>"']/g, c => map[c]);
  },

  _getTableLabel(table) {
    if (!table) return '';
    const label = table.name || table.number || table.id;
    return this._escapeHtml(String(label));
  },

  _getTableLabelById(tableId) {
    const table = this.state.tables.find(t => String(t.id) === String(tableId));
    return table ? this._getTableLabel(table) : tableId;
  },

  _animateAddToCart(productId) {
    const card = document.querySelector(`[data-product-id="${productId}"]`);
    if (!card) return;

    card.style.transform = 'scale(0.95)';
    card.style.transition = 'transform 0.15s ease';
    setTimeout(() => {
      card.style.transform = 'scale(1)';
    }, 150);
  },

  async _updateTableStatus(tableId, status, orderId) {
    const table = this.state.tables.find(t => String(t.id) === String(tableId));
    if (!table) return;

    try {
      await Nawa.DB.update(Nawa.CONFIG.STORES.TABLES, tableId, { status, orderId: orderId || null });
      try { Nawa.Auth.apiFetch('/tables/' + tableId, { method: 'PUT', body: { status, orderId: orderId || null } }); } catch (e) { console.warn('Table sync failed:', e); }
      const idx = this.state.tables.findIndex(t => String(t.id) === String(tableId));
      if (idx !== -1) {
        this.state.tables[idx].status = status;
        this.state.tables[idx].orderId = orderId || null;
      }
    } catch (e) {
      // silent fail on table status update
    }
  },

  async _findHeldOrderForTable(tableId) {
    try {
      const orders = await Nawa.DB.getAll(Nawa.CONFIG.STORES.ORDERS) || [];
      return orders.find(o => String(o.tableId) === String(tableId) && o.status === 'held') || null;
    } catch (e) {
      return null;
    }
  },

  async _findActiveOrderForTable(tableId) {
    try {
      const orders = await Nawa.DB.getAll(Nawa.CONFIG.STORES.ORDERS) || [];
      return orders.find(o => String(o.tableId) === String(tableId) && (o.status === 'active' || o.status === 'pending')) || null;
    } catch (e) {
      return null;
    }
  }
};
