(function () {
  var DB = window.Nawa.DB;
  var CFG = window.Nawa.CONFIG;
  var S = CFG.STORES;

  var Admin = {
    _escapeHtml: function (str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    },

    state: {
      orders: [],
      tables: [],
      employees: [],
      auditEntries: [],
      settings: {},
      stats: { totalSales: 0, totalOrders: 0, avgOrder: 0, activeTables: 0, topProducts: [] },
      dateRange: { from: null, to: null },
      activeTab: 'dashboard',
      auditPage: 1,
      auditPerPage: 20,
      auditFilters: { user: '', action: '', search: '', dateFrom: '', dateTo: '' },
      sidebarOpen: false,
      dsActiveTab: 'products',
      dsModal: { open: false, type: '', editId: null },
      dailyReport: null,
      dailyReportDate: new Date().toISOString().split('T')[0],
      dailyReportLoading: false,
      products: [],
      categories: [],
      floors: [],
      discounts: [],
      attendance: [],
      orderHistory: [],
      orderHistoryLoading: false,
      orderHistoryFilters: { from: '', to: '' },
      orderHistorySearch: '',
      orderHistoryExpanded: null,
      customers: [],
      customersLoading: false,
      customerModal: { open: false, editId: null }
    },

    async init() {
      if (window.Nawa.Auth && window.Nawa.Auth.requireAuth) {
        var user = window.Nawa.Auth.requireAuth('admin');
        if (!user) return;
      }
      await this.loadData();
      this.render();
    },

    async loadData() {
      try {
        const apiData = {};
        const apiEndpoints = [
          { key: 'orders', path: '/orders' },
          { key: 'products', path: '/products' },
          { key: 'categories', path: '/categories' },
          { key: 'tables', path: '/tables' },
          { key: 'floors', path: '/floors' },
          { key: 'employees', path: '/employees' }
        ];

        for (const ep of apiEndpoints) {
          try {
            const res = await Nawa.Auth.apiFetch(ep.path);
            if (res.ok) {
              apiData[ep.key] = await res.json();
            }
          } catch (e) { /* fall through to IndexedDB */ }
        }

        var S = Nawa.CONFIG.STORES;
        var DB = Nawa.DB;

        this.state.orders = apiData.orders || await DB.getAll(S.ORDERS) || [];
        this.state.products = apiData.products || await DB.getAll(S.PRODUCTS) || [];
        this.state.categories = apiData.categories || await DB.getAll(S.CATEGORIES) || [];
        this.state.tables = apiData.tables || await DB.getAll(S.TABLES) || [];
        this.state.floors = apiData.floors || await DB.getAll(S.FLOORS) || [];
        this.state.employees = apiData.employees || await DB.getAll(S.EMPLOYEES) || [];
        this.state.auditEntries = await DB.getAll(S.AUDIT_LOG) || [];

        var settingsArr = await DB.getAll(S.SETTINGS);
        var settings = {};
        settingsArr.forEach(function (s) { settings[s.key] = s.value; });
        this.state.settings = settings;

        this.calculateStats();

        try {
          var discRes = await Nawa.Auth.apiFetch('/discounts');
          if (discRes.ok) { this.state.discounts = await discRes.json(); }
        } catch (e) {}
        this.state.discounts = this.state.discounts || [];

        try {
          var attRes = await Nawa.Auth.apiFetch('/attendance');
          if (attRes.ok) { this.state.attendance = await attRes.json(); }
        } catch (e) {}
        this.state.attendance = this.state.attendance || [];

        try {
          var custRes = await Nawa.Auth.apiFetch('/customers');
          if (custRes.ok) { this.state.customers = await custRes.json(); }
        } catch (e) {}
        this.state.customers = this.state.customers || [];

        try {
          var restRes = await Nawa.Auth.apiFetch('/restaurant');
          if (restRes.ok) { var restData = await restRes.json(); this.state.settings.plan = restData.plan || 'basic'; }
        } catch (e) {}
      } catch (e) {
        this.showNotification(Nawa.I18n.t('error_generic'), 'error');
      }
    },

    async saveDashboardSettings() {
      var self = this;
      var settingsToSave = [];

      document.querySelectorAll('.ds-toggle').forEach(function (el) {
        settingsToSave.push({ key: el.getAttribute('data-key'), value: el.checked });
      });
      document.querySelectorAll('.ds-number').forEach(function (el) {
        settingsToSave.push({ key: el.getAttribute('data-key'), value: parseFloat(el.value) || 0 });
      });
      document.querySelectorAll('.ds-text').forEach(function (el) {
        settingsToSave.push({ key: el.getAttribute('data-key'), value: el.value || '' });
      });
      document.querySelectorAll('.ds-time').forEach(function (el) {
        settingsToSave.push({ key: el.getAttribute('data-key'), value: el.value || '' });
      });
      document.querySelectorAll('.ds-select').forEach(function (el) {
        settingsToSave.push({ key: el.getAttribute('data-key'), value: el.value || '' });
      });

      var ops = settingsToSave.map(function (s) {
        return DB.getAll(S.SETTINGS).then(function (existing) {
          var found = null;
          for (var i = 0; i < existing.length; i++) {
            if (existing[i].key === s.key) { found = existing[i]; break; }
          }
          if (found) {
            return DB.update(S.SETTINGS, found.id, { value: s.value });
          } else {
            return DB.add(S.SETTINGS, { key: s.key, value: s.value });
          }
        });
      });

      try {
        await Promise.all(ops);
        settingsToSave.forEach(function (s) { self.state.settings[s.key] = s.value; });
        this.showNotification(Nawa.I18n.t('ds_saved'), 'success');
      } catch (e) {
        this.showNotification(Nawa.I18n.t('error_generic'), 'error');
      }
    },

    calculateStats() {
      var orders = this.state.orders.filter(function (o) { return o.status === 'paid' || o.status === 'completed'; });
      var totalSales = 0;
      var totalOrders = orders.length;
      var productCount = {};

      orders.forEach(function (o) {
        totalSales += o.total || 0;
        if (o.items) {
          o.items.forEach(function (item) {
            var name = item.name || Nawa.I18n.t('product');
            productCount[name] = (productCount[name] || 0) + (item.qty || 1);
          });
        }
      });

      var sorted = Object.keys(productCount).map(function (name) {
        return { name: name, count: productCount[name] };
      }).sort(function (a, b) { return b.count - a.count; });

      var activeTables = this.state.tables.filter(function (t) {
        return t.status === 'occupied' || t.status === 'busy';
      }).length;

      this.state.stats = {
        totalSales: totalSales,
        totalOrders: totalOrders,
        avgOrder: totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0,
        activeTables: activeTables,
        topProducts: sorted.slice(0, 5)
      };
    },

    formatCurrency(amount) {
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;
      var currency = isAr ? 'ل.س' : 'SYP';
      return Number(amount || 0).toLocaleString(isAr ? 'ar-SA' : 'en-US') + ' ' + currency;
    },

    formatNumber(n) {
      return Number(n || 0).toLocaleString('ar-SA');
    },

    formatTime(iso) {
      if (!iso) return '--';
      var d = new Date(iso);
      var h = d.getHours().toString().padStart(2, '0');
      var m = d.getMinutes().toString().padStart(2, '0');
      return h + ':' + m;
    },

    formatDate(iso) {
      if (!iso) return '--';
      var d = new Date(iso);
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;
      return d.toLocaleDateString(isAr ? 'ar-SA' : 'en-US');
    },

    getArabicAction(action) {
      var t = Nawa.I18n.t;
      var map = {
        'add': t('action_add'), 'create': t('action_add'),
        'edit': t('action_edit'), 'update': t('action_edit'),
        'delete': t('action_delete'),
        'payment': t('action_payment'), 'pay': t('action_payment'),
        'auth': t('action_auth'), 'login': t('action_login'), 'logout': t('action_logout')
      };
      return map[action] || action || t('action_default');
    },

    getActionClass(action) {
      var map = {
        'add': 'action-add',
        'create': 'action-add',
        'edit': 'action-edit',
        'update': 'action-edit',
        'delete': 'action-delete',
        'payment': 'action-payment',
        'pay': 'action-payment',
        'auth': 'action-auth',
        'login': 'action-auth',
        'logout': 'action-auth'
      };
      return map[action] || 'action-edit';
    },

    getArabicStore(store) {
      var t = Nawa.I18n.t;
      var map = {
        'products': t('store_products'), 'orders': t('store_orders'),
        'tables': t('store_tables'), 'employees': t('store_employees'),
        'categories': t('store_categories'), 'settings': t('store_settings'),
        'customers': t('store_customers'), 'audit_log': t('store_audit_log'), 'floors': t('store_floors')
      };
      return map[store] || store;
    },

    render() {
      var app = document.getElementById('app');
      if (!app) return;

      var html = '<div class="admin-layout">';
      html += this.renderSidebar();
      html += '<div class="admin-main">';
      html += this.renderMobileToggle();
      html += this.renderOverlay();
      html += this.renderTopbar();

      switch (this.state.activeTab) {
        case 'dashboard': html += this.renderDashboard(); break;
        case 'audit': html += this.renderAuditLog(); break;
        case 'daily-report': html += this.renderDailyReport(); break;
        case 'cash-drawer': html += this.renderCashDrawer(); break;
        case 'employees': html += this.renderEmployees(); break;
        case 'customers': html += this.renderCustomers(); break;
        case 'order-history': html += this.renderOrderHistory(); break;
        case 'dashboard-settings': html += this.renderDashboardSettings(); break;
        case 'settings': html += this.renderSettings(); break;
      }

      html += '</div></div>';
      app.innerHTML = html;
      this.attachEvents();
    },

    renderSidebar() {
      var s = this.state;
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;
      var tabs = [
        { id: 'dashboard', label: isAr ? 'لوحة التحكم' : 'Dashboard', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' },
        { id: 'audit', label: isAr ? 'سجل التعديلات' : 'Audit Log', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>' },
        { id: 'daily-report', label: isAr ? 'التقرير اليومي' : 'Daily Report', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' },
        { id: 'cash-drawer', label: isAr ? 'الصندوق' : 'Cash Drawer', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="12" cy="15" r="1"/><line x1="6" y1="15" x2="8" y2="15"/><line x1="16" y1="15" x2="18" y2="15"/></svg>' },
        { id: 'employees', label: isAr ? 'الموظفين' : 'Employees', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>' },
        { id: 'customers', label: isAr ? 'العملاء' : 'Customers', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' },
        { id: 'order-history', label: isAr ? 'سجل الطلبات' : 'Order History', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' },
        { id: 'dashboard-settings', label: isAr ? 'تعديلات اللوحة' : 'Dashboard Mods', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/><path d="M14 9l3 0"/><path d="M14 15l3 0"/></svg>' },
        { id: 'settings', label: isAr ? 'الإعدادات' : 'Settings', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>' }
      ];

      var navLinks = '';
      tabs.forEach(function (tab) {
        var activeClass = s.activeTab === tab.id ? ' active' : '';
        navLinks += '<a href="#" class="admin-sidebar-link' + activeClass + '" data-tab="' + tab.id + '">' + tab.icon + '<span>' + tab.label + '</span></a>';
      });

      var html = '<nav class="admin-sidebar' + (s.sidebarOpen ? ' open' : '') + '">';
      html += '<div class="admin-sidebar-brand">';
      html += '<div class="admin-sidebar-brand-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div>';
      html += '<div class="admin-sidebar-brand-text">';
      html += '<div class="admin-sidebar-brand-name">' + CFG.APP_NAME + '</div>';
      html += '<div class="admin-sidebar-brand-sub">' + (isAr ? 'لوحة التحكم' : 'Dashboard') + '</div>';
      html += '</div></div>';

      html += '<div class="admin-sidebar-nav">';
      html += '<div class="admin-sidebar-section-title">' + (isAr ? 'القائمة الرئيسية' : 'Main Menu') + '</div>';
      html += navLinks;
      html += '</div>';
      html += '</nav>';
      return html;
    },

    renderMobileToggle() {
      return '<button class="admin-mobile-toggle" id="admin-mobile-toggle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>';
    },

    renderOverlay() {
      return '<div class="admin-sidebar-overlay' + (this.state.sidebarOpen ? ' visible' : '') + '" id="admin-overlay"></div>';
    },

    renderTopbar() {
      var titles = {
        dashboard: (window.Nawa.I18n.getLang() === 'ar') ? 'لوحة التحكم' : 'Dashboard',
        audit: (window.Nawa.I18n.getLang() === 'ar') ? 'سجل التعديلات' : 'Audit Log',
        'daily-report': (window.Nawa.I18n.getLang() === 'ar') ? 'التقرير اليومي' : 'Daily Report',
        employees: (window.Nawa.I18n.getLang() === 'ar') ? 'الموظفين' : 'Employees',
        customers: (window.Nawa.I18n.getLang() === 'ar') ? 'العملاء' : 'Customers',
        'order-history': (window.Nawa.I18n.getLang() === 'ar') ? 'سجل الطلبات' : 'Order History',
        'dashboard-settings': (window.Nawa.I18n.getLang() === 'ar') ? 'تعديلات اللوحة' : 'Dashboard Settings',
        settings: (window.Nawa.I18n.getLang() === 'ar') ? 'الإعدادات' : 'Settings'
      };
      var now = new Date();
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;
      var dateStr = now.toLocaleDateString(isAr ? 'ar-SA' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      var html = '<div class="admin-topbar">';
      html += '<h1 class="admin-topbar-title" data-print-date="' + dateStr + '">' + (titles[this.state.activeTab] || '') + '</h1>';
      html += '<div class="admin-topbar-actions">';
      html += '<span class="admin-topbar-date"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' + dateStr + '</span>';
      html += '</div></div>';
      return html;
    },

    renderDashboard() {
      var html = '';
      html += this.renderStats();
      html += this.renderCharts();
      html += this.renderRecentOrders();
      return html;
    },

    renderStats() {
      var st = this.state.stats;
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;
      var cards = [
        { value: this.formatCurrency(st.totalSales), label: isAr ? 'إجمالي المبيعات' : 'Total Sales', color: 'color-sales', icon: 'icon-sales', iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>' },
        { value: this.formatNumber(st.totalOrders), label: isAr ? 'إجمالي الطلبات' : 'Total Orders', color: 'color-orders', icon: 'icon-orders', iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>' },
        { value: this.formatCurrency(st.avgOrder), label: isAr ? 'متوسط قيمة الطلب' : 'Avg Order Value', color: 'color-avg', icon: 'icon-avg', iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>' },
        { value: this.formatNumber(st.activeTables), label: isAr ? 'الطاولات المشغولة' : 'Active Tables', color: 'color-tables', icon: 'icon-tables', iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="4" rx="1"/><path d="M4 11v8"/><path d="M20 11v8"/><path d="M9 4v3"/><path d="M15 4v3"/></svg>' },
        { value: this.formatNumber(this.state.employees.filter(function (e) { return e.isActive; }).length), label: isAr ? 'الموظفين النشطين' : 'Active Employees', color: 'color-employees', icon: 'icon-employees', iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>' },
        { value: this.formatNumber(st.topProducts.length > 0 ? st.topProducts[0].count : 0), label: isAr ? 'أكثر منتج مبيعاً' : 'Top Selling Product', color: 'color-products', icon: 'icon-products', iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>' }
      ];

      var html = '<div class="admin-stats-grid">';
      cards.forEach(function (c) {
        html += '<div class="admin-stat-card ' + c.color + '">';
        html += '<div class="admin-stat-icon ' + c.icon + '">' + c.iconSvg + '</div>';
        html += '<div class="admin-stat-info">';
        html += '<div class="admin-stat-value">' + c.value + '</div>';
        html += '<div class="admin-stat-label">' + c.label + '</div>';
        html += '</div></div>';
      });
      html += '</div>';
      return html;
    },

    renderCharts() {
      var html = '<div class="admin-charts-grid">';
      html += '<div class="admin-chart-card">' + this.renderSalesChart() + '</div>';
      html += '<div class="admin-chart-card">' + this.renderTopProducts() + '</div>';
      html += '<div class="admin-chart-card admin-chart-body-full">' + this.renderOrdersByHour() + '</div>';
      html += '<div class="admin-chart-card">' + this.renderPaymentDist() + '</div>';
      html += '</div>';
      return html;
    },

    renderSalesChart() {
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;
      var orders = this.state.orders.filter(function (o) { return o.status === 'paid' || o.status === 'completed'; });
      var days = [];
      var dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

      for (var i = 6; i >= 0; i--) {
        var d = new Date();
        d.setDate(d.getDate() - i);
        var key = d.toISOString().split('T')[0];
        days.push({ key: key, label: dayNames[d.getDay()], total: 0 });
      }

      orders.forEach(function (o) {
        if (!o.createdAt) return;
        var orderDate = o.createdAt.split('T')[0];
        for (var j = 0; j < days.length; j++) {
          if (days[j].key === orderDate) {
            days[j].total += o.total || 0;
          }
        }
      });

      var maxVal = Math.max.apply(null, days.map(function (d) { return d.total; }));
      if (maxVal === 0) maxVal = 100;

      var html = '<div class="admin-chart-header"><span class="admin-chart-title">' + (isAr ? 'المبيعات خلال آخر 7 أيام' : 'Sales - Last 7 Days') + '</span></div>';
      html += '<div class="admin-chart-body">';
      html += '<div class="admin-bar-chart">';

      var yLabels = [maxVal, Math.round(maxVal * 0.75), Math.round(maxVal * 0.5), Math.round(maxVal * 0.25), 0];
      html += '<div class="admin-bar-chart-y-axis">';
      yLabels.forEach(function (v) {
        html += '<span class="admin-bar-chart-y-label">' + (v >= 1000 ? Math.round(v / 1000) + 'ك' : v) + '</span>';
      });
      html += '</div>';

      html += '<div class="admin-bar-chart-bars">';
      days.forEach(function (day) {
        var pct = Math.max((day.total / maxVal) * 100, 2);
        html += '<div class="admin-bar-col">';
        html += '<div class="admin-bar" style="height:' + pct + '%">';
        html += '<span class="admin-bar-tooltip">' + day.total.toLocaleString('ar-SA') + ' ل.س</span>';
        html += '</div>';
        html += '<span class="admin-bar-label">' + day.label + '</span>';
        html += '</div>';
      });
      html += '</div></div></div>';
      return html;
    },

    renderOrdersByHour() {
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;
      var orders = this.state.orders;
      var hours = [];
      for (var h = 8; h <= 23; h++) {
        hours.push({ hour: h, label: h + ':00', count: 0 });
      }

      orders.forEach(function (o) {
        if (!o.createdAt) return;
        var hr = new Date(o.createdAt).getHours();
        for (var i = 0; i < hours.length; i++) {
          if (hours[i].hour === hr) {
            hours[i].count++;
          }
        }
      });

      var maxCount = Math.max.apply(null, hours.map(function (h) { return h.count; }));
      if (maxCount === 0) maxCount = 10;

      var html = '<div class="admin-chart-header"><span class="admin-chart-title">' + (isAr ? 'الطلبات حسب الساعة' : 'Orders by Hour') + '</span></div>';
      html += '<div class="admin-chart-body">';
      html += '<div class="admin-bar-chart">';

      var yLabels = [maxCount, Math.round(maxCount * 0.75), Math.round(maxCount * 0.5), Math.round(maxCount * 0.25), 0];
      html += '<div class="admin-bar-chart-y-axis">';
      yLabels.forEach(function (v) {
        html += '<span class="admin-bar-chart-y-label">' + v + '</span>';
      });
      html += '</div>';

      html += '<div class="admin-bar-chart-bars">';
      hours.forEach(function (h) {
        var pct = Math.max((h.count / maxCount) * 100, 2);
        html += '<div class="admin-bar-col">';
        html += '<div class="admin-bar" style="height:' + pct + '%;background:linear-gradient(to top,#3B82F6,#60A5FA)">';
        html += '<span class="admin-bar-tooltip">' + h.count + ' ' + (isAr ? 'طلب' : 'orders') + '</span>';
        html += '</div>';
        html += '<span class="admin-bar-label">' + h.label + '</span>';
        html += '</div>';
      });
      html += '</div></div></div>';
      return html;
    },

    renderTopProducts() {
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;
      var topProducts = this.state.stats.topProducts;
      var maxCount = topProducts.length > 0 ? topProducts[0].count : 1;

      var html = '<div class="admin-chart-header"><span class="admin-chart-title">' + (isAr ? 'أكثر المنتجات مبيعاً' : 'Top Selling Products') + '</span></div>';
      html += '<div class="admin-chart-body">';

      if (topProducts.length === 0) {
        html += '<div class="admin-empty"><div class="admin-empty-title">' + (isAr ? 'لا توجد بيانات' : 'No data') + '</div></div>';
      } else {
        html += '<div class="admin-hbar-chart">';
        topProducts.forEach(function (p) {
          var pct = Math.max((p.count / maxCount) * 100, 5);
          html += '<div class="admin-hbar-row">';
          html += '<span class="admin-hbar-name">' + Admin._escapeHtml(p.name) + '</span>';
          html += '<div class="admin-hbar-track">';
          html += '<div class="admin-hbar-fill" style="width:' + pct + '%"><span>' + p.count + '</span></div>';
          html += '</div>';
          html += '<span class="admin-hbar-count">' + p.count + '</span>';
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
      return html;
    },

    renderPaymentDist() {
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;
      var orders = this.state.orders.filter(function (o) { return o.status === 'paid' || o.status === 'completed'; });
      var cashCount = 0;
      var cardCount = 0;

      orders.forEach(function (o) {
        if (o.paymentMethod === 'card' || o.paymentMethod === 'credit') {
          cardCount++;
        } else {
          cashCount++;
        }
      });

      var total = cashCount + cardCount || 1;
      var cashPct = Math.round((cashCount / total) * 100);
      var cardPct = 100 - cashPct;

      var html = '<div class="admin-chart-header"><span class="admin-chart-title">' + (isAr ? 'طرق الدفع' : 'Payment Methods') + '</span></div>';
      html += '<div class="admin-chart-body">';
      html += '<div class="admin-payment-dist">';

      html += '<div class="admin-payment-row">';
      html += '<div class="admin-payment-icon cash"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></div>';
      html += '<div class="admin-payment-info"><div class="admin-payment-name">' + (isAr ? 'نقدي' : 'Cash') + '</div>';
      html += '<div class="admin-payment-bar"><div class="admin-payment-bar-fill cash" style="width:' + cashPct + '%"></div></div>';
      html += '</div><span class="admin-payment-pct">' + cashPct + '%</span></div>';

      html += '<div class="admin-payment-row">';
      html += '<div class="admin-payment-icon card"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div>';
      html += '<div class="admin-payment-info"><div class="admin-payment-name">' + (isAr ? 'بطاقة ائتمان' : 'Credit Card') + '</div>';
      html += '<div class="admin-payment-bar"><div class="admin-payment-bar-fill card" style="width:' + cardPct + '%"></div></div>';
      html += '</div><span class="admin-payment-pct">' + cardPct + '%</span></div>';

      html += '</div></div>';
      return html;
    },

    renderRecentOrders() {
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;
      var recent = this.state.orders.slice().sort(function (a, b) {
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      }).slice(0, 10);

      var html = '<div class="card">';
      html += '<div class="card-header"><span style="font-weight:700">' + (isAr ? 'آخر الطلبات' : 'Recent Orders') + '</span></div>';
      html += '<div class="table-wrapper">';

      if (recent.length === 0) {
        html += '<div class="admin-empty"><div class="admin-empty-title">' + (isAr ? 'لا توجد طلبات بعد' : 'No orders yet') + '</div><div class="admin-empty-desc">' + (isAr ? 'ستظهر الطلبات هنا بعد إتمامها' : 'Orders will appear here once completed') + '</div></div>';
      } else {
        html += '<table class="admin-recent-table"><thead><tr>';
        html += '<th>#</th><th>' + (isAr ? 'الوقت' : 'Time') + '</th><th>' + (isAr ? 'الطاولة' : 'Table') + '</th><th>' + (isAr ? 'عدد الأصناف' : 'Items') + '</th><th>' + (isAr ? 'الإجمالي' : 'Total') + '</th><th>' + (isAr ? 'الموظف' : 'Employee') + '</th><th>' + (isAr ? 'الحالة' : 'Status') + '</th>';
        html += '</tr></thead><tbody>';

        recent.forEach(function (order, i) {
          var itemCount = order.items ? order.items.length : 0;
          var empName = '--';
          var employees = Admin.state.employees;
          for (var e = 0; e < employees.length; e++) {
            if (employees[e].id === order.employeeId) {
              empName = employees[e].name;
              break;
            }
          }
          var statusClass = order.status === 'paid' || order.status === 'completed' ? 'paid' : (order.status === 'cancelled' ? 'cancelled' : 'pending');
          var statusLabel = order.status === 'paid' || order.status === 'completed' ? (isAr ? 'مدفوع' : 'Paid') : (order.status === 'cancelled' ? (isAr ? 'ملغي' : 'Cancelled') : (isAr ? 'معلق' : 'Pending'));

          html += '<tr>';
          html += '<td><span class="admin-order-clickable" data-order-id="' + order.id + '">' + order.id.slice(-6).toUpperCase() + '</span></td>';
          html += '<td>' + Admin.formatTime(order.createdAt) + '</td>';
          html += '<td>' + Admin._escapeHtml(order.tableNumber || order.tableId || '--') + '</td>';
          html += '<td>' + itemCount + '</td>';
          html += '<td style="font-weight:600">' + Admin.formatCurrency(order.total) + '</td>';
          html += '<td>' + Admin._escapeHtml(empName) + '</td>';
          html += '<td><span class="admin-order-status ' + statusClass + '"><span class="admin-order-status-dot"></span>' + statusLabel + '</span></td>';
          html += '</tr>';
        });
        html += '</tbody></table>';
      }

      html += '</div></div>';
      return html;
    },

    renderAuditLog() {
      var self = this;
      var t = Nawa.I18n.t;
      var filtered = this.getFilteredAudit();
      var totalPages = Math.ceil(filtered.length / this.state.auditPerPage) || 1;
      var page = Math.min(this.state.auditPage, totalPages);
      var start = (page - 1) * this.state.auditPerPage;
      var pageItems = filtered.slice(start, start + this.state.auditPerPage);

      var html = '<div class="admin-audit-section">';

      html += '<div class="admin-audit-toolbar">';

      html += '<div class="admin-date-range">';
      html += '<input type="date" class="form-input" id="audit-date-from" value="' + (this.state.auditFilters.dateFrom || '') + '" placeholder="' + t('from') + '...">';
      html += '<span class="admin-date-range-separator"> ' + t('to') + ' </span>';
      html += '<input type="date" class="form-input" id="audit-date-to" value="' + (this.state.auditFilters.dateTo || '') + '">';
      html += '</div>';

      var userOptions = '<option value="">' + (Nawa.I18n.getLang() === 'ar' ? 'جميع المستخدمين' : 'All Users') + '</option>';
      var seenUsers = {};
      this.state.auditEntries.forEach(function (e) {
        if (e.userId && !seenUsers[e.userId]) {
          seenUsers[e.userId] = true;
          userOptions += '<option value="' + Admin._escapeHtml(e.userId) + '">' + Admin._escapeHtml(e.userName || e.userId) + '</option>';
        }
      });
      html += '<select class="form-select" id="audit-user-filter">' + userOptions + '</select>';

      html += '<select class="form-select" id="audit-action-filter">';
      html += '<option value="">' + t('actions') + '</option>';
      html += '<option value="add">' + t('action_add') + '</option>';
      html += '<option value="edit">' + t('action_edit') + '</option>';
      html += '<option value="delete">' + t('action_delete') + '</option>';
      html += '<option value="payment">' + t('action_payment') + '</option>';
      html += '<option value="auth">' + t('action_auth') + '</option>';
      html += '</select>';

      html += '<div class="admin-audit-search">';
      html += '<input type="text" id="audit-search" placeholder="' + t('search') + '..." value="' + (this.state.auditFilters.search || '') + '">';
      html += '<svg class="admin-audit-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      html += '</div>';

      html += '<div class="admin-audit-actions">';
      html += '<button class="btn btn-sm btn-outline" id="audit-verify-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ' + t('verify_audit') + '</button>';
      html += '<button class="btn btn-sm btn-primary" id="audit-export-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ' + t('export') + ' CSV</button>';
      html += '</div>';
      html += '</div>';

      html += '<div id="audit-integrity-result"></div>';

      html += '<div class="admin-audit-table-wrapper">';
      if (pageItems.length === 0) {
        html += '<div class="admin-empty"><div class="admin-empty-title">' + t('no_records') + '</div><div class="admin-empty-desc">' + t('no_records_desc') + '</div></div>';
      } else {
        html += '<table class="admin-audit-table"><thead><tr>';
        html += '<th></th><th>' + t('date_time') + '</th><th>' + t('user') + '</th><th>' + t('action') + '</th><th>' + t('store') + '</th><th>' + t('details') + '</th><th>' + t('fingerprint') + '</th>';
        html += '</tr></thead><tbody>';

        pageItems.forEach(function (entry, idx) {
          var actionClass = self.getActionClass(entry.action);
          var actionLabel = self.getArabicAction(entry.action);
          var storeLabel = self.getArabicStore(entry.store);
          var recordDisplay = entry.recordId ? entry.recordId.slice(-8).toUpperCase() : '--';
          var hashDisplay = entry.hash ? entry.hash.slice(0, 12) + '...' : '--';
          var detailText = entry.details ? JSON.stringify(entry.details, null, 2) : t('no_details');

          html += '<tr>';
          html += '<td><button class="admin-audit-expand-btn" data-idx="' + idx + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button></td>';
          html += '<td style="white-space:nowrap">' + self.formatDate(entry.timestamp) + ' ' + self.formatTime(entry.timestamp) + '</td>';
          html += '<td>' + self._escapeHtml(entry.userName || entry.userId || '--') + '</td>';
          html += '<td><span class="admin-action-badge ' + actionClass + '">' + actionLabel + '</span></td>';
          html += '<td>' + self._escapeHtml(storeLabel) + ' - ' + self._escapeHtml(recordDisplay) + '</td>';
          html += '<td>' + self._escapeHtml(entry.details ? (typeof entry.details === 'string' ? entry.details.slice(0, 40) : Nawa.I18n.t('details')) : '--') + '</td>';
          html += '<td><span class="admin-audit-hash" title="' + self._escapeHtml(entry.hash || '') + '">' + self._escapeHtml(hashDisplay) + '</td>';
          html += '</tr>';

          html += '<tr class="admin-audit-detail-row" id="audit-detail-' + idx + '">';
          html += '<td colspan="7">';
          html += '<div class="admin-audit-detail-content">';
          html += '<div class="admin-audit-detail-label">' + t('record_details') + '</div>';
          html += '<pre>' + self._escapeHtml(detailText) + '</pre>';
          html += '</div></td></tr>';
        });

        html += '</tbody></table>';
      }

      html += '<div class="admin-audit-pagination">';
      html += '<span class="admin-audit-pagination-info">' + t('showing_records') + ' ' + (pageItems.length > 0 ? start + 1 : 0) + '-' + Math.min(start + this.state.auditPerPage, filtered.length) + ' ' + t('records_of') + ' ' + filtered.length + '</span>';
      html += '<div class="admin-audit-pagination-btns">';
      html += '<button class="admin-audit-page-btn" id="audit-page-prev"' + (page <= 1 ? ' disabled' : '') + '>&#8594;</button>';

      var startPage = Math.max(1, page - 2);
      var endPage = Math.min(totalPages, startPage + 4);
      for (var p = startPage; p <= endPage; p++) {
        html += '<button class="admin-audit-page-btn' + (p === page ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
      }

      html += '<button class="admin-audit-page-btn" id="audit-page-next"' + (page >= totalPages ? ' disabled' : '') + '>&#8592;</button>';
      html += '</div></div>';

      html += '</div>';
      html += '</div>';
      return html;
    },

    getFilteredAudit() {
      var self = this;
      var entries = this.state.auditEntries.slice();
      var f = this.state.auditFilters;

      if (f.dateFrom) {
        entries = entries.filter(function (e) {
          return e.timestamp && e.timestamp >= f.dateFrom;
        });
      }
      if (f.dateTo) {
        entries = entries.filter(function (e) {
          return e.timestamp && e.timestamp <= f.dateTo + 'T23:59:59';
        });
      }
      if (f.user) {
        entries = entries.filter(function (e) { return e.userId === f.user; });
      }
      if (f.action) {
        entries = entries.filter(function (e) { return e.action === f.action; });
      }
      if (f.search) {
        var term = f.search.toLowerCase();
        entries = entries.filter(function (e) {
          return (e.recordId && e.recordId.toLowerCase().indexOf(term) !== -1) ||
            (e.userName && e.userName.toLowerCase().indexOf(term) !== -1) ||
            (e.store && e.store.toLowerCase().indexOf(term) !== -1) ||
            (e.userId && e.userId.toLowerCase().indexOf(term) !== -1);
        });
      }

      entries.sort(function (a, b) {
        return (b.timestamp || '').localeCompare(a.timestamp || '');
      });

      return entries;
    },

    renderDailyReport() {
      var self = this;
      var t = Nawa.I18n.t;
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;
      var report = this.state.dailyReport;
      var loading = this.state.dailyReportLoading;
      var date = this.state.dailyReportDate;

      var html = '<div class="admin-daily-report" style="max-width:960px;margin:0 auto;">';

      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px;">';
      html += '<div style="display:flex;align-items:center;gap:12px;">';
      html += '<label style="font-weight:600;color:var(--navy,#0E1C3D);">' + t('date') + ':</label>';
      html += '<input type="date" class="form-input" id="daily-report-date" value="' + Admin._escapeHtml(date) + '" style="max-width:200px;">';
      html += '<button class="btn btn-primary btn-sm" id="daily-report-load" style="display:flex;align-items:center;gap:4px;">';
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> ' + (isAr ? 'عرض' : 'View');
      html += '</button>';
      html += '</div>';
      html += '<button class="btn btn-outline" id="daily-report-print" style="display:flex;align-items:center;gap:6px;"' + (!report ? ' disabled' : '') + '>';
      html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> ' + t('print_report');
      html += '</button>';
      html += '</div>';

      if (loading) {
        html += '<div class="admin-loading" style="text-align:center;padding:60px;"><div class="spinner-lg"></div><div style="margin-top:12px;color:var(--text-secondary,#6B7280);">' + t('loading') + '</div></div>';
      } else if (!report) {
        html += '<div class="admin-empty"><div class="admin-empty-title">' + (isAr ? 'اختر التاريخ واضغط عرض' : 'Select a date and click View') + '</div><div class="admin-empty-desc">' + t('daily_report_desc') + '</div></div>';
      } else {
        html += '<div class="admin-report-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px;">';
        html += '<div class="admin-stat-card color-sales" style="border-radius:12px;padding:20px;">';
        html += '<div style="font-size:0.8125rem;color:var(--text-secondary,#6B7280);margin-bottom:4px;">' + t('total_sales') + '</div>';
        html += '<div style="font-size:1.5rem;font-weight:700;color:var(--navy,#0E1C3D);">' + self.formatCurrency(report.totalSales) + '</div>';
        html += '</div>';
        html += '<div class="admin-stat-card color-orders" style="border-radius:12px;padding:20px;">';
        html += '<div style="font-size:0.8125rem;color:var(--text-secondary,#6B7280);margin-bottom:4px;">' + t('order_count') + '</div>';
        html += '<div style="font-size:1.5rem;font-weight:700;color:var(--navy,#0E1C3D);">' + self.formatNumber(report.orderCount) + '</div>';
        html += '</div>';
        html += '<div class="admin-stat-card color-avg" style="border-radius:12px;padding:20px;">';
        html += '<div style="font-size:0.8125rem;color:var(--text-secondary,#6B7280);margin-bottom:4px;">' + t('avg_order') + '</div>';
        html += '<div style="font-size:1.5rem;font-weight:700;color:var(--navy,#0E1C3D);">' + self.formatCurrency(report.avgOrderValue) + '</div>';
        html += '</div>';
        html += '</div>';

        var pb = report.paymentBreakdown || {};
        var pbTotal = (pb.cash || 0) + (pb.card || 0) + (pb.online || 0);
        if (pbTotal > 0) {
          html += '<div class="card" style="margin-bottom:24px;">';
          html += '<div class="card-header"><span style="font-weight:700;">' + t('payment_breakdown') + '</span></div>';
          html += '<div style="padding:16px;">';
          html += '<div class="admin-payment-dist">';

          var methods = [
            { key: 'cash', label: isAr ? 'نقدي' : 'Cash', color: '#22c55e' },
            { key: 'card', label: isAr ? 'بطاقة' : 'Card', color: '#3B82F6' },
            { key: 'online', label: isAr ? 'إلكتروني' : 'Online', color: '#8B5CF6' }
          ];

          methods.forEach(function (m) {
            var val = pb[m.key] || 0;
            if (val <= 0) return;
            var pct = Math.round((val / pbTotal) * 100);
            html += '<div class="admin-payment-row">';
            html += '<div class="admin-payment-icon" style="background:' + m.color + '20;color:' + m.color + ';">';
            html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>';
            html += '</div>';
            html += '<div class="admin-payment-info"><div class="admin-payment-name">' + m.label + '</div>';
            html += '<div class="admin-payment-bar"><div class="admin-payment-bar-fill" style="width:' + pct + '%;background:' + m.color + ';"></div></div>';
            html += '<div style="font-size:0.75rem;color:var(--text-secondary,#6B7280);margin-top:2px;">' + self.formatCurrency(val) + '</div>';
            html += '</div><span class="admin-payment-pct">' + pct + '%</span></div>';
          });

          html += '</div></div></div>';
        }

        if (report.topProducts && report.topProducts.length > 0) {
          html += '<div class="card" style="margin-bottom:24px;">';
          html += '<div class="card-header"><span style="font-weight:700;">' + t('top_products') + '</span></div>';
          html += '<div class="table-wrapper">';
          html += '<table class="admin-recent-table"><thead><tr>';
          html += '<th>#</th><th>' + (isAr ? 'المنتج' : 'Product') + '</th><th>' + (isAr ? 'الكمية' : 'Quantity') + '</th><th>' + (isAr ? 'الإجمالي' : 'Total') + '</th>';
          html += '</tr></thead><tbody>';
          report.topProducts.forEach(function (p, i) {
            html += '<tr>';
            html += '<td>' + (i + 1) + '</td>';
            html += '<td style="font-weight:600;">' + self._escapeHtml(p.name) + '</td>';
            html += '<td>' + self.formatNumber(p.quantity) + '</td>';
            html += '<td style="font-weight:600;">' + self.formatCurrency(p.total) + '</td>';
            html += '</tr>';
          });
          html += '</tbody></table>';
          html += '</div></div>';
        }

        if (report.cashierSummary && report.cashierSummary.length > 0) {
          html += '<div class="card" style="margin-bottom:24px;">';
          html += '<div class="card-header"><span style="font-weight:700;">' + t('cashier_summary') + '</span></div>';
          html += '<div class="table-wrapper">';
          html += '<table class="admin-recent-table"><thead><tr>';
          html += '<th>' + (isAr ? 'أمين الصندوق' : 'Cashier') + '</th><th>' + t('order_count') + '</th><th>' + t('total_sales') + '</th>';
          html += '</tr></thead><tbody>';
          report.cashierSummary.forEach(function (c) {
            html += '<tr>';
            html += '<td style="font-weight:600;">' + self._escapeHtml(c.name) + '</td>';
            html += '<td>' + self.formatNumber(c.orderCount) + '</td>';
            html += '<td style="font-weight:600;">' + self.formatCurrency(c.totalSales) + '</td>';
            html += '</tr>';
          });
          html += '</tbody></table>';
          html += '</div></div>';
        }

        if (report.orderCount === 0) {
          html += '<div class="admin-empty"><div class="admin-empty-title">' + (isAr ? 'لا توجد طلبات في هذا التاريخ' : 'No orders for this date') + '</div></div>';
        }
      }

      html += '</div>';
      return html;
    },

    async loadDailyReport() {
      var self = this;
      var dateInput = document.getElementById('daily-report-date');
      if (dateInput) this.state.dailyReportDate = dateInput.value;
      this.state.dailyReportLoading = true;
      this.render();

      try {
        var res = await Nawa.Auth.apiFetch('/reports/daily?date=' + encodeURIComponent(this.state.dailyReportDate));
        if (res.ok) {
          self.state.dailyReport = await res.json();
        } else {
          self.state.dailyReport = null;
          self.showNotification(Nawa.I18n.t('error_generic'), 'error');
        }
      } catch (e) {
        self.state.dailyReport = null;
        self.showNotification(Nawa.I18n.t('error_generic'), 'error');
      }

      this.state.dailyReportLoading = false;
      this.render();
    },

    printDailyReport() {
      var report = this.state.dailyReport;
      if (!report) return;
      var t = Nawa.I18n.t;
      var self = this;
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;

      var printHtml = '<!DOCTYPE html><html dir="' + (isAr ? 'rtl' : 'ltr') + '" lang="' + (isAr ? 'ar' : 'en') + '"><head><meta charset="UTF-8"><title>' + t('daily_report') + '</title>';
      printHtml += '<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:' + (isAr ? 'Tajawal' : 'Inter') + ',sans-serif;padding:20px;color:#1a1a1a;font-size:14px;}';
      printHtml += 'h1{text-align:center;margin-bottom:4px;font-size:1.5rem;}';
      printHtml += '.subtitle{text-align:center;color:#666;margin-bottom:20px;font-size:0.875rem;}';
      printHtml += '.cards{display:flex;gap:16px;margin-bottom:20px;justify-content:center;}';
      printHtml += '.card{flex:1;max-width:200px;border:1px solid #e5e7eb;border-radius:8px;padding:12px;text-align:center;}';
      printHtml += '.card-label{font-size:0.75rem;color:#666;margin-bottom:4px;}';
      printHtml += '.card-value{font-size:1.25rem;font-weight:700;}';
      printHtml += 'table{width:100%;border-collapse:collapse;margin-bottom:20px;}';
      printHtml += 'th,td{padding:8px 12px;text-align:' + (isAr ? 'right' : 'left') + ';border-bottom:1px solid #e5e7eb;}';
      printHtml += 'th{background:#f3f4f6;font-weight:600;font-size:0.8125rem;}';
      printHtml += 'td{font-size:0.875rem;}';
      printHtml += 'h2{font-size:1.1rem;margin-bottom:10px;color:#0E1C3D;}';
      printHtml += '.section{margin-bottom:20px;}';
      printHtml += '.footer{text-align:center;color:#999;font-size:0.75rem;margin-top:30px;border-top:1px solid #e5e7eb;padding-top:10px;}';
      printHtml += '.payment-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;}';
      printHtml += '@media print{body{padding:10px;}}</style></head><body>';

      printHtml += '<h1>' + (isAr ? 'التقرير اليومي' : 'Daily Report') + '</h1>';
      printHtml += '<div class="subtitle">' + report.date + '</div>';

      printHtml += '<div class="cards">';
      printHtml += '<div class="card"><div class="card-label">' + t('total_sales') + '</div><div class="card-value">' + self.formatCurrency(report.totalSales) + '</div></div>';
      printHtml += '<div class="card"><div class="card-label">' + t('order_count') + '</div><div class="card-value">' + self.formatNumber(report.orderCount) + '</div></div>';
      printHtml += '<div class="card"><div class="card-label">' + t('avg_order') + '</div><div class="card-value">' + self.formatCurrency(report.avgOrderValue) + '</div></div>';
      printHtml += '</div>';

      var pb = report.paymentBreakdown || {};
      var hasPayments = (pb.cash || 0) + (pb.card || 0) + (pb.online || 0) > 0;
      if (hasPayments) {
        printHtml += '<div class="section"><h2>' + t('payment_breakdown') + '</h2>';
        if (pb.cash) printHtml += '<div class="payment-row"><span>' + (isAr ? 'نقدي' : 'Cash') + '</span><span>' + self.formatCurrency(pb.cash) + '</span></div>';
        if (pb.card) printHtml += '<div class="payment-row"><span>' + (isAr ? 'بطاقة' : 'Card') + '</span><span>' + self.formatCurrency(pb.card) + '</span></div>';
        if (pb.online) printHtml += '<div class="payment-row"><span>' + (isAr ? 'إلكتروني' : 'Online') + '</span><span>' + self.formatCurrency(pb.online) + '</span></div>';
        printHtml += '</div>';
      }

      if (report.topProducts && report.topProducts.length > 0) {
        printHtml += '<div class="section"><h2>' + t('top_products') + '</h2>';
        printHtml += '<table><thead><tr><th>#</th><th>' + (isAr ? 'المنتج' : 'Product') + '</th><th>' + (isAr ? 'الكمية' : 'Qty') + '</th><th>' + (isAr ? 'الإجمالي' : 'Total') + '</th></tr></thead><tbody>';
        report.topProducts.forEach(function (p, i) {
          printHtml += '<tr><td>' + (i + 1) + '</td><td>' + self._escapeHtml(p.name) + '</td><td>' + p.quantity + '</td><td>' + self.formatCurrency(p.total) + '</td></tr>';
        });
        printHtml += '</tbody></table></div>';
      }

      if (report.cashierSummary && report.cashierSummary.length > 0) {
        printHtml += '<div class="section"><h2>' + t('cashier_summary') + '</h2>';
        printHtml += '<table><thead><tr><th>' + (isAr ? 'أمين الصندوق' : 'Cashier') + '</th><th>' + t('order_count') + '</th><th>' + t('total_sales') + '</th></tr></thead><tbody>';
        report.cashierSummary.forEach(function (c) {
          printHtml += '<tr><td>' + self._escapeHtml(c.name) + '</td><td>' + c.orderCount + '</td><td>' + self.formatCurrency(c.totalSales) + '</td></tr>';
        });
        printHtml += '</tbody></table></div>';
      }

      printHtml += '<div class="footer">' + (isAr ? 'تم طباعة هذا التقرير في' : 'Report printed on') + ' ' + new Date().toLocaleString(isAr ? 'ar-SA' : 'en-US') + '</div>';
      printHtml += '</body></html>';

      var printWindow = window.open('', '_blank', 'width=800,height=600');
      if (printWindow) {
        printWindow.document.write(printHtml);
        printWindow.document.close();
        setTimeout(function () { printWindow.print(); }, 500);
      }
    },

    renderCashDrawer() {
      var self = this;
      var isAr = Nawa.I18n.getLang() === 'ar';
      var html = '<div class="admin-employees">';
      html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;flex-wrap:wrap;">';
      html += '<h2 style="margin:0;font-size:1.25rem;font-weight:800;">' + (isAr ? 'سجل الصندوق' : 'Cash Drawer History') + '</h2>';
      html += '<input type="date" id="cd-date-filter" style="padding:8px 12px;border:2px solid #334155;border-radius:8px;background:#1a1a2e;color:#e2e8f0;font-size:0.8125rem;" value="' + new Date().toISOString().slice(0,10) + '">';
      html += '<button onclick="Nawa.Admin._loadCashDrawerHistory()" style="padding:8px 16px;background:#C9A84C;color:#0E1C3D;border:none;border-radius:8px;font-weight:700;cursor:pointer;">' + (isAr ? 'بحث' : 'Search') + '</button>';
      html += '</div>';
      html += '<div id="cd-history-list" style="display:flex;flex-direction:column;gap:12px;">';
      html += '<div style="text-align:center;padding:40px;color:#8A8F9B;">' + (isAr ? 'جاري التحميل...' : 'Loading...') + '</div>';
      html += '</div></div>';
      setTimeout(function () { self._loadCashDrawerHistory(); }, 100);
      return html;
    },

    async _loadCashDrawerHistory() {
      var isAr = Nawa.I18n.getLang() === 'ar';
      var dateEl = document.getElementById('cd-date-filter');
      var listEl = document.getElementById('cd-history-list');
      if (!listEl) return;
      var date = dateEl ? dateEl.value : new Date().toISOString().slice(0, 10);
      try {
        var res = await Nawa.Auth.apiFetch('/cash-drawer/history?date=' + date);
        var drawers = Array.isArray(res) ? res : [];
        if (!drawers.length) {
          listEl.innerHTML = '<div style="text-align:center;padding:40px;color:#8A8F9B;">' + (isAr ? 'لا توجد سجلات لهذا اليوم' : 'No records for this date') + '</div>';
          return;
        }
        var html = '';
        drawers.forEach(function (d) {
          var diff = (d.closingBalance !== null ? d.closingBalance : 0) - (d.expectedBalance || 0);
          var diffColor = diff === 0 ? '#22c55e' : (diff > 0 ? '#f59e0b' : '#ef4444');
          var statusBadge = d.isOpen
            ? '<span style="background:#16a34a;color:#fff;padding:2px 10px;border-radius:12px;font-size:0.75rem;font-weight:600;">' + (isAr ? 'مفتوح' : 'OPEN') + '</span>'
            : '<span style="background:#475569;color:#e2e8f0;padding:2px 10px;border-radius:12px;font-size:0.75rem;font-weight:600;">' + (isAr ? 'مغلق' : 'CLOSED') + '</span>';
          html += '<div style="background:#1a1a2e;border:2px solid #334155;border-radius:12px;padding:16px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:12px;align-items:center;">';
          html += '<div><div style="font-size:0.7rem;color:#8A8F9B;margin-bottom:2px;">' + (isAr ? 'الموظف' : 'Employee') + '</div><div style="font-weight:700;color:#e2e8f0;">' + (d.employeeName || '-') + '</div></div>';
          html += '<div><div style="font-size:0.7rem;color:#8A8F9B;margin-bottom:2px;">' + (isAr ? 'الافتتاحي' : 'Opening') + '</div><div style="font-weight:700;color:#C9A84C;">' + (d.openingBalance || 0).toLocaleString() + ' ل.س</div></div>';
          html += '<div><div style="font-size:0.7rem;color:#8A8F9B;margin-bottom:2px;">' + (isAr ? 'المتوقع' : 'Expected') + '</div><div style="font-weight:700;color:#e2e8f0;">' + (d.expectedBalance !== null ? d.expectedBalance.toLocaleString() : '-') + ' ل.س</div></div>';
          if (d.closingBalance !== null) {
            html += '<div><div style="font-size:0.7rem;color:#8A8F9B;margin-bottom:2px;">' + (isAr ? 'الفعلي' : 'Actual') + '</div><div style="font-weight:700;color:#e2e8f0;">' + d.closingBalance.toLocaleString() + ' ل.س</div><div style="font-size:0.75rem;color:' + diffColor + ';font-weight:700;">' + (diff >= 0 ? '+' : '') + diff.toLocaleString() + '</div></div>';
          } else {
            html += '<div><div style="font-size:0.7rem;color:#8A8F9B;margin-bottom:2px;">' + (isAr ? 'الفعلي' : 'Actual') + '</div><div style="color:#8A8F9B;">-</div></div>';
          }
          html += '<div>' + statusBadge + '</div>';
          html += '</div>';
        });
        listEl.innerHTML = html;
      } catch (e) {
        listEl.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;">' + (isAr ? 'خطأ في التحميل' : 'Failed to load') + '</div>';
      }
    },

    renderEmployees() {
      var self = this;
      var employees = this.state.employees;
      var orders = this.state.orders;
      var isAr = Nawa.I18n.getLang() === 'ar';

      var html = '<div class="admin-employees">';

      // Plan info
      var planLimits = { basic: 1, medium: 2, advanced: 3 };
      var user = Nawa.Auth.getCurrentUser();
      var currentPlan = (this.state.settings && this.state.settings.plan) || 'basic';
      var maxAdmins = planLimits[currentPlan] || 1;
      var currentAdmins = employees.filter(function (e) { return e.role === 'admin' && e.isActive; }).length;
      var planLabel = { basic: (isAr ? 'الأساسية' : 'Basic'), medium: (isAr ? 'المتوسطة' : 'Medium'), advanced: (isAr ? 'المتقدمة' : 'Advanced') };

      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">';
      html += '<h2 style="margin:0;font-size:1.2rem;font-weight:700;color:var(--navy,#0E1C3D);">' + Nawa.I18n.t('employees') + ' (' + employees.length + ')</h2>';
      html += '<div style="display:flex;align-items:center;gap:12px;">';
      html += '<span style="font-size:0.8125rem;color:var(--text-secondary,#6B7280);">' + (isAr ? 'الخطة' : 'Plan') + ': <strong>' + (planLabel[currentPlan] || currentPlan) + '</strong> (' + currentAdmins + '/' + maxAdmins + ' ' + (isAr ? 'مدراء' : 'Managers') + ')</span>';
      html += '<button class="btn btn-primary" id="add-employee-btn" style="display:flex;align-items:center;gap:6px;">';
      html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      html += Nawa.I18n.t('add_employee');
      html += '</button></div></div>';

      html += '<div class="admin-employees-grid">';

      if (employees.length === 0) {
        html += '<div class="admin-empty"><div class="admin-empty-title">' + Nawa.I18n.t('no_employees') + '</div></div>';
      }

      employees.forEach(function (emp) {
        var empOrders = orders.filter(function (o) { return o.employeeId === emp.id; });
        var paidOrders = empOrders.filter(function (o) { return o.status === 'paid' || o.status === 'completed'; });
        var empSales = 0;
        paidOrders.forEach(function (o) { empSales += o.total || 0; });
        var statusClass = emp.isActive ? 'active' : 'inactive';
        var statusLabel = emp.isActive ? Nawa.I18n.t('is_active') : Nawa.I18n.t('deactivate');
        var initial = (emp.name || Nawa.I18n.t('employee')).charAt(0);
        var roleLabel = emp.role === 'admin' ? Nawa.I18n.t('role_admin') : Nawa.I18n.t('role_cashier');

        html += '<div class="admin-employee-card">';
        html += '<div class="admin-employee-header">';
        html += '<div class="admin-employee-avatar">' + initial + '</div>';
        html += '<div class="admin-employee-info">';
        html += '<div class="admin-employee-name">' + self._escapeHtml(emp.name || emp.nameEn || '--');
        if (emp.isPrimary) html += ' <span style="font-size:0.75rem;background:#C9A84C;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;">' + (isAr ? 'المدير الرئيسي' : 'Primary') + '</span>';
        html += '</div>';
        html += '<div class="admin-employee-role">' + self._escapeHtml(roleLabel) + ' - @' + self._escapeHtml(emp.username || '') + '</div>';
        html += '</div>';
        html += '<span class="admin-employee-status ' + statusClass + '"><span class="admin-employee-status-dot"></span>' + statusLabel + '</span>';
        html += '</div>';

        html += '<div class="admin-employee-stats">';
        html += '<div class="admin-employee-stat"><div class="admin-employee-stat-value">' + self.formatNumber(paidOrders.length) + '</div><div class="admin-employee-stat-label">' + Nawa.I18n.t('completed_orders') + '</div></div>';
        html += '<div class="admin-employee-stat"><div class="admin-employee-stat-value">' + self.formatCurrency(empSales) + '</div><div class="admin-employee-stat-label">' + Nawa.I18n.t('total_sales') + '</div></div>';

        var todayAtts = (self.state.attendance || []).filter(function (a) { return a.employeeId === emp.id; }).sort(function (a, b) { return new Date(b.clockIn) - new Date(a.clockIn); });
        var todayRec = todayAtts[0];
        if (todayRec) {
          var inTime = new Date(todayRec.clockIn).toLocaleTimeString(isAr ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' });
          if (todayRec.clockOut) {
            var outTime = new Date(todayRec.clockOut).toLocaleTimeString(isAr ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' });
            html += '<div class="admin-employee-stat"><div class="admin-employee-stat-value" style="font-size:0.8125rem;display:flex;flex-direction:column;gap:2px;"><span style="color:#22c55e;">' + inTime + '</span><span style="color:#ef4444;">' + outTime + '</span></div><div class="admin-employee-stat-label">' + (isAr ? 'دخول / خروج' : 'In / Out') + '</div></div>';
          } else {
            html += '<div class="admin-employee-stat"><div class="admin-employee-stat-value" style="color:#22c55e;font-size:0.875rem;">' + inTime + '</div><div class="admin-employee-stat-label" style="color:#22c55e;">' + Nawa.I18n.t('clock_in') + '</div></div>';
          }
        }

        html += '</div>';

        html += '<div class="admin-employee-actions">';
        if (emp.isPrimary) {
          html += '<span style="font-size:0.8125rem;color:var(--text-secondary,#6B7280);font-style:italic;">' + (isAr ? 'لا يمكن تعديل الحساب الرئيسي' : 'Primary account - protected') + '</span>';
        } else {
          html += '<button class="btn btn-sm btn-outline" data-edit-emp="' + emp.id + '">' + Nawa.I18n.t('edit') + '</button> ';
          if (emp.isActive) {
            html += '<button class="btn btn-sm btn-danger" data-toggle-emp="' + emp.id + '">' + Nawa.I18n.t('deactivate') + '</button> ';
          } else {
            html += '<button class="btn btn-sm btn-success" data-toggle-emp="' + emp.id + '">' + Nawa.I18n.t('activate') + '</button> ';
          }
          html += '<button class="btn btn-sm btn-danger" data-delete-emp="' + emp.id + '" style="background:#dc2626;color:#fff;border:none;">' + Nawa.I18n.t('delete') + '</button>';
        }
        html += '</div>';
        html += '</div>';
      });

      html += '</div>';

      html += '<div class="modal-overlay hidden" id="employee-modal-overlay">';
      html += '<div class="modal">';
      html += '<div class="modal-header"><h3 id="employee-modal-title">' + Nawa.I18n.t('add_employee') + '</h3>';
      html += '<button class="btn btn-ghost btn-icon" id="employee-modal-close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
      html += '<div class="modal-body">';
      html += '<div id="employee-error" class="hidden" style="color:#ef4444;text-align:center;margin-bottom:12px;font-size:14px;"></div>';
      html += '<input type="hidden" id="emp-edit-id">';
      html += '<div class="form-group"><label>' + (isAr ? 'اسم المستخدم' : 'Username') + ' *</label>';
      html += '<input type="text" class="form-input" id="emp-username" placeholder="' + (isAr ? 'اسم المستخدم' : 'Username') + '" dir="ltr"></div>';
      html += '<div class="form-group"><label>' + Nawa.I18n.t('employee_name') + ' *</label>';
      html += '<input type="text" class="form-input" id="emp-name" placeholder="' + Nawa.I18n.t('employee_name') + '"></div>';
      html += '<div class="form-group"><label>' + Nawa.I18n.t('employee_password') + ' *</label>';
      html += '<input type="password" class="form-input" id="emp-password" placeholder="' + (isAr ? 'اتركه فارغاً عند التعديل' : 'Leave blank to keep current') + '" dir="ltr" autocomplete="off"></div>';
      html += '<div class="form-group"><label>' + Nawa.I18n.t('employee_role') + '</label>';
      html += '<select class="form-input" id="emp-role">';
      html += '<option value="cashier">' + Nawa.I18n.t('role_cashier') + '</option>';
      html += '<option value="admin">' + Nawa.I18n.t('role_admin') + '</option>';
      html += '</select></div>';
      html += '<div class="form-group" id="emp-email-group" style="display:none;"><label>' + (isAr ? 'البريد الإلكتروني' : 'Email') + '</label>';
      html += '<input type="email" class="form-input" id="emp-email" placeholder="email@example.com" dir="ltr"></div>';
      html += '</div>';
      html += '<div class="modal-footer">';
      html += '<button class="btn btn-ghost" id="employee-modal-cancel">' + Nawa.I18n.t('close_btn') + '</button>';
      html += '<button class="btn btn-primary" id="employee-modal-save">' + Nawa.I18n.t('save') + '</button>';
      html += '</div></div></div>';

      html += '</div>';
      return html;
    },

    renderCustomers() {
      var self = this;
      var customers = this.state.customers;
      var orders = this.state.orders;
      var isAr = Nawa.I18n.getLang() === 'ar';

      var html = '<div class="admin-customers">';

      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">';
      html += '<h2 style="margin:0;font-size:1.2rem;font-weight:700;color:var(--navy,#0E1C3D);">' + Nawa.I18n.t('customers') + ' (' + customers.length + ')</h2>';
      html += '<button class="btn btn-primary" id="add-customer-btn" style="display:flex;align-items:center;gap:6px;">';
      html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      html += Nawa.I18n.t('add_customer');
      html += '</button></div>';

      html += '<div class="admin-customers-grid">';

      if (customers.length === 0) {
        html += '<div class="admin-empty"><div class="admin-empty-title">' + (isAr ? 'لا يوجد عملاء بعد' : 'No customers yet') + '</div></div>';
      }

      customers.forEach(function (c) {
        var custOrders = orders.filter(function (o) { return o.customerId === c.id; });
        var paidOrders = custOrders.filter(function (o) { return o.status === 'paid' || o.status === 'completed'; });
        var totalSpent = 0;
        paidOrders.forEach(function (o) { totalSpent += o.total || 0; });
        var initial = (c.name || '').charAt(0) || '?';
        var lastVisit = c.updatedAt || c.createdAt;

        html += '<div class="admin-customer-card">';
        html += '<div class="admin-customer-header">';
        html += '<div class="admin-customer-avatar">' + self._escapeHtml(initial) + '</div>';
        html += '<div class="admin-customer-info">';
        html += '<div class="admin-customer-name">' + self._escapeHtml(c.name || '--') + '</div>';
        html += '<div class="admin-customer-phone">' + self._escapeHtml(c.phone || '--') + '</div>';
        html += '</div>';
        html += '</div>';

        html += '<div class="admin-customer-stats">';
        html += '<div class="admin-customer-stat"><div class="admin-customer-stat-value">' + self.formatNumber(paidOrders.length) + '</div><div class="admin-customer-stat-label">' + Nawa.I18n.t('customer_orders') + '</div></div>';
        html += '<div class="admin-customer-stat"><div class="admin-customer-stat-value">' + self.formatCurrency(totalSpent) + '</div><div class="admin-customer-stat-label">' + Nawa.I18n.t('customer_total_spent') + '</div></div>';
        html += '</div>';

        if (c.notes) {
          html += '<div style="padding:0 16px 8px;font-size:0.8125rem;color:var(--text-muted,#6b7280);white-space:pre-wrap;">' + self._escapeHtml(c.notes) + '</div>';
        }

        html += '<div class="admin-customer-actions">';
        html += '<button class="btn btn-sm btn-ghost" data-edit-customer="' + c.id + '">' + Nawa.I18n.t('edit') + '</button>';
        html += '<button class="btn btn-sm btn-danger" data-delete-customer="' + c.id + '">' + Nawa.I18n.t('delete') + '</button>';
        html += '</div>';
        html += '</div>';
      });

      html += '</div>';

      html += '<div class="modal-overlay hidden" id="customer-modal-overlay">';
      html += '<div class="modal">';
      html += '<div class="modal-header"><h3 id="customer-modal-title">' + Nawa.I18n.t('add_customer') + '</h3>';
      html += '<button class="btn btn-ghost btn-icon" id="customer-modal-close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
      html += '<div class="modal-body">';
      html += '<div id="customer-error" class="hidden" style="color:#ef4444;text-align:center;margin-bottom:12px;font-size:14px;"></div>';
      html += '<div class="form-group"><label>' + Nawa.I18n.t('customer_name') + ' *</label>';
      html += '<input type="text" class="form-input" id="admin-cust-name" placeholder="' + Nawa.I18n.t('customer_name') + '"></div>';
      html += '<div class="form-group"><label>' + Nawa.I18n.t('customer_phone') + '</label>';
      html += '<input type="tel" class="form-input" id="admin-cust-phone" placeholder="' + Nawa.I18n.t('customer_phone') + '" dir="ltr"></div>';
      html += '<div class="form-group"><label>' + Nawa.I18n.t('customer_notes') + '</label>';
      html += '<textarea class="form-input" id="admin-cust-notes" rows="3" style="resize:vertical;" placeholder="' + Nawa.I18n.t('customer_notes') + '"></textarea></div>';
      html += '</div>';
      html += '<div class="modal-footer">';
      html += '<button class="btn btn-ghost" id="customer-modal-cancel">' + Nawa.I18n.t('close_btn') + '</button>';
      html += '<button class="btn btn-primary" id="customer-modal-save">' + Nawa.I18n.t('save') + '</button>';
      html += '</div></div></div>';

      html += '</div>';
      return html;
    },

    renderOrderHistory() {
      var self = this;
      var t = Nawa.I18n.t;
      var isAr = (Nawa.I18n.getLang() === 'ar');
      var filters = this.state.orderHistoryFilters;
      var search = this.state.orderHistorySearch;
      var orders = this.state.orderHistory || [];

      var filtered = orders;
      if (search) {
        var term = search.toLowerCase();
        filtered = filtered.filter(function (o) {
          return (o.id && o.id.toLowerCase().indexOf(term) !== -1) ||
            (o.cashierName && o.cashierName.toLowerCase().indexOf(term) !== -1) ||
            (o.tableId && o.tableId.toLowerCase().indexOf(term) !== -1);
        });
      }

      var totalRevenue = 0;
      filtered.forEach(function (o) { totalRevenue += o.total || 0; });
      var avgOrder = filtered.length > 0 ? Math.round(totalRevenue / filtered.length) : 0;

      var html = '<div class="admin-order-history">';

      html += '<div class="admin-oh-toolbar">';
      html += '<div class="admin-date-range">';
      html += '<label class="form-label" style="margin:0 4px 0 0;font-size:0.8125rem;">' + t('from_date') + '</label>';
      html += '<input type="date" class="form-input" id="oh-date-from" value="' + self._escapeHtml(filters.from || '') + '">';
      html += '<span class="admin-date-range-separator"> ' + t('to') + ' </span>';
      html += '<input type="date" class="form-input" id="oh-date-to" value="' + self._escapeHtml(filters.to || '') + '">';
      html += '<button class="btn btn-primary btn-sm" id="oh-fetch-btn" style="margin-right:8px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> ' + t('search') + '</button>';
      html += '</div>';
      html += '<div class="admin-oh-search">';
      html += '<input type="text" class="form-input" id="oh-search" placeholder="' + t('search_orders') + '..." value="' + self._escapeHtml(search || '') + '">';
      html += '</div>';
      html += '<button class="btn btn-sm btn-outline" id="oh-export-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ' + t('export_csv') + '</button>';
      html += '</div>';

      html += '<div class="admin-oh-stats">';
      html += '<div class="admin-oh-stat-card"><div class="admin-oh-stat-value">' + self.formatNumber(filtered.length) + '</div><div class="admin-oh-stat-label">' + t('total_orders') + '</div></div>';
      html += '<div class="admin-oh-stat-card"><div class="admin-oh-stat-value">' + self.formatCurrency(totalRevenue) + '</div><div class="admin-oh-stat-label">' + t('total_revenue') + '</div></div>';
      html += '<div class="admin-oh-stat-card"><div class="admin-oh-stat-value">' + self.formatCurrency(avgOrder) + '</div><div class="admin-oh-stat-label">' + t('avg_order_value') + '</div></div>';
      html += '</div>';

      html += '<div class="admin-oh-table-wrapper">';
      if (this.state.orderHistoryLoading) {
        html += '<div class="admin-loading" style="padding:40px;text-align:center;"><div class="spinner-lg"></div></div>';
      } else if (filtered.length === 0) {
        html += '<div class="admin-empty"><div class="admin-empty-title">' + t('no_orders_yet') + '</div></div>';
      } else {
        html += '<table class="admin-oh-table"><thead><tr>';
        html += '<th></th><th>' + t('order_number') + '</th><th>' + t('order_time') + '</th><th>' + t('order_cashier') + '</th><th>' + t('order_table') + '</th><th>' + t('order_items_count') + '</th><th>' + t('order_total') + '</th><th>' + t('order_status') + '</th>';
        html += '</tr></thead><tbody>';

        filtered.forEach(function (order, idx) {
          var orderNum = order.id ? order.id.slice(-6).toUpperCase() : '--';
          var itemCount = order.items ? order.items.length : 0;
          var statusClass = order.status === 'paid' || order.status === 'completed' ? 'paid' : (order.status === 'cancelled' ? 'cancelled' : (order.status === 'held' ? 'held' : 'pending'));
          var statusLabel = order.status === 'paid' ? t('status_paid') : (order.status === 'completed' ? t('status_completed') : (order.status === 'cancelled' ? t('status_cancelled') : (order.status === 'held' ? t('status_held') : t('status_active'))));

          html += '<tr class="admin-oh-row" data-oh-idx="' + idx + '">';
          html += '<td><button class="admin-oh-expand-btn" data-oh-idx="' + idx + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button></td>';
          html += '<td style="font-weight:600;">#' + orderNum + '</td>';
          html += '<td>' + self.formatDate(order.createdAt) + ' ' + self.formatTime(order.createdAt) + '</td>';
          html += '<td>' + self._escapeHtml(order.cashierName || '--') + '</td>';
          html += '<td>' + self._escapeHtml(order.tableId || '--') + '</td>';
          html += '<td>' + itemCount + '</td>';
          html += '<td style="font-weight:600;">' + self.formatCurrency(order.total) + '</td>';
          html += '<td><span class="admin-order-status ' + statusClass + '"><span class="admin-order-status-dot"></span>' + statusLabel + '</span></td>';
          html += '</tr>';

          html += '<tr class="admin-oh-detail-row" id="oh-detail-' + idx + '">';
          html += '<td colspan="8">';
          html += '<div class="admin-oh-detail-content">';
          if (order.items && order.items.length > 0) {
            order.items.forEach(function (item) {
              var itemName = item.name || item.nameEn || t('item');
              var noteHtml = item.notes ? '<div style="font-size:0.7rem;color:var(--text-secondary,#6B7280);font-style:italic;margin-top:2px;">↳ ' + self._escapeHtml(item.notes) + '</div>' : '';
              html += '<div class="admin-oh-detail-item">';
              html += '<span class="admin-oh-detail-item-name">' + self._escapeHtml(itemName) + noteHtml + '</span>';
              html += '<span class="admin-oh-detail-item-qty">× ' + (item.quantity || item.q || 1) + '</span>';
              html += '<span class="admin-oh-detail-item-price">' + self.formatCurrency((item.price || item.pr || 0) * (item.quantity || item.q || 1)) + '</span>';
              html += '</div>';
            });
          } else {
            html += '<div style="color:var(--text-secondary,#6B7280);padding:8px 0;">' + t('no_data') + '</div>';
          }
          html += '</div></td></tr>';
        });

        html += '</tbody></table>';
      }
      html += '</div></div>';
      return html;
    },

    async fetchOrderHistory() {
      var self = this;
      var t = Nawa.I18n.t;
      this.state.orderHistoryLoading = true;
      this.state._orderHistoryFetched = true;
      this.render();

      var params = [];
      if (this.state.orderHistoryFilters.from) params.push('from=' + this.state.orderHistoryFilters.from);
      if (this.state.orderHistoryFilters.to) params.push('to=' + this.state.orderHistoryFilters.to);
      params.push('limit=500');
      var qs = params.length > 0 ? '?' + params.join('&') : '';

      try {
        var res = await Nawa.Auth.apiFetch('/orders/history' + qs);
        if (res.ok) {
          this.state.orderHistory = await res.json();
        } else {
          this.state.orderHistory = [];
        }
      } catch (e) {
        this.state.orderHistory = [];
      }
      this.state.orderHistoryLoading = false;
      this.render();
    },

    exportOrderHistoryCSV() {
      var t = Nawa.I18n.t;
      var isAr = (Nawa.I18n.getLang() === 'ar');
      var orders = this.state.orderHistory || [];
      var search = this.state.orderHistorySearch;

      var filtered = orders;
      if (search) {
        var term = search.toLowerCase();
        filtered = filtered.filter(function (o) {
          return (o.id && o.id.toLowerCase().indexOf(term) !== -1) ||
            (o.cashierName && o.cashierName.toLowerCase().indexOf(term) !== -1);
        });
      }

      var header = isAr ? 'رقم الطلب,الوقت,أمين الصندوق,الطاولة,العناصر,الإجمالي,الحالة,طريقة الدفع' : 'Order #,Time,Cashier,Table,Items,Total,Status,Payment Method';
      var rows = [header];

      var self = this;
      filtered.forEach(function (o) {
        var orderNum = o.id ? o.id.slice(-6).toUpperCase() : '';
        var itemCount = o.items ? o.items.length : 0;
        var statusLabel = o.status === 'paid' ? (isAr ? 'مدفوع' : 'Paid') : o.status;
        var payLabel = o.paymentMethod === 'card' ? (isAr ? 'بطاقة' : 'Card') : (isAr ? 'نقدي' : 'Cash');
        var row = [
          '"' + orderNum + '"',
          '"' + (o.createdAt || '') + '"',
          '"' + (o.cashierName || '') + '"',
          '"' + (o.tableId || '') + '"',
          '"' + itemCount + '"',
          '"' + (o.total || 0) + '"',
          '"' + statusLabel + '"',
          '"' + payLabel + '"'
        ];
        rows.push(row.join(','));
      });

      var csvContent = '\uFEFF' + rows.join('\n');
      var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'order_history_' + new Date().toISOString().split('T')[0] + '.csv';
      a.click();
      URL.revokeObjectURL(url);
      this.showNotification(Nawa.I18n.t('success_export'), 'success');
    },

    renderDashboardSettings() {
      var st = this.state.settings;
      var self = this;
      var t = Nawa.I18n.t;
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;
      var dsTab = this.state.dsActiveTab || 'products';
      var products = this.state.products || [];
      var categories = this.state.categories || [];
      var tables = this.state.tables || [];
      var floors = this.state.floors || [];

      var html = '<div class="admin-settings">';
      html += '<div style="max-width:960px;margin:0 auto;">';

      var tabs = [
        { id: 'products', label: isAr ? 'المنتجات' : 'Products', icon: '📦' },
        { id: 'categories', label: isAr ? 'الفئات' : 'Categories', icon: '🏷️' },
        { id: 'tables', label: isAr ? 'الطاولات' : 'Tables', icon: '🪑' },
        { id: 'discounts', label: isAr ? 'قوائم الخصم' : 'Discounts', icon: '💰' },
        { id: 'features', label: isAr ? 'المميزات' : 'Features', icon: '⚙️' },
        { id: 'business', label: isAr ? 'إعدادات العمل' : 'Business', icon: '💼' }
      ];

      html += '<div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap;">';
      tabs.forEach(function (tab) {
        var active = dsTab === tab.id;
        var btnStyle = active
          ? 'background:var(--navy,#0E1C3D);color:#fff;border-color:var(--navy,#0E1C3D);'
          : 'background:var(--card,#fff);color:var(--text-primary,#1A1A1A);border-color:var(--border,#E5E7EB);';
        html += '<button class="btn ds-tab-btn" data-ds-tab="' + tab.id + '" style="' + btnStyle + 'padding:10px 18px;border-radius:10px;cursor:pointer;font-weight:600;font-size:0.875rem;display:flex;align-items:center;gap:6px;transition:all 0.2s;">' + tab.icon + ' ' + tab.label + '</button>';
      });
      html += '</div>';

      html += '<div id="ds-tab-content">';
      switch (dsTab) {
        case 'products':
          html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
          html += '<h3 style="margin:0;font-size:1.1rem;font-weight:700;color:var(--navy,#0E1C3D);">' + (isAr ? 'المنتجات' : 'Products') + ' <span style="color:var(--text-secondary,#6B7280);font-weight:400;">(' + products.length + ')</span></h3>';
          html += '<button class="btn btn-primary btn-sm ds-add-item" data-ds-type="product" style="display:flex;align-items:center;gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> ' + (isAr ? 'إضافة منتج' : 'Add Product') + '</button>';
          html += '</div>';
          if (products.length === 0) {
            html += '<div style="text-align:center;padding:48px;color:var(--text-secondary,#6B7280);"><div style="font-size:2.5rem;margin-bottom:12px;">📦</div>' + (isAr ? 'لا توجد منتجات بعد' : 'No products yet') + '</div>';
          } else {
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">';
            products.forEach(function (p) {
              var catName = '';
              for (var c = 0; c < categories.length; c++) {
                if (categories[c].id === p.categoryId) { catName = categories[c].name || ''; break; }
              }
              html += '<div style="background:var(--card,#fff);border:1px solid var(--border,#E5E7EB);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px;">';
              html += '<div style="display:flex;justify-content:space-between;align-items:start;">';
              html += '<div><div style="font-weight:700;font-size:0.9375rem;">' + Admin._escapeHtml(p.name || '--') + '</div>';
              if (p.nameEn) html += '<div style="font-size:0.8125rem;color:var(--text-secondary,#6B7280);">' + Admin._escapeHtml(p.nameEn) + '</div>';
              html += '</div>';
              html += '<div style="display:flex;gap:4px;">';
              html += '<button class="btn btn-ghost btn-sm ds-edit-item" data-ds-type="product" data-id="' + p.id + '" title="' + (isAr ? 'تعديل' : 'Edit') + '" style="padding:4px 8px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>';
              html += '<button class="btn btn-ghost btn-sm ds-delete-item" data-ds-type="product" data-id="' + p.id + '" title="' + (isAr ? 'حذف' : 'Delete') + '" style="padding:4px 8px;color:var(--danger,#ef4444);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>';
              html += '</div></div>';
              html += '<div style="display:flex;gap:12px;font-size:0.8125rem;color:var(--text-secondary,#6B7280);">';
              html += '<span style="font-weight:600;color:var(--navy,#0E1C3D);">' + self.formatCurrency(p.price || 0) + '</span>';
              if (catName) html += '<span>' + Admin._escapeHtml(catName) + '</span>';
              if (p.barcode) html += '<span>' + Admin._escapeHtml(p.barcode) + '</span>';
              html += '</div></div>';
            });
            html += '</div>';
          }
          break;

        case 'categories':
          html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
          html += '<h3 style="margin:0;font-size:1.1rem;font-weight:700;color:var(--navy,#0E1C3D);">' + (isAr ? 'الفئات' : 'Categories') + ' <span style="color:var(--text-secondary,#6B7280);font-weight:400;">(' + categories.length + ')</span></h3>';
          html += '<button class="btn btn-primary btn-sm ds-add-item" data-ds-type="category" style="display:flex;align-items:center;gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> ' + (isAr ? 'إضافة فئة' : 'Add Category') + '</button>';
          html += '</div>';
          if (categories.length === 0) {
            html += '<div style="text-align:center;padding:48px;color:var(--text-secondary,#6B7280);"><div style="font-size:2.5rem;margin-bottom:12px;">🏷️</div>' + (isAr ? 'لا توجد فئات بعد' : 'No categories yet') + '</div>';
          } else {
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;">';
            categories.forEach(function (cat) {
              var count = products.filter(function (p) { return p.categoryId === cat.id; }).length;
              html += '<div style="background:var(--card,#fff);border:1px solid var(--border,#E5E7EB);border-radius:12px;padding:16px;display:flex;justify-content:space-between;align-items:center;">';
              html += '<div><div style="font-weight:700;">' + Admin._escapeHtml(cat.name || '--') + '</div>';
              html += '<div style="font-size:0.8125rem;color:var(--text-secondary,#6B7280);">' + count + ' ' + (isAr ? 'منتج' : 'products') + '</div></div>';
              html += '<div style="display:flex;gap:4px;">';
              html += '<button class="btn btn-ghost btn-sm ds-edit-item" data-ds-type="category" data-id="' + cat.id + '" style="padding:4px 8px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>';
              html += '<button class="btn btn-ghost btn-sm ds-delete-item" data-ds-type="category" data-id="' + cat.id + '" style="padding:4px 8px;color:var(--danger,#ef4444);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>';
              html += '</div></div>';
            });
            html += '</div>';
          }
          break;

        case 'tables':
          html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
          html += '<h3 style="margin:0;font-size:1.1rem;font-weight:700;color:var(--navy,#0E1C3D);">' + (isAr ? 'الطاولات والأرضيات' : 'Tables & Floors') + ' <span style="color:var(--text-secondary,#6B7280);font-weight:400;">(' + tables.length + ' ' + (isAr ? 'طاولة' : 'tables') + ')</span></h3>';
          html += '<div style="display:flex;gap:8px;">';
          html += '<button class="btn btn-primary btn-sm ds-add-item" data-ds-type="table" style="display:flex;align-items:center;gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> ' + (isAr ? 'إضافة طاولة' : 'Add Table') + '</button>';
          html += '<button class="btn btn-outline btn-sm ds-add-item" data-ds-type="floor" style="display:flex;align-items:center;gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> ' + (isAr ? 'إضافة أرضية' : 'Add Floor') + '</button>';
          html += '</div></div>';
          if (floors.length === 0 && tables.length === 0) {
            html += '<div style="text-align:center;padding:48px;color:var(--text-secondary,#6B7280);"><div style="font-size:2.5rem;margin-bottom:12px;">🪑</div>' + (isAr ? 'لا توجد طاولات بعد' : 'No tables yet') + '</div>';
          } else if (floors.length > 0) {
            floors.forEach(function (floor) {
              var floorTables = tables.filter(function (tbl) { return tbl.floorId === floor.id; });
              html += '<div style="margin-bottom:20px;">';
              html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">';
              html += '<h4 style="margin:0;font-size:0.9375rem;font-weight:600;">' + Admin._escapeHtml(floor.name || 'Floor') + ' <span style="color:var(--text-secondary,#6B7280);font-weight:400;">(' + floorTables.length + ')</span></h4>';
              html += '<div style="display:flex;gap:4px;">';
              html += '<button class="btn btn-ghost btn-sm ds-edit-item" data-ds-type="floor" data-id="' + floor.id + '" style="padding:4px 8px;font-size:0.75rem;">' + (isAr ? 'تعديل' : 'Edit') + '</button>';
              html += '<button class="btn btn-ghost btn-sm ds-delete-item" data-ds-type="floor" data-id="' + floor.id + '" style="padding:4px 8px;font-size:0.75rem;color:var(--danger,#ef4444);">' + (isAr ? 'حذف' : 'Delete') + '</button>';
              html += '</div></div>';
              html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;">';
              floorTables.forEach(function (tbl) {
                var sc = tbl.status === 'occupied' ? '#ef4444' : tbl.status === 'reserved' ? '#f59e0b' : '#22c55e';
                var br = (tbl.shape === 'round') ? '50%' : (tbl.shape === 'pill') ? '999px' : '10px';
                html += '<div style="background:var(--card,#fff);border:2px solid ' + sc + ';border-radius:' + br + ';padding:12px;text-align:center;position:relative;">';
                html += '<div style="font-weight:700;font-size:1.1rem;">' + Admin._escapeHtml(tbl.name || '#' + (tbl.number || '')) + '</div>';
                html += '<div style="font-size:0.625rem;color:var(--text-secondary,#6B7280);margin-top:2px;">' + (isAr ? (tbl.shape === 'round' ? 'دائري' : tbl.shape === 'rectangle' ? 'مستطيل' : tbl.shape === 'pill' ? 'بيضوي' : 'مربع') : (tbl.shape || 'square')) + ' · ' + (tbl.seats || 4) + ' ' + (isAr ? 'أشخاص' : 'seats') + '</div>';
                html += '<div style="font-size:0.75rem;color:' + sc + ';margin-top:4px;">' + (isAr ? (tbl.status === 'occupied' ? 'مشغولة' : tbl.status === 'reserved' ? 'محجوزة' : 'فارغة') : (tbl.status || 'free')) + '</div>';
                html += '<div style="position:absolute;top:4px;left:4px;display:flex;gap:2px;">';
                html += '<button class="btn btn-ghost btn-sm ds-edit-item" data-ds-type="table" data-id="' + tbl.id + '" style="padding:2px 4px;font-size:0.625rem;">✏️</button>';
                html += '<button class="btn btn-ghost btn-sm ds-delete-item" data-ds-type="table" data-id="' + tbl.id + '" style="padding:2px 4px;font-size:0.625rem;color:var(--danger,#ef4444);">🗑️</button>';
                html += '</div></div>';
              });
              html += '</div></div>';
            });
          } else {
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;">';
            tables.forEach(function (tbl) {
              var sc = tbl.status === 'occupied' ? '#ef4444' : tbl.status === 'reserved' ? '#f59e0b' : '#22c55e';
              var br = (tbl.shape === 'round') ? '50%' : (tbl.shape === 'pill') ? '999px' : '10px';
              html += '<div style="background:var(--card,#fff);border:2px solid ' + sc + ';border-radius:' + br + ';padding:12px;text-align:center;position:relative;">';
              html += '<div style="font-weight:700;font-size:1.1rem;">' + Admin._escapeHtml(tbl.name || '#' + (tbl.number || '')) + '</div>';
              html += '<div style="font-size:0.625rem;color:var(--text-secondary,#6B7280);margin-top:2px;">' + (isAr ? (tbl.shape === 'round' ? 'دائري' : tbl.shape === 'rectangle' ? 'مستطيل' : tbl.shape === 'pill' ? 'بيضوي' : 'مربع') : (tbl.shape || 'square')) + ' · ' + (tbl.seats || 4) + ' ' + (isAr ? 'أشخاص' : 'seats') + '</div>';
              html += '<div style="font-size:0.75rem;color:' + sc + ';margin-top:4px;">' + (isAr ? (tbl.status === 'occupied' ? 'مشغولة' : tbl.status === 'reserved' ? 'محجوزة' : 'فارغة') : (tbl.status || 'free')) + '</div>';
              html += '<div style="position:absolute;top:4px;left:4px;display:flex;gap:2px;">';
              html += '<button class="btn btn-ghost btn-sm ds-edit-item" data-ds-type="table" data-id="' + tbl.id + '" style="padding:2px 4px;font-size:0.625rem;">✏️</button>';
              html += '<button class="btn btn-ghost btn-sm ds-delete-item" data-ds-type="table" data-id="' + tbl.id + '" style="padding:2px 4px;font-size:0.625rem;color:var(--danger,#ef4444);">🗑️</button>';
              html += '</div></div>';
            });
            html += '</div>';
          }
          break;

        case 'discounts':
          var discounts = this.state.discounts || [];
          html += '<div style="max-width:960px;">';
          html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
          html += '<h3 style="margin:0;font-size:1.1rem;font-weight:700;color:var(--navy,#0E1C3D);">' + (isAr ? 'قوائم الخصم' : 'Discount Presets') + ' <span style="color:var(--text-secondary,#6B7280);font-weight:400;">(' + discounts.length + ')</span></h3>';
          html += '<button class="btn btn-primary btn-sm ds-add-item" data-ds-type="discount" style="display:flex;align-items:center;gap:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> ' + (isAr ? 'إضافة خصم' : 'Add Discount') + '</button>';
          html += '</div>';
          if (discounts.length === 0) {
            html += '<div style="text-align:center;padding:48px;color:var(--text-secondary,#6B7280);"><div style="font-size:2.5rem;margin-bottom:12px;">💰</div>' + (isAr ? 'لا توجد قوائم خصم بعد' : 'No discount presets yet') + '</div>';
          } else {
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">';
            discounts.forEach(function (d) {
              var typeLabel = d.type === 'percent' ? (isAr ? 'نسبة مئوية' : 'Percentage') : (isAr ? 'مبلغ ثابت' : 'Fixed Amount');
              var typeIcon = d.type === 'percent' ? '%' : '$';
              var statusColor = d.active ? '#22c55e' : '#ef4444';
              var statusText = d.active ? (isAr ? 'نشط' : 'Active') : (isAr ? 'معطل' : 'Inactive');
              html += '<div class="admin-discount-card" style="background:var(--card,#fff);border:1px solid var(--border,#E5E7EB);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px;position:relative;">';
              html += '<div style="display:flex;justify-content:space-between;align-items:start;">';
              html += '<div><div style="font-weight:700;font-size:0.9375rem;">' + Admin._escapeHtml(d.name || '--') + '</div>';
              html += '<div style="font-size:0.75rem;color:var(--text-secondary,#6B7280);margin-top:2px;">' + typeLabel + '</div></div>';
              html += '<div style="display:flex;gap:4px;">';
              html += '<button class="btn btn-ghost btn-sm ds-edit-item" data-ds-type="discount" data-id="' + d.id + '" style="padding:4px 6px;">✏️</button>';
              html += '<button class="btn btn-ghost btn-sm ds-delete-item" data-ds-type="discount" data-id="' + d.id + '" style="padding:4px 6px;color:var(--danger,#ef4444);">🗑️</button>';
              html += '</div></div>';
              html += '<div style="display:flex;align-items:center;gap:8px;">';
              html += '<div style="background:var(--navy,#0E1C3D);color:#fff;border-radius:8px;padding:4px 10px;font-weight:700;font-size:0.875rem;">' + Admin._escapeHtml(String(d.value)) + typeIcon + '</div>';
              html += '<span style="font-size:0.75rem;color:' + statusColor + ';font-weight:600;">● ' + statusText + '</span>';
              html += '</div></div>';
            });
            html += '</div>';
          }
          html += '</div>';
          break;

        case 'features':
          html += '<div style="max-width:700px;">';
          function featToggle(label, desc, settingKey) {
            var checked = st[settingKey] !== false ? ' checked' : '';
            var row = '<div class="admin-settings-row">';
            row += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + t(label) + '</span><span class="admin-settings-label-desc">' + t(desc) + '</span></div>';
            row += '<label class="admin-toggle"><input type="checkbox" class="ds-toggle" data-key="' + settingKey + '"' + checked + '><span class="admin-toggle-slider"></span></label>';
            row += '</div>';
            return row;
          }
          html += '<div class="admin-settings-card"><div class="admin-settings-card-header">' + t('ds_pos_features') + '</div><div class="admin-settings-card-body">';
          html += featToggle('ds_order_discount', 'ds_order_discount_desc', 'featureDiscount');
          html += featToggle('ds_hold_order', 'ds_hold_order_desc', 'featureHoldOrder');
          html += featToggle('ds_table_mgmt', 'ds_table_mgmt_desc', 'featureTableManagement');
          html += featToggle('ds_tips', 'ds_tips_desc', 'featureTips');
          html += featToggle('ds_order_notes', 'ds_order_notes_desc', 'featureOrderNotes');
          html += featToggle('ds_split_bill', 'ds_split_bill_desc', 'featureSplitBill');
          html += featToggle('ds_table_transfer', 'ds_table_transfer_desc', 'featureTableTransfer');
          html += featToggle('ds_customer_name', 'ds_customer_name_desc', 'featureCustomerName');
          html += featToggle('ds_kitchen_display', 'ds_kitchen_display_desc', 'featureKitchenDisplay');
          html += featToggle('ds_loyalty', 'ds_loyalty_desc', 'featureLoyalty');
          html += featToggle('ds_inventory', 'ds_inventory_desc', 'featureInventory');
          html += featToggle('ds_auto_print', 'ds_auto_print_desc', 'featureAutoPrint');
          html += featToggle('ds_sound_effects', 'ds_sound_effects_desc', 'featureSoundEffects');
          html += featToggle('ds_multi_payment', 'ds_multi_payment_desc', 'featureMultiPayment');
          html += '</div></div>';
          html += '<button class="btn btn-primary" id="ds-save-features" style="margin-top:16px;">' + t('ds_save') + '</button>';
          html += '</div>';
          break;

        case 'business':
          html += '<div style="max-width:700px;">';
          function bizToggle(label, desc, settingKey) {
            var checked = st[settingKey] !== false ? ' checked' : '';
            var row = '<div class="admin-settings-row">';
            row += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + t(label) + '</span><span class="admin-settings-label-desc">' + t(desc) + '</span></div>';
            row += '<label class="admin-toggle"><input type="checkbox" class="ds-toggle" data-key="' + settingKey + '"' + checked + '><span class="admin-toggle-slider"></span></label>';
            row += '</div>';
            return row;
          }
          function bizNumber(label, desc, settingKey, min, max, unit) {
            var val = st[settingKey] !== undefined ? st[settingKey] : 0;
            var row = '<div class="admin-settings-row">';
            row += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + t(label) + '</span><span class="admin-settings-label-desc">' + t(desc) + '</span></div>';
            row += '<div class="form-group" style="max-width:120px;display:flex;align-items:center;gap:4px;">';
            row += '<input type="number" class="form-input ds-number" data-key="' + settingKey + '" value="' + Admin._escapeHtml(String(val)) + '" min="' + (min || 0) + '" max="' + (max || 9999) + '">';
            if (unit) row += '<span style="color:var(--text-secondary,#6B7280);font-size:0.8125rem;">' + unit + '</span>';
            row += '</div></div>';
            return row;
          }
          function bizText(label, desc, settingKey, placeholder) {
            var val = st[settingKey] || '';
            var row = '<div class="admin-settings-row">';
            row += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + t(label) + '</span><span class="admin-settings-label-desc">' + t(desc) + '</span></div>';
            row += '<div class="form-group" style="flex:2"><input type="text" class="form-input ds-text" data-key="' + settingKey + '" value="' + Admin._escapeHtml(val) + '" placeholder="' + (placeholder || '') + '"></div>';
            row += '</div>';
            return row;
          }
          function bizTime(label, desc, settingKey) {
            var val = st[settingKey] || '';
            var row = '<div class="admin-settings-row">';
            row += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + t(label) + '</span><span class="admin-settings-label-desc">' + t(desc) + '</span></div>';
            row += '<div class="form-group" style="max-width:120px"><input type="time" class="form-input ds-time" data-key="' + settingKey + '" value="' + Admin._escapeHtml(val) + '"></div>';
            row += '</div>';
            return row;
          }
          function bizSelect(label, desc, settingKey, options) {
            var val = st[settingKey] || options[0].value;
            var row = '<div class="admin-settings-row">';
            row += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + t(label) + '</span><span class="admin-settings-label-desc">' + t(desc) + '</span></div>';
            row += '<div class="form-group" style="max-width:160px"><select class="form-input ds-select" data-key="' + settingKey + '">';
            options.forEach(function (opt) {
              row += '<option value="' + opt.value + '"' + (val === opt.value ? ' selected' : '') + '>' + opt.label + '</option>';
            });
            row += '</select></div></div>';
            return row;
          }
          html += '<div class="admin-settings-card"><div class="admin-settings-card-header">' + t('ds_business') + '</div><div class="admin-settings-card-body">';
          html += bizNumber('ds_min_order', 'ds_min_order_desc', 'dashboardMinOrder', 0, 99999, 'ل.س');
          html += bizNumber('ds_max_discount', 'ds_max_discount_desc', 'dashboardMaxDiscount', 0, 100, '%');
          html += bizSelect('ds_currency', 'ds_currency_desc', 'dashboardCurrency', [
            { value: 'ل.س', label: 'ليرة سورية (ل.س)' },
            { value: 'ل.ل', label: 'ليرة لبنانية (ل.ل)' },
            { value: '$', label: 'دولار أمريكي ($)' }
          ]);
          html += bizToggle('ds_auto_reports', 'ds_auto_reports_desc', 'featureAutoReports');
          html += bizText('ds_receipt_footer', 'ds_receipt_footer_desc', 'dashboardReceiptFooter', (isAr ? 'شكراً لزيارتكم' : 'Thank you for visiting'));
          html += '</div></div>';
          html += '<div class="admin-settings-card" style="margin-top:16px;"><div class="admin-settings-card-header">' + t('ds_opening_hours') + '</div><div class="admin-settings-card-body">';
          html += bizToggle('ds_opening_hours', 'ds_opening_hours_desc', 'featureOpeningHours');
          html += bizTime('ds_open_time', '', 'dashboardOpenTime');
          html += bizTime('ds_close_time', '', 'dashboardCloseTime');
          html += '</div></div>';
          html += '<button class="btn btn-primary" id="ds-save-business" style="margin-top:16px;">' + t('ds_save') + '</button>';
          html += '</div>';
          break;
      }
      html += '</div>';

      html += '<div class="modal-overlay hidden" id="ds-modal-overlay"><div class="modal"><div class="modal-header"><h3 id="ds-modal-title"></h3>';
      html += '<button class="btn btn-ghost btn-icon" id="ds-modal-close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
      html += '<div class="modal-body"><div id="ds-modal-error" class="hidden" style="color:#ef4444;text-align:center;margin-bottom:12px;font-size:14px;"></div>';
      html += '<div id="ds-modal-body"></div></div>';
      html += '<div class="modal-footer"><button class="btn btn-ghost" id="ds-modal-cancel">' + t('close_btn') + '</button><button class="btn btn-primary" id="ds-modal-save">' + t('save') + '</button></div>';
      html += '</div></div>';

      html += '</div></div>';
      return html;
    },

    openDsModal(type, editId) {
      var self = this;
      var t = Nawa.I18n.t;
      var isAr = (Nawa.I18n.getLang() === 'ar');
      var modal = document.getElementById('ds-modal-overlay');
      var title = document.getElementById('ds-modal-title');
      var body = document.getElementById('ds-modal-body');
      var errEl = document.getElementById('ds-modal-error');
      if (!modal || !title || !body) return;
      if (errEl) errEl.classList.add('hidden');

      var item = null;
      if (editId) {
        if (type === 'product') item = (this.state.products || []).find(function (p) { return p.id === editId; });
        else if (type === 'category') item = (this.state.categories || []).find(function (c) { return c.id === editId; });
        else if (type === 'table') item = (this.state.tables || []).find(function (tbl) { return tbl.id === editId; });
        else if (type === 'floor') item = (this.state.floors || []).find(function (f) { return f.id === editId; });
        else if (type === 'discount') item = (this.state.discounts || []).find(function (d) { return d.id === editId; });
      }

      var html = '';
      if (type === 'product') {
        title.textContent = item ? (isAr ? 'تعديل منتج' : 'Edit Product') : (isAr ? 'إضافة منتج' : 'Add Product');
        var cats = this.state.categories || [];
        html += '<div class="form-group"><label class="form-label">' + (isAr ? 'اسم المنتج' : 'Product Name') + ' *</label>';
        html += '<input type="text" class="form-input" id="ds-m-name" value="' + Admin._escapeHtml(item ? item.name : '') + '" placeholder="' + (isAr ? 'مثال: همبرغر' : 'e.g. Burger') + '"></div>';
        html += '<div class="form-group"><label class="form-label">' + (isAr ? 'الاسم بالإنجليزية' : 'English Name') + '</label>';
        html += '<input type="text" class="form-input" id="ds-m-nameEn" value="' + Admin._escapeHtml(item ? (item.nameEn || '') : '') + '" placeholder="' + (isAr ? 'اختياري' : 'Optional') + '"></div>';
        html += '<div style="display:flex;gap:12px;">';
        html += '<div class="form-group" style="flex:1"><label class="form-label">' + t('price') + ' *</label>';
        html += '<input type="number" class="form-input" id="ds-m-price" value="' + (item ? item.price : '') + '" min="0" step="100"></div>';
        html += '<div class="form-group" style="flex:1"><label class="form-label">' + (isAr ? 'الباركود' : 'Barcode') + '</label>';
        html += '<input type="text" class="form-input" id="ds-m-barcode" value="' + Admin._escapeHtml(item ? (item.barcode || '') : '') + '"></div>';
        html += '</div>';
        html += '<div class="form-group"><label class="form-label">' + (isAr ? 'الفئة' : 'Category') + '</label>';
        html += '<select class="form-input" id="ds-m-categoryId"><option value="">' + (isAr ? '-- بدون فئة --' : '-- None --') + '</option>';
        cats.forEach(function (c) {
          html += '<option value="' + c.id + '"' + (item && item.categoryId === c.id ? ' selected' : '') + '>' + Admin._escapeHtml(c.name || '') + '</option>';
        });
        html += '</select></div>';
        html += '<div class="form-group"><label class="form-label">' + (isAr ? 'ملاحظات' : 'Notes') + '</label>';
        html += '<textarea class="form-input" id="ds-m-notes" rows="2" style="resize:vertical;">' + Admin._escapeHtml(item ? (item.notes || '') : '') + '</textarea></div>';
      } else if (type === 'category') {
        title.textContent = item ? (isAr ? 'تعديل فئة' : 'Edit Category') : (isAr ? 'إضافة فئة' : 'Add Category');
        html += '<div class="form-group"><label class="form-label">' + (isAr ? 'اسم الفئة' : 'Category Name') + ' *</label>';
        html += '<input type="text" class="form-input" id="ds-m-name" value="' + Admin._escapeHtml(item ? item.name : '') + '" placeholder="' + (isAr ? 'مثال: مشروبات' : 'e.g. Drinks') + '"></div>';
        html += '<div class="form-group"><label class="form-label">' + (isAr ? 'الترتيب' : 'Sort Order') + '</label>';
        html += '<input type="number" class="form-input" id="ds-m-sortOrder" value="' + (item && item.sortOrder !== undefined ? item.sortOrder : 0) + '" min="0"></div>';
      } else if (type === 'table') {
        title.textContent = item ? (isAr ? 'تعديل طاولة' : 'Edit Table') : (isAr ? 'إضافة طاولة' : 'Add Table');
        var floors = this.state.floors || [];
        html += '<div style="display:flex;gap:12px;">';
        html += '<div class="form-group" style="flex:1"><label class="form-label">' + (isAr ? 'رقم الطاولة' : 'Table Number') + ' *</label>';
        html += '<input type="number" class="form-input" id="ds-m-number" value="' + (item ? item.number : '') + '" min="1"></div>';
        html += '<div class="form-group" style="flex:1"><label class="form-label">' + (isAr ? 'اسم الطاولة' : 'Table Name') + '</label>';
        html += '<input type="text" class="form-input" id="ds-m-name" value="' + Admin._escapeHtml(item ? (item.name || '') : '') + '" placeholder="' + (isAr ? 'اختياري' : 'Optional') + '"></div>';
        html += '</div>';
        html += '<div style="display:flex;gap:12px;">';
        html += '<div class="form-group" style="flex:1"><label class="form-label">' + (isAr ? 'عدد الأشخاص' : 'Seats') + '</label>';
        html += '<input type="number" class="form-input" id="ds-m-seats" value="' + (item ? (item.seats || 4) : 4) + '" min="1" max="50"></div>';
        html += '<div class="form-group" style="flex:1"><label class="form-label">' + (isAr ? 'شكل الطاولة' : 'Table Shape') + '</label>';
        html += '<select class="form-input" id="ds-m-shape">';
        html += '<option value="round"' + (item && item.shape === 'round' ? ' selected' : '') + '>' + (isAr ? 'دائري' : 'Round') + '</option>';
        html += '<option value="square"' + (!item || item.shape === 'square' || !item.shape ? ' selected' : '') + '>' + (isAr ? 'مربع' : 'Square') + '</option>';
        html += '<option value="rectangle"' + (item && item.shape === 'rectangle' ? ' selected' : '') + '>' + (isAr ? 'مستطيل' : 'Rectangle') + '</option>';
        html += '<option value="pill"' + (item && item.shape === 'pill' ? ' selected' : '') + '>' + (isAr ? 'بيضوي' : 'Pill/Oval') + '</option>';
        html += '</select></div>';
        html += '</div>';
        html += '<div style="display:flex;gap:12px;">';
        html += '<div class="form-group" style="flex:1"><label class="form-label">' + (isAr ? 'العرض (بكسل)' : 'Width (px)') + '</label>';
        html += '<input type="number" class="form-input" id="ds-m-width" value="' + (item ? (item.width || 0) : 0) + '" min="0" max="500" placeholder="' + (isAr ? 'تلقائي' : 'Auto') + '"></div>';
        html += '<div class="form-group" style="flex:1"><label class="form-label">' + (isAr ? 'الارتفاع (بكسل)' : 'Height (px)') + '</label>';
        html += '<input type="number" class="form-input" id="ds-m-height" value="' + (item ? (item.height || 0) : 0) + '" min="0" max="500" placeholder="' + (isAr ? 'تلقائي' : 'Auto') + '"></div>';
        html += '<div class="form-group" style="flex:1"><label class="form-label">' + (isAr ? 'لون الطاولة' : 'Table Color') + '</label>';
        html += '<input type="color" class="form-input" id="ds-m-color" value="' + (item && item.color ? item.color : '#6b7280') + '" style="height:38px;padding:4px;cursor:pointer;"></div>';
        html += '</div>';
        html += '<div class="form-group"><label class="form-label">' + (isAr ? 'الأرضية' : 'Floor') + '</label>';
        html += '<select class="form-input" id="ds-m-floorId"><option value="">' + (isAr ? '-- اختر أرضية (إلزامي) --' : '-- Select Floor (Required) --') + '</option>';
        floors.forEach(function (f) {
          html += '<option value="' + f.id + '"' + (item && item.floorId === f.id ? ' selected' : '') + '>' + Admin._escapeHtml(f.name || '') + '</option>';
        });
        html += '</select></div>';
      } else if (type === 'floor') {
        title.textContent = item ? (isAr ? 'تعديل أرضية' : 'Edit Floor') : (isAr ? 'إضافة أرضية' : 'Add Floor');
        html += '<div class="form-group"><label class="form-label">' + (isAr ? 'اسم الأرضية' : 'Floor Name') + ' *</label>';
        html += '<input type="text" class="form-input" id="ds-m-name" value="' + Admin._escapeHtml(item ? item.name : '') + '" placeholder="' + (isAr ? 'مثال: الطابق الأول' : 'e.g. Ground Floor') + '"></div>';
        html += '<div style="display:flex;gap:12px;">';
        html += '<div class="form-group" style="flex:1"><label class="form-label">' + (isAr ? 'لون الأرضية' : 'Floor Color') + '</label>';
        html += '<input type="color" class="form-input" id="ds-m-floor-color" value="' + (item && item.color ? item.color : '#e8e6e1') + '" style="height:38px;padding:4px;cursor:pointer;"></div>';
        html += '<div class="form-group" style="flex:1"><label class="form-label">' + (isAr ? 'الترتيب' : 'Sort Order') + '</label>';
        html += '<input type="number" class="form-input" id="ds-m-sortOrder" value="' + (item && item.sortOrder !== undefined ? item.sortOrder : 0) + '" min="0"></div>';
        html += '</div>';
      } else if (type === 'discount') {
        title.textContent = item ? (isAr ? 'تعديل خصم' : 'Edit Discount') : (isAr ? 'إضافة خصم' : 'Add Discount');
        html += '<div class="form-group"><label class="form-label">' + (isAr ? 'اسم الخصم' : 'Discount Name') + ' *</label>';
        html += '<input type="text" class="form-input" id="ds-m-name" value="' + Admin._escapeHtml(item ? item.name : '') + '" placeholder="' + (isAr ? 'مثال: خصم موسمي' : 'e.g. Seasonal Discount') + '"></div>';
        html += '<div style="display:flex;gap:12px;">';
        html += '<div class="form-group" style="flex:1"><label class="form-label">' + (isAr ? 'نوع الخصم' : 'Discount Type') + '</label>';
        html += '<select class="form-input" id="ds-m-discType">';
        html += '<option value="percent"' + (item && item.type === 'percent' ? ' selected' : '') + '>' + (isAr ? 'نسبة مئوية' : 'Percentage (%)') + '</option>';
        html += '<option value="fixed"' + (item && item.type === 'fixed' ? ' selected' : '') + '>' + (isAr ? 'مبلغ ثابت' : 'Fixed Amount') + '</option>';
        html += '</select></div>';
        html += '<div class="form-group" style="flex:1"><label class="form-label">' + (isAr ? 'قيمة الخصم' : 'Discount Value') + ' *</label>';
        html += '<input type="number" class="form-input" id="ds-m-discValue" value="' + (item ? item.value : '') + '" min="0" step="1" placeholder="' + (isAr ? 'أدخل القيمة' : 'Enter value') + '"></div>';
        html += '</div>';
        html += '<div class="form-group"><label class="form-label">' + (isAr ? 'الحالة' : 'Status') + '</label>';
        html += '<select class="form-input" id="ds-m-discActive">';
        html += '<option value="true"' + (!item || item.active !== false ? ' selected' : '') + '>' + (isAr ? 'نشط' : 'Active') + '</option>';
        html += '<option value="false"' + (item && item.active === false ? ' selected' : '') + '>' + (isAr ? 'معطل' : 'Inactive') + '</option>';
        html += '</select></div>';
      }

      body.innerHTML = html;
      this.state.dsModal = { open: true, type: type, editId: editId || null };
      modal.classList.remove('hidden');
    },

    closeDsModal() {
      var modal = document.getElementById('ds-modal-overlay');
      if (modal) modal.classList.add('hidden');
      this.state.dsModal = { open: false, type: '', editId: null };
    },

    async saveDsModalItem() {
      var self = this;
      var m = this.state.dsModal;
      var errEl = document.getElementById('ds-modal-error');
      var isAr = (Nawa.I18n.getLang() === 'ar');

      try {
        if (m.type === 'product') {
          var name = (document.getElementById('ds-m-name') || {}).value || '';
          var nameEn = (document.getElementById('ds-m-nameEn') || {}).value || '';
          var price = parseFloat((document.getElementById('ds-m-price') || {}).value) || 0;
          var barcode = (document.getElementById('ds-m-barcode') || {}).value || '';
          var categoryId = (document.getElementById('ds-m-categoryId') || {}).value || '';
          var notes = (document.getElementById('ds-m-notes') || {}).value || '';
          if (!name.trim()) { if (errEl) { errEl.textContent = isAr ? 'اسم المنتج مطلوب' : 'Product name is required'; errEl.classList.remove('hidden'); } return; }
          if (m.editId) {
            var existing = this.state.products.find(function (p) { return p.id === m.editId; });
            if (existing) {
              existing.name = name.trim();
              existing.nameEn = nameEn.trim();
              existing.price = price;
              existing.barcode = barcode.trim();
              existing.categoryId = categoryId;
              existing.notes = notes.trim();
              await DB.update(S.PRODUCTS, existing.id, existing);
              Nawa.Auth.apiFetch('/products/' + existing.id, { method: 'PUT', body: { name: existing.name, nameEn: existing.nameEn, price: existing.price, barcode: existing.barcode, categoryId: existing.categoryId, notes: existing.notes } }).catch(function(){});
            }
          } else {
            var newItem = { id: Date.now().toString(), name: name.trim(), nameEn: nameEn.trim(), price: price, barcode: barcode.trim(), categoryId: categoryId, notes: notes.trim(), active: true, createdAt: new Date().toISOString() };
            await DB.add(S.PRODUCTS, newItem);
            this.state.products.push(newItem);
            Nawa.Auth.apiFetch('/products', { method: 'POST', body: { name: newItem.name, nameEn: newItem.nameEn, price: newItem.price, barcode: newItem.barcode, categoryId: newItem.categoryId, notes: newItem.notes } }).catch(function(){});
          }
        } else if (m.type === 'category') {
          var name = (document.getElementById('ds-m-name') || {}).value || '';
          var sortOrder = parseInt((document.getElementById('ds-m-sortOrder') || {}).value) || 0;
          if (!name.trim()) { if (errEl) { errEl.textContent = isAr ? 'اسم الفئة مطلوب' : 'Category name is required'; errEl.classList.remove('hidden'); } return; }
          if (m.editId) {
            var existing = this.state.categories.find(function (c) { return c.id === m.editId; });
            if (existing) { existing.name = name.trim(); existing.sortOrder = sortOrder; await DB.update(S.CATEGORIES, existing.id, existing); Nawa.Auth.apiFetch('/categories/' + existing.id, { method: 'PUT', body: { name: existing.name, sortOrder: existing.sortOrder } }).catch(function(){}); }
          } else {
            var newItem = { id: Date.now().toString(), name: name.trim(), sortOrder: sortOrder, createdAt: new Date().toISOString() };
            await DB.add(S.CATEGORIES, newItem);
            this.state.categories.push(newItem);
            Nawa.Auth.apiFetch('/categories', { method: 'POST', body: { name: newItem.name, sortOrder: newItem.sortOrder } }).catch(function(){});
          }
        } else if (m.type === 'table') {
          var number = parseInt((document.getElementById('ds-m-number') || {}).value) || 0;
          var name = (document.getElementById('ds-m-name') || {}).value || '';
          var seats = parseInt((document.getElementById('ds-m-seats') || {}).value) || 4;
          var floorId = (document.getElementById('ds-m-floorId') || {}).value || '';
          var shape = (document.getElementById('ds-m-shape') || {}).value || 'square';
          var width = parseInt((document.getElementById('ds-m-width') || {}).value) || 0;
          var height = parseInt((document.getElementById('ds-m-height') || {}).value) || 0;
          var color = (document.getElementById('ds-m-color') || {}).value || '';
          if (!number) { if (errEl) { errEl.textContent = isAr ? 'رقم الطاولة مطلوب' : 'Table number is required'; errEl.classList.remove('hidden'); } return; }
          if (!floorId) { if (errEl) { errEl.textContent = isAr ? 'يجب اختيار الأرضية' : 'Floor is required'; errEl.classList.remove('hidden'); } return; }
          if (m.editId) {
            var existing = this.state.tables.find(function (t) { return t.id === m.editId; });
            if (existing) {
              existing.number = number;
              existing.name = name.trim();
              existing.seats = seats;
              existing.floorId = floorId;
              existing.shape = shape;
              existing.width = width;
              existing.height = height;
              existing.color = color;
              await DB.update(S.TABLES, existing.id, existing);
              Nawa.Auth.apiFetch('/tables/' + existing.id, { method: 'PUT', body: { number: existing.number, name: existing.name, seats: existing.seats, floorId: existing.floorId, shape: existing.shape, width: existing.width, height: existing.height, color: existing.color } }).catch(function(){});
            }
          } else {
            var newItem = { id: Date.now().toString(), number: number, name: name.trim(), seats: seats, floorId: floorId, shape: shape, width: width, height: height, color: color, status: 'free', createdAt: new Date().toISOString() };
            await DB.add(S.TABLES, newItem);
            this.state.tables.push(newItem);
            Nawa.Auth.apiFetch('/tables', { method: 'POST', body: { number: newItem.number, name: newItem.name, seats: newItem.seats, floorId: newItem.floorId, shape: newItem.shape, width: newItem.width, height: newItem.height, color: newItem.color } }).catch(function(){});
          }
        } else if (m.type === 'floor') {
          var name = (document.getElementById('ds-m-name') || {}).value || '';
          var sortOrder = parseInt((document.getElementById('ds-m-sortOrder') || {}).value) || 0;
          var floorColor = (document.getElementById('ds-m-floor-color') || {}).value || '';
          if (!name.trim()) { if (errEl) { errEl.textContent = isAr ? 'اسم الأرضية مطلوب' : 'Floor name is required'; errEl.classList.remove('hidden'); } return; }
          if (m.editId) {
            var existing = this.state.floors.find(function (f) { return f.id === m.editId; });
            if (existing) { existing.name = name.trim(); existing.sortOrder = sortOrder; existing.color = floorColor; await DB.update(S.FLOORS, existing.id, existing); Nawa.Auth.apiFetch('/floors/' + existing.id, { method: 'PUT', body: { name: existing.name, sortOrder: existing.sortOrder, color: existing.color } }).catch(function(){}); }
          } else {
            var newItem = { id: Date.now().toString(), name: name.trim(), color: floorColor, sortOrder: sortOrder, createdAt: new Date().toISOString() };
            await DB.add(S.FLOORS, newItem);
            this.state.floors.push(newItem);
            Nawa.Auth.apiFetch('/floors', { method: 'POST', body: { name: newItem.name, color: newItem.color, sortOrder: newItem.sortOrder } }).catch(function(){});
          }
        } else if (m.type === 'discount') {
          var name = (document.getElementById('ds-m-name') || {}).value || '';
          var discType = (document.getElementById('ds-m-discType') || {}).value || 'percent';
          var discValue = parseFloat((document.getElementById('ds-m-discValue') || {}).value) || 0;
          var discActive = (document.getElementById('ds-m-discActive') || {}).value !== 'false';
          if (!name.trim()) { if (errEl) { errEl.textContent = isAr ? 'اسم الخصم مطلوب' : 'Discount name is required'; errEl.classList.remove('hidden'); } return; }
          if (discValue <= 0) { if (errEl) { errEl.textContent = isAr ? 'قيمة الخصم يجب أن تكون أكبر من صفر' : 'Discount value must be greater than zero'; errEl.classList.remove('hidden'); } return; }
          if (discType === 'percent' && discValue > 100) { if (errEl) { errEl.textContent = isAr ? 'النسبة لا يمكن أن تتجاوز 100%' : 'Percentage cannot exceed 100%'; errEl.classList.remove('hidden'); } return; }
          if (m.editId) {
            var existing = this.state.discounts.find(function (d) { return d.id === m.editId; });
            if (existing) {
              existing.name = name.trim();
              existing.type = discType;
              existing.value = discValue;
              existing.active = discActive;
              Nawa.Auth.apiFetch('/discounts/' + existing.id, { method: 'PUT', body: { name: existing.name, type: existing.type, value: existing.value, active: existing.active } }).catch(function(){});
            }
          } else {
            var newItem = { id: Date.now().toString(), name: name.trim(), type: discType, value: discValue, active: discActive, createdAt: new Date().toISOString() };
            this.state.discounts.push(newItem);
            Nawa.Auth.apiFetch('/discounts', { method: 'POST', body: { name: newItem.name, type: newItem.type, value: newItem.value, active: newItem.active } }).catch(function(){});
          }
        }

        this.closeDsModal();
        this.render();
        this.showNotification(isAr ? 'تم الحفظ بنجاح' : 'Saved successfully', 'success');
      } catch (e) {
        if (errEl) {
          errEl.textContent = isAr ? 'حدث خطأ، حاول مرة أخرى' : 'An error occurred, try again';
          errEl.classList.remove('hidden');
        }
      }
    },

    async deleteDsItem(type, id) {
      var isAr = (Nawa.I18n.getLang() === 'ar');
      var msg = isAr ? 'هل أنت متأكد من الحذف؟' : 'Are you sure you want to delete?';
      if (!confirm(msg)) return;

      try {
        if (type === 'product') {
          await DB.hardDelete(S.PRODUCTS, id);
          this.state.products = this.state.products.filter(function (p) { return p.id !== id; });
          Nawa.Auth.apiFetch('/products/' + id, { method: 'DELETE' }).catch(function(){});
        } else if (type === 'category') {
          await DB.hardDelete(S.CATEGORIES, id);
          this.state.categories = this.state.categories.filter(function (c) { return c.id !== id; });
          Nawa.Auth.apiFetch('/categories/' + id, { method: 'DELETE' }).catch(function(){});
        } else if (type === 'table') {
          await DB.hardDelete(S.TABLES, id);
          this.state.tables = this.state.tables.filter(function (t) { return t.id !== id; });
          Nawa.Auth.apiFetch('/tables/' + id, { method: 'DELETE' }).catch(function(){});
        } else if (type === 'floor') {
          await DB.hardDelete(S.FLOORS, id);
          this.state.floors = this.state.floors.filter(function (f) { return f.id !== id; });
          Nawa.Auth.apiFetch('/floors/' + id, { method: 'DELETE' }).catch(function(){});
        } else if (type === 'discount') {
          this.state.discounts = this.state.discounts.filter(function (d) { return d.id !== id; });
          Nawa.Auth.apiFetch('/discounts/' + id, { method: 'DELETE' }).catch(function(){});
        }
        this.render();
        this.showNotification(isAr ? 'تم الحذف بنجاح' : 'Deleted successfully', 'success');
      } catch (e) {
        this.showNotification(isAr ? 'خطأ في الحذف' : 'Error deleting', 'error');
      }
    },

    renderSettings() {
      var st = this.state.settings;
      var t = Nawa.I18n.t;
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;
      var user = Nawa.Auth.getCurrentUser ? Nawa.Auth.getCurrentUser() : null;
      var html = '<div class="admin-settings">';

      html += '<div class="admin-settings-card">';
      html += '<div class="admin-settings-card-header"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ' + (isAr ? 'ملف المطعم' : 'Restaurant Profile') + '</div>';
      html += '<div class="admin-settings-card-body">';
      html += '<div class="admin-settings-row"><div class="admin-settings-label"><span class="admin-settings-label-text">' + (isAr ? 'اسم المطعم' : 'Restaurant Name') + '</span></div><div class="form-group" style="flex:2"><input type="text" class="form-input" id="setting-rest-name" value="' + Admin._escapeHtml(st.restaurantName || '') + '" placeholder="' + (isAr ? 'اسم مطعمك' : 'Your restaurant name') + '"></div></div>';
      html += '<div class="admin-settings-row"><div class="admin-settings-label"><span class="admin-settings-label-text">' + (isAr ? 'رقم الهاتف' : 'Phone') + '</span></div><div class="form-group" style="flex:2"><input type="tel" class="form-input" id="setting-rest-phone" value="' + Admin._escapeHtml(st.restaurantPhone || '') + '" placeholder="05XXXXXXXX" dir="ltr"></div></div>';
      html += '<div class="admin-settings-row"><div class="admin-settings-label"><span class="admin-settings-label-text">' + (isAr ? 'البريد الإلكتروني' : 'Email') + '</span></div><div class="form-group" style="flex:2"><input type="email" class="form-input" id="setting-rest-email" value="' + Admin._escapeHtml(st.restaurantEmail || (user ? user.email || '' : '')) + '" placeholder="email@example.com" dir="ltr"></div></div>';
      html += '</div></div>';

      html += '<div class="admin-settings-card">';
      html += '<div class="admin-settings-card-header"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg> ' + (isAr ? 'تغيير كلمة المرور' : 'Change Password') + '</div>';
      html += '<div class="admin-settings-card-body">';
      html += '<div class="admin-settings-row"><div class="admin-settings-label"><span class="admin-settings-label-text">' + (isAr ? 'كلمة المرور الحالية' : 'Current Password') + '</span></div><div class="form-group" style="flex:2"><input type="password" class="form-input" id="setting-old-password" placeholder="••••••••" dir="ltr"></div></div>';
      html += '<div class="admin-settings-row"><div class="admin-settings-label"><span class="admin-settings-label-text">' + (isAr ? 'كلمة المرور الجديدة' : 'New Password') + '</span></div><div class="form-group" style="flex:2"><input type="password" class="form-input" id="setting-new-password" placeholder="' + (isAr ? '8 أحرف على الأقل' : 'At least 8 characters') + '" dir="ltr"></div></div>';
      html += '<div class="admin-settings-row"><div class="admin-settings-label"><span class="admin-settings-label-text">' + (isAr ? 'تأكيد كلمة المرور' : 'Confirm Password') + '</span></div><div class="form-group" style="flex:2"><input type="password" class="form-input" id="setting-confirm-password" placeholder="••••••••" dir="ltr"></div></div>';
      html += '<button class="btn btn-primary" id="settings-change-password" style="margin-top:8px;">' + (isAr ? 'تحديث كلمة المرور' : 'Update Password') + '</button>';
      html += '</div></div>';

      html += '<div class="admin-settings-card">';
      html += '<div class="admin-settings-card-header"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg> ' + t('settings') + '</div>';
      html += '<div class="admin-settings-card-body">';

      html += '<div class="admin-settings-row">';
      html += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + t('tax_rate') + '</span><span class="admin-settings-label-desc">' + t('tax_rate_desc') + '</span></div>';
      html += '<div class="form-group" style="max-width:120px"><input type="number" class="form-input" id="setting-tax" value="' + Admin._escapeHtml(String(st.taxRate || '0')) + '" min="0" max="100"></div>';
      html += '</div>';

      html += '<div class="admin-settings-row">';
      html += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + t('receipt_header') + '</span><span class="admin-settings-label-desc">' + t('receipt_header_desc') + '</span></div>';
      html += '<div class="form-group" style="flex:2"><input type="text" class="form-input" id="setting-receipt-header" value="' + Admin._escapeHtml(st.receiptHeader || CFG.COMPANY_NAME) + '"></div>';
      html += '</div>';

      html += '<div class="admin-settings-row">';
      html += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + (isAr ? 'تذييل الإيصال' : 'Receipt Footer') + '</span><span class="admin-settings-label-desc">' + (isAr ? 'نص يظهر في أسفل الإيصال' : 'Text shown at bottom of receipt') + '</span></div>';
      html += '<div class="form-group" style="flex:2"><input type="text" class="form-input" id="setting-receipt-footer" value="' + Admin._escapeHtml(st.receiptFooter || '') + '" placeholder="' + (isAr ? 'شكراً لزيارتكم' : 'Thank you for visiting') + '"></div>';
      html += '</div>';

      html += '<div class="admin-settings-row">';
      html += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + (isAr ? 'ساعات العمل' : 'Opening Hours') + '</span><span class="admin-settings-label-desc">' + (isAr ? 'وقت الفتح والإغلاق' : 'Open and close times') + '</span></div>';
      html += '<div class="form-group" style="display:flex;gap:8px;align-items:center;"><input type="time" class="form-input" id="setting-open-time" value="' + Admin._escapeHtml(st.openTime || '09:00') + '" style="max-width:130px;"><span>' + (isAr ? 'إلى' : 'to') + '</span><input type="time" class="form-input" id="setting-close-time" value="' + Admin._escapeHtml(st.closeTime || '23:00') + '" style="max-width:130px;"></div>';
      html += '</div>';

      html += '<div class="admin-settings-row">';
      html += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + (isAr ? 'الحد الأدنى للطلب' : 'Minimum Order') + '</span><span class="admin-settings-label-desc">' + (isAr ? 'أقل مبلغ مسموح للطلب' : 'Minimum allowed order amount') + '</span></div>';
      html += '<div class="form-group" style="max-width:120px"><input type="number" class="form-input" id="setting-min-order" value="' + (st.minOrder || 0) + '" min="0"></div>';
      html += '</div>';

      html += '<div class="admin-settings-row">';
      html += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + t('sync_interval') + '</span><span class="admin-settings-label-desc">' + t('sync_interval_desc') + '</span></div>';
      html += '<div class="form-group" style="max-width:120px"><input type="number" class="form-input" id="setting-sync-interval" value="' + (st.syncInterval || Math.round(CFG.SYNC_INTERVAL / 1000)) + '" min="30"></div>';
      html += '</div>';

      html += '</div></div>';

      html += '<div class="admin-settings-card">';
      html += '<div class="admin-settings-card-header"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg> ' + t('sound_print') + '</div>';
      html += '<div class="admin-settings-card-body">';

      html += '<div class="admin-settings-row">';
      html += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + t('sound_effects') + '</span><span class="admin-settings-label-desc">' + t('sound_effects_desc') + '</span></div>';
      html += '<label class="admin-toggle"><input type="checkbox" id="setting-sound"' + (st.soundEnabled !== false ? ' checked' : '') + '><span class="admin-toggle-slider"></span></label>';
      html += '</div>';

      html += '<div class="admin-settings-row">';
      html += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + t('auto_print') + '</span><span class="admin-settings-label-desc">' + t('auto_print_desc') + '</span></div>';
      html += '<label class="admin-toggle"><input type="checkbox" id="setting-auto-print"' + (st.autoPrint ? ' checked' : '') + '><span class="admin-toggle-slider"></span></label>';
      html += '</div>';

      html += '</div></div>';

      html += '<div class="admin-settings-card">';
      html += '<div class="admin-settings-card-header"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ' + (isAr ? 'تصدير البيانات' : 'Export Data') + '</div>';
      html += '<div class="admin-settings-card-body">';
      html += '<div class="admin-settings-row"><div class="admin-settings-label"><span class="admin-settings-label-text">' + (isAr ? 'تصدير الطلبات' : 'Export Orders') + '</span><span class="admin-settings-label-desc">' + (isAr ? 'تحميل جميع الطلبات كملف CSV' : 'Download all orders as CSV') + '</span></div>';
      html += '<button class="btn btn-outline" id="settings-export-orders">' + (isAr ? 'تصدير' : 'Export') + '</button></div>';
      html += '<div class="admin-settings-row"><div class="admin-settings-label"><span class="admin-settings-label-text">' + (isAr ? 'تصدير المنتجات' : 'Export Products') + '</span><span class="admin-settings-label-desc">' + (isAr ? 'تحميل جميع المنتجات كملف CSV' : 'Download all products as CSV') + '</span></div>';
      html += '<button class="btn btn-outline" id="settings-export-products">' + (isAr ? 'تصدير' : 'Export') + '</button></div>';
      html += '<div class="admin-settings-row"><div class="admin-settings-label"><span class="admin-settings-label-text">' + (isAr ? 'تصدير العملاء' : 'Export Customers') + '</span><span class="admin-settings-label-desc">' + (isAr ? 'تحميل جميع العملاء كملف CSV' : 'Download all customers as CSV') + '</span></div>';
      html += '<button class="btn btn-outline" id="settings-export-customers">' + (isAr ? 'تصدير' : 'Export') + '</button></div>';
      html += '</div></div>';

      html += '<button class="btn btn-primary btn-lg admin-settings-save" id="settings-save-btn"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> ' + t('save_settings') + '</button>';

      html += '<div class="admin-settings-card" style="margin-top:24px;border:1px solid #fee2e2;">';
      html += '<div class="admin-settings-card-header" style="color:#dc2626;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> ' + t('logout') + '</div>';
      html += '<div class="admin-settings-card-body">';
      html += '<div class="admin-settings-row"><div class="admin-settings-label"><span class="admin-settings-label-text">' + t('logout_desc') + '</span></div>';
      html += '<button class="btn btn-danger" id="admin-logout-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> ' + t('logout') + '</button>';
      html += '</div></div></div>';

      html += '</div>';
      return html;
    },

    // === ACTIONS ===

    async filterAuditLogs(filters) {
      Object.assign(this.state.auditFilters, filters);
      this.state.auditPage = 1;
      this.render();
    },

    async verifyAuditIntegrity() {
      var resultEl = document.getElementById('audit-integrity-result');
      if (resultEl) resultEl.innerHTML = '<div class="admin-loading" style="padding:20px"><div class="spinner-lg"></div></div>';

      var valid = true;
      if (window.Nawa.Audit && window.Nawa.Audit.verify) {
        try {
          valid = await window.Nawa.Audit.verify();
        } catch (e) {
          valid = false;
        }
      }

      if (resultEl) {
      var t = Nawa.I18n.t;
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;
        if (valid) {
          resultEl.innerHTML = '<div class="admin-integrity-badge valid" style="margin:8px 0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ' + t('audit_integrity_ok') + '</div>';
          this.showNotification(t('audit_integrity_ok') + ' ✓', 'success');
        } else {
          resultEl.innerHTML = '<div class="admin-integrity-badge invalid" style="margin:8px 0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> ' + t('audit_tampered') + '</div>';
          this.showNotification(t('audit_tampered_warn'), 'error');
        }
      }
    },

    async exportAuditCSV() {
      var entries = this.getFilteredAudit();
      var t = Nawa.I18n.t;
      var rows = [t('csv_header')];

      var self = this;
      entries.forEach(function (e) {
        var row = [
          '"' + (e.timestamp || '') + '"',
          '"' + (e.userName || e.userId || '') + '"',
          '"' + self.getArabicAction(e.action) + '"',
          '"' + self.getArabicStore(e.store) + ' - ' + (e.recordId || '') + '"',
          '"' + (e.hash || '') + '"',
          '"' + (e.details ? JSON.stringify(e.details) : '') + '"'
        ];
        rows.push(row.join(','));
      });

      var csvContent = '\uFEFF' + rows.join('\n');
      var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);

      var a = document.createElement('a');
      a.href = url;
      a.download = 'audit_log_' + new Date().toISOString().split('T')[0] + '.csv';
      a.click();

      URL.revokeObjectURL(url);
      this.showNotification(Nawa.I18n.t('success_export'), 'success');
    },

    showOrderDetails(orderId) {
      var order = null;
      for (var i = 0; i < this.state.orders.length; i++) {
        if (this.state.orders[i].id === orderId) {
          order = this.state.orders[i];
          break;
        }
      }
      if (!order) return;

      var self = this;
      var empName = '--';
      for (var j = 0; j < this.state.employees.length; j++) {
        if (this.state.employees[j].id === order.employeeId) {
          empName = this.state.employees[j].name;
          break;
        }
      }
      var t = Nawa.I18n.t;
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;

      var html = '<div class="modal-overlay" id="order-modal-overlay">';
      html += '<div class="modal">';
      html += '<div class="modal-header"><h3>' + t('order_details') + ' #' + orderId.slice(-6).toUpperCase() + '</h3>';
      html += '<button class="btn btn-ghost btn-icon" id="order-modal-close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
      html += '</div>';
      html += '<div class="modal-body">';

      html += '<div style="display:flex;justify-content:space-between;margin-bottom:12px">';
      html += '<div><strong>' + t('time') + ':</strong> ' + self.formatDate(order.createdAt) + ' ' + self.formatTime(order.createdAt) + '</div>';
      html += '<div><strong>' + t('table') + ':</strong> ' + self._escapeHtml(order.tableNumber || order.tableId || '--') + '</div>';
      html += '</div>';
      html += '<div style="margin-bottom:16px"><strong>' + t('employee') + ':</strong> ' + self._escapeHtml(empName) + '</div>';

      if (order.items && order.items.length > 0) {
        html += '<div class="admin-order-modal-items">';
        order.items.forEach(function (item) {
          html += '<div class="admin-order-modal-item">';
          html += '<span class="admin-order-modal-item-name">' + self._escapeHtml(item.name || t('item_name')) + '</span>';
          html += '<span class="admin-order-modal-item-qty">× ' + (item.qty || 1) + '</span>';
          html += '<span class="admin-order-modal-item-price">' + self.formatCurrency((item.price || 0) * (item.qty || 1)) + '</span>';
          html += '</div>';
        });
        html += '</div>';
      }

      html += '<div class="admin-order-modal-summary">';
      html += '<div class="admin-order-modal-row"><span>' + t('subtotal_label') + '</span><span>' + self.formatCurrency(order.subtotal || order.total || 0) + '</span></div>';
      if (order.tax) {
        html += '<div class="admin-order-modal-row"><span>' + t('tax_label_admin') + '</span><span>' + self.formatCurrency(order.tax) + '</span></div>';
      }
      if (order.discountAmount > 0) {
        html += '<div class="admin-order-modal-row" style="color:#16a34a;"><span>' + (isAr ? 'الخصم' : 'Discount') + ': ' + Admin._escapeHtml(order.discountName || '') + '</span><span>-' + self.formatCurrency(order.discountAmount) + '</span></div>';
      }
      html += '<div class="admin-order-modal-row total"><span>' + t('total_label') + '</span><span>' + self.formatCurrency(order.total || 0) + '</span></div>';
      html += '<div class="admin-order-modal-row"><span>' + t('payment_method_label') + '</span><span>' + (order.paymentMethod === 'card' ? t('payment_card') : t('payment_cash_label')) + '</span></div>';
      html += '</div>';

      html += '</div>';
      html += '<div class="modal-footer"><button class="btn btn-ghost" id="order-modal-close-btn">' + t('close_btn') + '</button></div>';
      html += '</div></div>';

      document.body.insertAdjacentHTML('beforeend', html);

      var closeModal = function () {
        var overlay = document.getElementById('order-modal-overlay');
        if (overlay) overlay.remove();
      };

      var closeBtn = document.getElementById('order-modal-close');
      var closeBtn2 = document.getElementById('order-modal-close-btn');
      var overlay = document.getElementById('order-modal-overlay');

      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      if (closeBtn2) closeBtn2.addEventListener('click', closeModal);
      if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    },

    async toggleEmployeeStatus(employeeId) {
      var emp = null;
      for (var i = 0; i < this.state.employees.length; i++) {
        if (this.state.employees[i].id === employeeId) {
          emp = this.state.employees[i];
          break;
        }
      }
      if (!emp) return;

      var newStatus = !emp.isActive;
      try {
        await DB.update(S.EMPLOYEES, employeeId, { isActive: newStatus });
        emp.isActive = newStatus;

        if (window.Nawa.Audit && window.Nawa.Audit.log) {
          await window.Nawa.Audit.log('edit', 'employees', employeeId, { field: 'isActive', oldValue: !newStatus, newValue: newStatus });
        }

        this.showNotification(newStatus ? Nawa.I18n.t('activate') + ' ' + emp.name : Nawa.I18n.t('deactivate') + ' ' + emp.name, 'success');
        this.render();
      } catch (e) {
        this.showNotification(Nawa.I18n.t('error_generic'), 'error');
      }
    },

    async addEmployee() {
      var editId = (document.getElementById('emp-edit-id') || {}).value || '';
      var username = (document.getElementById('emp-username').value || '').trim();
      var name = (document.getElementById('emp-name').value || '').trim();
      var password = (document.getElementById('emp-password').value || '').trim();
      var role = document.getElementById('emp-role').value;
      var email = (document.getElementById('emp-email').value || '').trim();
      var errorEl = document.getElementById('employee-error');
      var isAr = Nawa.I18n.getLang() === 'ar';

      if (errorEl) errorEl.classList.add('hidden');

      if (!username || !name) {
        if (errorEl) {
          errorEl.textContent = isAr ? 'اسم المستخدم والاسم مطلوبان' : 'Username and name are required';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      if (!editId && !password) {
        if (errorEl) {
          errorEl.textContent = Nawa.I18n.t('required_field');
          errorEl.classList.remove('hidden');
        }
        return;
      }

      try {
        var body = { name: name, username: username, role: role || 'cashier' };
        if (email) body.email = email;
        if (password) body.password = password;

        var method = editId ? 'PUT' : 'POST';
        var url = editId ? '/employees/' + editId : '/employees';
        var response = await Nawa.Auth.apiFetch(url, { method: method, body: body });

        if (!response.ok) {
          var errData = await response.json();
          throw new Error(errData.error || Nawa.I18n.t('employee_add_error'));
        }

        if (window.Nawa.Audit && window.Nawa.Audit.log) {
          await window.Nawa.Audit.log(editId ? 'edit' : 'add', 'employees', editId || username, { name: name, username: username, role: role });
        }

        var overlay = document.getElementById('employee-modal-overlay');
        if (overlay) overlay.classList.add('hidden');
        await this.loadData();
        this.render();
        this.showNotification(editId ? (isAr ? 'تم تحديث الموظف' : 'Employee updated') : Nawa.I18n.t('employee_added') + ': ' + name, 'success');
      } catch (e) {
        if (errorEl) {
          errorEl.textContent = e.message || Nawa.I18n.t('employee_add_error');
          errorEl.classList.remove('hidden');
        }
      }
    },

    async deleteEmployee(employeeId) {
      var isAr = Nawa.I18n.getLang() === 'ar';
      var emp = null;
      for (var i = 0; i < this.state.employees.length; i++) {
        if (this.state.employees[i].id === employeeId) { emp = this.state.employees[i]; break; }
      }
      if (!emp) return;

      var confirmMsg = isAr
        ? 'هل أنت متأكد من حذف "' + emp.name + '"؟ لا يمكن التراجع عن هذا الإجراء.'
        : 'Are you sure you want to delete "' + emp.name + '"? This action cannot be undone.';
      if (!confirm(confirmMsg)) return;

      try {
        var res = await Nawa.Auth.apiFetch('/employees/' + employeeId, { method: 'DELETE' });
        if (!res.ok) {
          var errData = await res.json();
          throw new Error(errData.error || 'Delete failed');
        }
        this.state.employees = this.state.employees.filter(function (e) { return e.id !== employeeId; });
        this.render();
        this.showNotification(isAr ? 'تم حذف "' + emp.name + '"' : 'Deleted "' + emp.name + '"', 'success');
      } catch (e) {
        this.showNotification(e.message || Nawa.I18n.t('error_generic'), 'error');
      }
    },

    async saveCustomer() {
      var self = this;
      var editId = this.state.customerModal.editId;
      var name = (document.getElementById('admin-cust-name').value || '').trim();
      var phone = (document.getElementById('admin-cust-phone').value || '').trim();
      var notes = (document.getElementById('admin-cust-notes').value || '').trim();
      var errorEl = document.getElementById('customer-error');

      if (errorEl) errorEl.classList.add('hidden');

      if (!name) {
        if (errorEl) {
          errorEl.textContent = Nawa.I18n.t('required_field');
          errorEl.classList.remove('hidden');
        }
        return;
      }

      try {
        var method = editId ? 'PUT' : 'POST';
        var url = editId ? '/customers/' + editId : '/customers';
        var response = await Nawa.Auth.apiFetch(url, {
          method: method,
          body: { name: name, phone: phone, notes: notes }
        });

        if (!response.ok) {
          var errData = await response.json();
          throw new Error(errData.error || Nawa.I18n.t('error_generic'));
        }

        var saved = await response.json();

        if (editId) {
          self.state.customers = (self.state.customers || []).map(function (c) {
            return c.id === editId ? saved : c;
          });
        } else {
          self.state.customers.push(saved);
        }

        var overlay = document.getElementById('customer-modal-overlay');
        if (overlay) overlay.classList.add('hidden');
        self.state.customerModal = { open: false, editId: null };
        self.render();
        self.showNotification(editId ? Nawa.I18n.t('success_save') : Nawa.I18n.t('success_save'), 'success');
      } catch (e) {
        if (errorEl) {
          errorEl.textContent = e.message || Nawa.I18n.t('error_generic');
          errorEl.classList.remove('hidden');
        }
      }
    },

    async saveSettings() {
      var taxEl = document.getElementById('setting-tax');
      var receiptEl = document.getElementById('setting-receipt-header');
      var syncEl = document.getElementById('setting-sync-interval');
      var soundEl = document.getElementById('setting-sound');
      var printEl = document.getElementById('setting-auto-print');
      var restNameEl = document.getElementById('setting-rest-name');
      var restPhoneEl = document.getElementById('setting-rest-phone');
      var restEmailEl = document.getElementById('setting-rest-email');
      var receiptFooterEl = document.getElementById('setting-receipt-footer');
      var openTimeEl = document.getElementById('setting-open-time');
      var closeTimeEl = document.getElementById('setting-close-time');
      var minOrderEl = document.getElementById('setting-min-order');

      var settingsToSave = [
        { key: 'taxRate', value: (taxEl ? taxEl.value : '0') || '0' },
        { key: 'receiptHeader', value: (receiptEl ? receiptEl.value : '') || CFG.COMPANY_NAME },
        { key: 'syncInterval', value: (syncEl ? syncEl.value : '300') || '300' },
        { key: 'soundEnabled', value: soundEl ? soundEl.checked : true },
        { key: 'autoPrint', value: printEl ? printEl.checked : false },
        { key: 'restaurantName', value: restNameEl ? restNameEl.value : '' },
        { key: 'restaurantPhone', value: restPhoneEl ? restPhoneEl.value : '' },
        { key: 'restaurantEmail', value: restEmailEl ? restEmailEl.value : '' },
        { key: 'receiptFooter', value: receiptFooterEl ? receiptFooterEl.value : '' },
        { key: 'openTime', value: openTimeEl ? openTimeEl.value : '09:00' },
        { key: 'closeTime', value: closeTimeEl ? closeTimeEl.value : '23:00' },
        { key: 'minOrder', value: minOrderEl ? minOrderEl.value : '0' }
      ];

      var self = this;
      var ops = settingsToSave.map(function (s) {
        return DB.getAll(S.SETTINGS).then(function (existing) {
          var found = null;
          for (var i = 0; i < existing.length; i++) {
            if (existing[i].key === s.key) { found = existing[i]; break; }
          }
          if (found) {
            return DB.update(S.SETTINGS, found.id, { value: s.value });
          } else {
            return DB.add(S.SETTINGS, { key: s.key, value: s.value });
          }
        });
      });

      try {
        await Promise.all(ops);
        settingsToSave.forEach(function (s) { self.state.settings[s.key] = s.value; });
        Nawa.Auth.apiFetch('/settings', { method: 'PUT', body: settingsToSave.map(function(s){ return { key: s.key, value: s.value }; }) }).catch(function(){});
        this.showNotification(Nawa.I18n.t('success_save'), 'success');
      } catch (e) {
        this.showNotification(Nawa.I18n.t('error_generic'), 'error');
      }
    },

    _exportCSV(store, filename) {
      var self = this;
      var isAr = (window.Nawa.I18n && window.Nawa.I18n.getLang) ? window.Nawa.I18n.getLang() === 'ar' : true;
      Nawa.DB.getAll(store).then(function (rows) {
        if (!rows || rows.length === 0) { self.showNotification(isAr ? 'لا توجد بيانات للتصدير' : 'No data to export', 'warning'); return; }
        var headers = Object.keys(rows[0]).filter(function (k) { return k !== 'deletedAt'; });
        var csvRows = [headers.join(',')];
        rows.forEach(function (row) {
          var line = headers.map(function (h) {
            var val = row[h];
            if (val === null || val === undefined) return '';
            if (typeof val === 'object') val = JSON.stringify(val);
            return '"' + String(val).replace(/"/g, '""') + '"';
          });
          csvRows.push(line.join(','));
        });
        var blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
        self.showNotification(isAr ? 'تم التصدير بنجاح' : 'Exported successfully', 'success');
      }).catch(function () {
        self.showNotification(isAr ? 'خطأ في التصدير' : 'Export error', 'error');
      });
    },

    showNotification(message, type) {
      var container = document.querySelector('.toast-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
      }

      var toast = document.createElement('div');
      toast.className = 'toast toast-' + (type || 'info');

      var icon = '';
      if (type === 'success') icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      else if (type === 'error') icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
      else if (type === 'warning') icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

      toast.innerHTML = icon + '<span>' + this._escapeHtml(message) + '</span>';
      container.appendChild(toast);

      setTimeout(function () {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(function () { toast.remove(); }, 300);
      }, 3000);
    },

    attachEvents() {
      var self = this;

      var sidebarLinks = document.querySelectorAll('.admin-sidebar-link');
      sidebarLinks.forEach(function (link) {
        link.addEventListener('click', function (e) {
          e.preventDefault();
          var tab = link.getAttribute('data-tab');
          self.state.activeTab = tab;
          self.state.sidebarOpen = false;
          self.render();
        });
      });

      var backBtn = document.getElementById('admin-back-pos');
      if (backBtn) {
        backBtn.addEventListener('click', function () {
          window.location.hash = '#/pos';
        });
      }

      var mobileToggle = document.getElementById('admin-mobile-toggle');
      if (mobileToggle) {
        mobileToggle.addEventListener('click', function () {
          self.state.sidebarOpen = !self.state.sidebarOpen;
          self.render();
        });
      }

      var overlay = document.getElementById('admin-overlay');
      if (overlay) {
        overlay.addEventListener('click', function () {
          self.state.sidebarOpen = false;
          self.render();
        });
      }

      var orderClickables = document.querySelectorAll('.admin-order-clickable');
      orderClickables.forEach(function (el) {
        el.addEventListener('click', function () {
          self.showOrderDetails(el.getAttribute('data-order-id'));
        });
      });

      var toggleEmpBtns = document.querySelectorAll('[data-toggle-emp]');
      toggleEmpBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          self.toggleEmployeeStatus(btn.getAttribute('data-toggle-emp'));
        });
      });

      var deleteEmpBtns = document.querySelectorAll('[data-delete-emp]');
      deleteEmpBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          self.deleteEmployee(btn.getAttribute('data-delete-emp'));
        });
      });

      var editEmpBtns = document.querySelectorAll('[data-edit-emp]');
      editEmpBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var eid = btn.getAttribute('data-edit-emp');
          var emp = (self.state.employees || []).find(function (e) { return e.id === eid; });
          if (!emp) return;
          document.getElementById('emp-edit-id').value = eid;
          document.getElementById('emp-username').value = emp.username || '';
          document.getElementById('emp-name').value = emp.name || '';
          document.getElementById('emp-password').value = '';
          document.getElementById('emp-role').value = emp.role || 'cashier';
          document.getElementById('emp-email').value = emp.email || '';
          document.getElementById('emp-email-group').style.display = emp.role === 'admin' ? 'block' : 'none';
          document.getElementById('emp-username').disabled = true;
          var titleEl = document.getElementById('employee-modal-title');
          if (titleEl) titleEl.textContent = Nawa.I18n.getLang() === 'ar' ? 'تعديل الموظف' : 'Edit Employee';
          var overlay = document.getElementById('employee-modal-overlay');
          if (overlay) overlay.classList.remove('hidden');
        });
      });

      var addEmpBtn = document.getElementById('add-employee-btn');
      if (addEmpBtn) {
        addEmpBtn.addEventListener('click', function () {
          document.getElementById('emp-edit-id').value = '';
          document.getElementById('emp-username').value = '';
          document.getElementById('emp-username').disabled = false;
          document.getElementById('emp-name').value = '';
          document.getElementById('emp-password').value = '';
          document.getElementById('emp-role').value = 'cashier';
          document.getElementById('emp-email').value = '';
          document.getElementById('emp-email-group').style.display = 'none';
          var titleEl = document.getElementById('employee-modal-title');
          if (titleEl) titleEl.textContent = Nawa.I18n.t('add_employee');
          var errorEl = document.getElementById('employee-error');
          if (errorEl) errorEl.classList.add('hidden');
          var overlay = document.getElementById('employee-modal-overlay');
          if (overlay) overlay.classList.remove('hidden');
        });
      }

      var empRoleSelect = document.getElementById('emp-role');
      if (empRoleSelect) {
        empRoleSelect.addEventListener('change', function () {
          var emailGroup = document.getElementById('emp-email-group');
          if (emailGroup) emailGroup.style.display = empRoleSelect.value === 'admin' ? 'block' : 'none';
        });
      }

      var empModalClose = document.getElementById('employee-modal-close');
      var empModalCancel = document.getElementById('employee-modal-cancel');
      var empModalOverlay = document.getElementById('employee-modal-overlay');
      var empModalSave = document.getElementById('employee-modal-save');

      var closeEmpModal = function () {
        var overlay = document.getElementById('employee-modal-overlay');
        if (overlay) overlay.classList.add('hidden');
      };

      if (empModalClose) empModalClose.addEventListener('click', closeEmpModal);
      if (empModalCancel) empModalCancel.addEventListener('click', closeEmpModal);
      if (empModalOverlay) empModalOverlay.addEventListener('click', function (e) { if (e.target === empModalOverlay) closeEmpModal(); });
      if (empModalSave) empModalSave.addEventListener('click', function () { self.addEmployee(); });

      var addCustBtn = document.getElementById('add-customer-btn');
      if (addCustBtn) {
        addCustBtn.addEventListener('click', function () {
          self.state.customerModal = { open: true, editId: null };
          var overlay = document.getElementById('customer-modal-overlay');
          if (overlay) overlay.classList.remove('hidden');
        });
      }

      var editCustBtns = document.querySelectorAll('[data-edit-customer]');
      editCustBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var cid = btn.getAttribute('data-edit-customer');
          self.state.customerModal = { open: true, editId: cid };
          var cust = (self.state.customers || []).find(function (c) { return c.id === cid; });
          var overlay = document.getElementById('customer-modal-overlay');
          if (overlay) overlay.classList.remove('hidden');
          var titleEl = document.getElementById('customer-modal-title');
          if (titleEl) titleEl.textContent = Nawa.I18n.t('edit');
          var nameInput = document.getElementById('admin-cust-name');
          var phoneInput = document.getElementById('admin-cust-phone');
          var notesInput = document.getElementById('admin-cust-notes');
          if (cust) {
            if (nameInput) nameInput.value = cust.name || '';
            if (phoneInput) phoneInput.value = cust.phone || '';
            if (notesInput) notesInput.value = cust.notes || '';
          }
        });
      });

      var deleteCustBtns = document.querySelectorAll('[data-delete-customer]');
      deleteCustBtns.forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var cid = btn.getAttribute('data-delete-customer');
          if (!confirm((Nawa.I18n.getLang() === 'ar') ? 'هل أنت متأكد من حذف هذا العميل؟' : 'Are you sure you want to delete this customer?')) return;
          try {
            var res = await Nawa.Auth.apiFetch('/customers/' + cid, { method: 'DELETE' });
            if (res.ok) {
              self.state.customers = (self.state.customers || []).filter(function (c) { return c.id !== cid; });
              self.render();
              self.showNotification(Nawa.I18n.t('deleted'), 'success');
            }
          } catch (e) {
            self.showNotification(Nawa.I18n.t('error_network'), 'error');
          }
        });
      });

      var custModalClose = document.getElementById('customer-modal-close');
      var custModalCancel = document.getElementById('customer-modal-cancel');
      var custModalOverlay = document.getElementById('customer-modal-overlay');
      var custModalSave = document.getElementById('customer-modal-save');

      var closeCustModal = function () {
        var overlay = document.getElementById('customer-modal-overlay');
        if (overlay) overlay.classList.add('hidden');
        self.state.customerModal = { open: false, editId: null };
      };

      if (custModalClose) custModalClose.addEventListener('click', closeCustModal);
      if (custModalCancel) custModalCancel.addEventListener('click', closeCustModal);
      if (custModalOverlay) custModalOverlay.addEventListener('click', function (e) { if (e.target === custModalOverlay) closeCustModal(); });
      if (custModalSave) custModalSave.addEventListener('click', function () { self.saveCustomer(); });

      if (this.state.activeTab === 'audit') {
        var dateFrom = document.getElementById('audit-date-from');
        var dateTo = document.getElementById('audit-date-to');
        var userFilter = document.getElementById('audit-user-filter');
        var actionFilter = document.getElementById('audit-action-filter');
        var searchInput = document.getElementById('audit-search');

        if (dateFrom) {
          dateFrom.addEventListener('change', function () {
            self.filterAuditLogs({ dateFrom: dateFrom.value });
          });
        }
        if (dateTo) {
          dateTo.addEventListener('change', function () {
            self.filterAuditLogs({ dateTo: dateTo.value });
          });
        }
        if (userFilter) {
          userFilter.addEventListener('change', function () {
            self.filterAuditLogs({ user: userFilter.value });
          });
        }
        if (actionFilter) {
          actionFilter.addEventListener('change', function () {
            self.filterAuditLogs({ action: actionFilter.value });
          });
        }
        if (searchInput) {
          var searchTimeout;
          searchInput.addEventListener('input', function () {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(function () {
              self.filterAuditLogs({ search: searchInput.value });
            }, 300);
          });
        }

        var verifyBtn = document.getElementById('audit-verify-btn');
        if (verifyBtn) {
          verifyBtn.addEventListener('click', function () { self.verifyAuditIntegrity(); });
        }

        var exportBtn = document.getElementById('audit-export-btn');
        if (exportBtn) {
          exportBtn.addEventListener('click', function () { self.exportAuditCSV(); });
        }

        var expandBtns = document.querySelectorAll('.admin-audit-expand-btn');
        expandBtns.forEach(function (btn) {
          btn.addEventListener('click', function () {
            var idx = btn.getAttribute('data-idx');
            var detailRow = document.getElementById('audit-detail-' + idx);
            if (detailRow) {
              var isOpen = detailRow.classList.contains('open');
              document.querySelectorAll('.admin-audit-detail-row.open').forEach(function (r) { r.classList.remove('open'); });
              document.querySelectorAll('.admin-audit-expand-btn.open').forEach(function (b) { b.classList.remove('open'); });
              if (!isOpen) {
                detailRow.classList.add('open');
                btn.classList.add('open');
              }
            }
          });
        });

        var prevBtn = document.getElementById('audit-page-prev');
        var nextBtn = document.getElementById('audit-page-next');
        if (prevBtn) {
          prevBtn.addEventListener('click', function () {
            if (self.state.auditPage > 1) {
              self.state.auditPage--;
              self.render();
            }
          });
        }
        if (nextBtn) {
          nextBtn.addEventListener('click', function () {
            var totalPages = Math.ceil(self.getFilteredAudit().length / self.state.auditPerPage);
            if (self.state.auditPage < totalPages) {
              self.state.auditPage++;
              self.render();
            }
          });
        }

        var pageBtns = document.querySelectorAll('.admin-audit-page-btn[data-page]');
        pageBtns.forEach(function (btn) {
          btn.addEventListener('click', function () {
            self.state.auditPage = parseInt(btn.getAttribute('data-page'));
            self.render();
          });
        });
      }

      if (this.state.activeTab === 'daily-report') {
        var dailyDate = document.getElementById('daily-report-date');
        var dailyLoad = document.getElementById('daily-report-load');
        var dailyPrint = document.getElementById('daily-report-print');

        if (dailyLoad) {
          dailyLoad.addEventListener('click', function () { self.loadDailyReport(); });
        }
        if (dailyDate) {
          dailyDate.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { self.loadDailyReport(); }
          });
        }
        if (dailyPrint) {
          dailyPrint.addEventListener('click', function () { self.printDailyReport(); });
        }

        if (!this.state.dailyReport && !this.state.dailyReportLoading) {
          this.loadDailyReport();
        }
      }

      if (this.state.activeTab === 'order-history') {
        var ohDateFrom = document.getElementById('oh-date-from');
        var ohDateTo = document.getElementById('oh-date-to');
        var ohFetchBtn = document.getElementById('oh-fetch-btn');
        var ohSearch = document.getElementById('oh-search');
        var ohExportBtn = document.getElementById('oh-export-btn');

        if (ohFetchBtn) {
          ohFetchBtn.addEventListener('click', function () {
            if (ohDateFrom) self.state.orderHistoryFilters.from = ohDateFrom.value;
            if (ohDateTo) self.state.orderHistoryFilters.to = ohDateTo.value;
            self.fetchOrderHistory();
          });
        }
        if (ohSearch) {
          var ohSearchTimeout;
          ohSearch.addEventListener('input', function () {
            clearTimeout(ohSearchTimeout);
            ohSearchTimeout = setTimeout(function () {
              self.state.orderHistorySearch = ohSearch.value;
              self.render();
            }, 300);
          });
        }
        if (ohExportBtn) {
          ohExportBtn.addEventListener('click', function () { self.exportOrderHistoryCSV(); });
        }

        var ohExpandBtns = document.querySelectorAll('.admin-oh-expand-btn');
        ohExpandBtns.forEach(function (btn) {
          btn.addEventListener('click', function () {
            var idx = btn.getAttribute('data-oh-idx');
            var detailRow = document.getElementById('oh-detail-' + idx);
            if (detailRow) {
              var isOpen = detailRow.classList.contains('open');
              document.querySelectorAll('.admin-oh-detail-row.open').forEach(function (r) { r.classList.remove('open'); });
              document.querySelectorAll('.admin-oh-expand-btn.open').forEach(function (b) { b.classList.remove('open'); });
              if (!isOpen) {
                detailRow.classList.add('open');
                btn.classList.add('open');
              }
            }
          });
        });

        if (this.state.orderHistory.length === 0 && !this.state.orderHistoryLoading && !this.state._orderHistoryFetched) {
          this.fetchOrderHistory();
        }
      }

      if (this.state.activeTab === 'settings') {
        var saveBtn = document.getElementById('settings-save-btn');
        if (saveBtn) {
          saveBtn.addEventListener('click', function () { self.saveSettings(); });
        }
        var logoutBtn = document.getElementById('admin-logout-btn');
        if (logoutBtn) {
          logoutBtn.addEventListener('click', function () {
            Nawa.Auth.logout();
            window.location.hash = '#/login';
          });
        }
        var changePwdBtn = document.getElementById('settings-change-password');
        if (changePwdBtn) {
          changePwdBtn.addEventListener('click', function () {
            var oldPwd = document.getElementById('setting-old-password').value;
            var newPwd = document.getElementById('setting-new-password').value;
            var confirmPwd = document.getElementById('setting-confirm-password').value;
            if (!oldPwd || !newPwd) { self.showNotification(isAr ? 'أدخل كلمة المرور الجديدة' : 'Enter new password', 'error'); return; }
            if (newPwd.length < 6) { self.showNotification(isAr ? 'كلمة المرور 6 أحرف على الأقل' : 'Password must be at least 6 characters', 'error'); return; }
            if (newPwd !== confirmPwd) { self.showNotification(isAr ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match', 'error'); return; }
            Nawa.Auth.apiFetch('/auth/change-password', { method: 'POST', body: { oldPassword: oldPwd, newPassword: newPwd } }).then(function (res) {
              if (res.ok) { self.showNotification(isAr ? 'تم تحديث كلمة المرور' : 'Password updated', 'success'); document.getElementById('setting-old-password').value = ''; document.getElementById('setting-new-password').value = ''; document.getElementById('setting-confirm-password').value = ''; }
              else { res.json().then(function (d) { self.showNotification(d.error || 'Error', 'error'); }); }
            }).catch(function () { self.showNotification(isAr ? 'خطأ في الشبكة' : 'Network error', 'error'); });
          });
        }
        var exportOrdersBtn = document.getElementById('settings-export-orders');
        if (exportOrdersBtn) {
          exportOrdersBtn.addEventListener('click', function () { self._exportCSV('orders', 'orders.csv'); });
        }
        var exportProductsBtn = document.getElementById('settings-export-products');
        if (exportProductsBtn) {
          exportProductsBtn.addEventListener('click', function () { self._exportCSV('products', 'products.csv'); });
        }
        var exportCustomersBtn = document.getElementById('settings-export-customers');
        if (exportCustomersBtn) {
          exportCustomersBtn.addEventListener('click', function () { self._exportCSV('customers', 'customers.csv'); });
        }
      }

      if (this.state.activeTab === 'dashboard-settings') {
        document.querySelectorAll('.ds-tab-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            self.state.dsActiveTab = btn.getAttribute('data-ds-tab');
            self.render();
          });
        });

        document.querySelectorAll('.ds-add-item').forEach(function (btn) {
          btn.addEventListener('click', function () {
            self.openDsModal(btn.getAttribute('data-ds-type'));
          });
        });

        document.querySelectorAll('.ds-edit-item').forEach(function (btn) {
          btn.addEventListener('click', function () {
            self.openDsModal(btn.getAttribute('data-ds-type'), btn.getAttribute('data-id'));
          });
        });

        document.querySelectorAll('.ds-delete-item').forEach(function (btn) {
          btn.addEventListener('click', function () {
            self.deleteDsItem(btn.getAttribute('data-ds-type'), btn.getAttribute('data-id'));
          });
        });

        var dsModalClose = document.getElementById('ds-modal-close');
        var dsModalCancel = document.getElementById('ds-modal-cancel');
        var dsModalOverlay = document.getElementById('ds-modal-overlay');
        var dsModalSave = document.getElementById('ds-modal-save');

        var closeDsModal = function () { self.closeDsModal(); };
        if (dsModalClose) dsModalClose.addEventListener('click', closeDsModal);
        if (dsModalCancel) dsModalCancel.addEventListener('click', closeDsModal);
        if (dsModalOverlay) dsModalOverlay.addEventListener('click', function (e) { if (e.target === dsModalOverlay) closeDsModal(); });
        if (dsModalSave) dsModalSave.addEventListener('click', function () { self.saveDsModalItem(); });

        var dsSaveFeat = document.getElementById('ds-save-features');
        if (dsSaveFeat) {
          dsSaveFeat.addEventListener('click', function () { self.saveDashboardSettings(); });
        }

        var dsSaveBiz = document.getElementById('ds-save-business');
        if (dsSaveBiz) {
          dsSaveBiz.addEventListener('click', function () { self.saveDashboardSettings(); });
        }
      }
    }
  };

  window.Nawa = window.Nawa || {};
  window.Nawa.Admin = Admin;
})();
