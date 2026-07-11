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
    orders: []
  },

  TAX_RATE: 0.15,
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
      this._loadOrders()
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
            return { id: t.id, number: t.number, name: t.name, seats: t.seats, floorId: t.floorId, status: t.status };
          });
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
          for (var i = 0; i < self.state.floors.length; i++) {
            try { await DB.add(S.FLOORS, self.state.floors[i]); } catch (e) {}
          }
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
        this.state.attendanceRecord = data;
      }
    } catch (e) {}
  },

  async _clockIn() {
    if (!Nawa.Auth || !Nawa.Auth.apiFetch) return;
    try {
      var res = await Nawa.Auth.apiFetch('/attendance/clock-in', { method: 'POST' });
      if (res.ok) {
        var data = await res.json();
        this.state.attendanceRecord = data;
        this.render();
        this._showToast(Nawa.I18n.t('clock_in_success'), 'success');
      }
    } catch (e) {}
  },

  async _clockOut() {
    if (!Nawa.Auth || !Nawa.Auth.apiFetch || !this.state.attendanceRecord) return;
    var self = this;
    try {
      var res = await Nawa.Auth.apiFetch('/attendance/' + this.state.attendanceRecord.id + '/clock-out', { method: 'PUT' });
      if (res.ok) {
        this._showToast(Nawa.I18n.t('clock_out_success'), 'success');
        setTimeout(function () {
          Nawa.Auth.logout();
          window.location.hash = '#/login';
        }, 1500);
      }
    } catch (e) {}
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
    if (!rec) {
      return '<button class="btn btn-success btn-sm" id="pos-clock-in" style="margin-left:8px;padding:4px 12px;font-size:0.8125rem;font-weight:600;border-radius:8px;display:flex;align-items:center;gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' + t('clock_in') + '</button>';
    }
    if (!rec.clockOut) {
      var time = rec.clockIn ? new Date(rec.clockIn).toLocaleTimeString(Nawa.I18n.getLang() === 'ar' ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '';
      return '<span style="margin-left:8px;display:flex;align-items:center;gap:6px;font-size:0.8125rem;color:#22c55e;font-weight:600;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' + t('clocked_in_at') + ' ' + time + ' <button class="btn btn-danger btn-sm" id="pos-clock-out" style="padding:2px 10px;font-size:0.75rem;border-radius:6px;">' + t('clock_out') + '</button></span>';
    }
    return '<span style="margin-left:8px;display:flex;align-items:center;gap:4px;font-size:0.8125rem;color:var(--text-secondary);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' + t('clock_out') + '</span>';
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
    `;
  },

  renderHeader() {
    const emp = this.state.employee;
    const tableName = this.state.currentTable
      ? this._getTableLabel(this.state.currentTable)
      : Nawa.I18n.t('table');
    const lang = Nawa.I18n.getLang();

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
        </div>
        <div class="pos-header-left">
          <span class="pos-employee-name">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            ${emp ? this._escapeHtml(emp.name || emp.username || '') : ''}
          </span>
          ${this._renderAttendanceBtn()}
          <button class="btn btn-ghost btn-icon" id="pos-lang-toggle" title="${Nawa.I18n.t('language')}">
            ${lang === 'ar' ? 'EN' : 'عربي'}
          </button>
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
      return `
        <div class="pos-cart-item" data-cart-index="${index}">
          <div class="pos-cart-item-info">
            <span class="pos-cart-item-name">${this._escapeHtml(name)}</span>
            <span class="pos-cart-item-unit-price">${this.formatPrice(item.price)}</span>
          </div>
          <div class="pos-cart-item-controls">
            <button class="pos-qty-btn pos-qty-minus" data-action="minus" data-index="${index}">−</button>
            <span class="pos-qty-value">${item.quantity}</span>
            <button class="pos-qty-btn pos-qty-plus" data-action="plus" data-index="${index}">+</button>
          </div>
          <div class="pos-cart-item-subtotal">${this.formatPrice(item.subtotal)}</div>
          <button class="pos-cart-item-remove" data-action="remove" data-index="${index}" title="${Nawa.I18n.t('delete')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
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
            <span>${Nawa.I18n.t('tax')} (15%)</span>
            <span id="pos-tax">${this.formatPrice(tax)}</span>
          </div>
          <div class="pos-cart-row pos-cart-total">
            <span>${Nawa.I18n.t('total')}</span>
            <span id="pos-total">${this.formatPrice(total)}</span>
          </div>
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
    const floorId = this.state.currentFloor;
    const tables = this.state.tables.filter(t => t.floorId === floorId);
    const currentTableId = this.state.currentTable;

    if (tables.length === 0) {
      return `
        <div class="modal">
          <div class="modal-header">
            <h3>${Nawa.I18n.t('table')}</h3>
            <button class="btn btn-ghost btn-icon pos-modal-close" data-action="close-table-modal">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          <div class="modal-body" style="text-align:center;padding:40px;color:var(--text-muted);">
            ${Nawa.I18n.t('no_data')}
          </div>
        </div>`;
    }

    const tableCards = tables.map(table => {
      const isSelected = currentTableId === table.id;
      const isOccupied = table.status === 'occupied';
      const label = table.name || table.number || table.id;
      let statusClass = 'pos-table-free';
      if (isOccupied) statusClass = 'pos-table-occupied';
      if (isSelected) statusClass = 'pos-table-selected';

      return `
        <div class="pos-table-card ${statusClass}" data-table-id="${table.id}" data-action="select-table">
          <span class="pos-table-number">${this._escapeHtml(String(label))}</span>
          <span class="pos-table-capacity">${table.capacity || ''}</span>
          <span class="pos-table-status-text">${isOccupied ? Nawa.I18n.t('occupied') : Nawa.I18n.t('available')}</span>
        </div>`;
    }).join('');

    return `
      <div class="modal">
        <div class="modal-header">
          <h3>${Nawa.I18n.t('table')}</h3>
          <button class="btn btn-ghost btn-icon pos-modal-close" data-action="close-table-modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="pos-table-grid">
            ${tableCards}
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
        subtotal: product.price || 0
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
    this.render();
    this.showNotification(Nawa.I18n.t('cart_cleared'), 'info');
  },

  getCartTotal() {
    const subtotal = this.state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = subtotal * this.TAX_RATE;
    const total = subtotal + tax;
    return { subtotal, tax, total };
  },

  // ===========================
  // ORDER OPERATIONS
  // ===========================
  async holdOrder() {
    if (this.state.cart.length === 0) return;

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
      status: 'held',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await Nawa.DB.add(Nawa.CONFIG.STORES.ORDERS, order);
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
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await Nawa.DB.add(Nawa.CONFIG.STORES.ORDERS, order);

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

    const { subtotal, tax, total } = this.getCartTotal();
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
              <span>${Nawa.I18n.t('tax')} (15%)</span>
              <span>${this.formatPrice(tax)}</span>
            </div>
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
        <div class="modal-footer">
          <button class="btn btn-ghost" data-action="close-payment-modal">${Nawa.I18n.t('cancel')}</button>
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

    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        const received = parseFloat(amountInput.value) || 0;
        if (received < total) return;

        const order = {
          id: this._generateId(),
          items: JSON.parse(JSON.stringify(this.state.cart)),
          subtotal,
          tax,
          total,
          note: this.state.orderNote,
          amountReceived: received,
          change: received - total,
          paymentMethod: 'cash',
          tableId: this.state.currentTable || null,
          floorId: this.state.currentFloor || null,
          employeeId: this.state.employee ? (this.state.employee.id || this.state.employee.username) : null,
          status: 'paid',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        try {
          await Nawa.DB.add(Nawa.CONFIG.STORES.ORDERS, order);

          if (this.state.currentTable) {
            await this._updateTableStatus(this.state.currentTable, 'available', null);
          }

          await Nawa.Audit.log('payment_processed', Nawa.CONFIG.STORES.ORDERS, order.id, { tableId: order.tableId, total: order.total, amountReceived: received, change: received - total, paymentMethod: 'cash' });

          modal.classList.add('hidden');
          this.generateReceipt(order);
          this.state.cart = [];
          this.state.orderNote = '';
          this.state.currentTable = null;
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
      return `
        <tr>
          <td>${this._escapeHtml(name)}</td>
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
                <span>${Nawa.I18n.t('tax')} (15%)</span>
                <span>${this.formatPrice(order.tax)}</span>
              </div>
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
    const interval = Nawa.CONFIG.SYNC_INTERVAL || 300000;
    this._syncTimer = setInterval(() => this.syncToServer(), interval);
  },

  // ===========================
  // EVENT LISTENERS
  // ===========================
  _setupEventListeners() {
    const app = document.getElementById('app');
    if (!app) return;

    app.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action], [data-product-id], [data-category-id], [data-floor-id], [data-cart-index]');
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
        const pm = document.getElementById('pos-payment-modal');
        if (pm) pm.classList.add('hidden');
        return;
      }
      if (action === 'close-receipt-modal') {
        const rm = document.getElementById('pos-receipt-modal');
        if (rm) rm.classList.add('hidden');
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
        if (e.target.closest('#pos-pay-btn')) {
          this.processPayment();
          return;
        }
        if (e.target.closest('#pos-clock-in')) {
          this._clockIn();
          return;
        }
        if (e.target.closest('#pos-clock-out')) {
          this._clockOut();
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
    });

    // Keyboard shortcut: Escape to close modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideTableModal();
        const pm = document.getElementById('pos-payment-modal');
        if (pm) pm.classList.add('hidden');
        const rm = document.getElementById('pos-receipt-modal');
        if (rm) rm.classList.add('hidden');
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
