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
      sidebarOpen: false
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
        var orders = await DB.getAll(S.ORDERS);
        var tables = await DB.getAll(S.TABLES);
        var employees = await DB.getAll(S.EMPLOYEES);
        var auditEntries = await DB.getAll(S.AUDIT_LOG);
        var settingsArr = await DB.getAll(S.SETTINGS);

        var settings = {};
        settingsArr.forEach(function (s) { settings[s.key] = s.value; });

        this.state.orders = orders || [];
        this.state.tables = tables || [];
        this.state.employees = employees || [];
        this.state.auditEntries = auditEntries || [];
        this.state.settings = settings;

        this.calculateStats();
      } catch (e) {
        console.error('Admin loadData error:', e);
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
        case 'employees': html += this.renderEmployees(); break;
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
        { id: 'employees', label: isAr ? 'الموظفين' : 'Employees', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>' },
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

      html += '<div class="admin-sidebar-footer">';
      html += '<button class="admin-sidebar-back" id="admin-back-pos">';
      html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
      html += '<span>' + (isAr ? 'الرجوع للنقطة' : 'Back to POS') + '</span>';
      html += '</button>';
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
        employees: (window.Nawa.I18n.getLang() === 'ar') ? 'الموظفين' : 'Employees',
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
          html += '<span class="admin-hbar-name">' + p.name + '</span>';
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
          userOptions += '<option value="' + e.userId + '">' + (e.userName || e.userId) + '</option>';
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
          html += '<td>' + (entry.userName || entry.userId || '--') + '</td>';
          html += '<td><span class="admin-action-badge ' + actionClass + '">' + actionLabel + '</span></td>';
          html += '<td>' + storeLabel + ' - ' + recordDisplay + '</td>';
          html += '<td>' + (entry.details ? (typeof entry.details === 'string' ? entry.details.slice(0, 40) : Nawa.I18n.t('details')) : '--') + '</td>';
          html += '<td><span class="admin-audit-hash" title="' + (entry.hash || '') + '">' + hashDisplay + '</td>';
          html += '</tr>';

          html += '<tr class="admin-audit-detail-row" id="audit-detail-' + idx + '">';
          html += '<td colspan="7">';
          html += '<div class="admin-audit-detail-content">';
          html += '<div class="admin-audit-detail-label">' + t('record_details') + '</div>';
          html += '<pre>' + detailText + '</pre>';
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

    renderEmployees() {
      var self = this;
      var employees = this.state.employees;
      var orders = this.state.orders;
      var isAr = Nawa.I18n.getLang() === 'ar';

      var html = '<div class="admin-employees">';

      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">';
      html += '<h2 style="margin:0;font-size:1.2rem;font-weight:700;color:var(--navy,#0E1C3D);">' + Nawa.I18n.t('employees') + ' (' + employees.length + ')</h2>';
      html += '<button class="btn btn-primary" id="add-employee-btn" style="display:flex;align-items:center;gap:6px;">';
      html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      html += Nawa.I18n.t('add_employee');
      html += '</button></div>';

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
        html += '<div class="admin-employee-name">' + self._escapeHtml(emp.name || emp.nameEn || '--') + '</div>';
        html += '<div class="admin-employee-role">' + self._escapeHtml(roleLabel) + ' - @' + self._escapeHtml(emp.username || '') + '</div>';
        html += '</div>';
        html += '<span class="admin-employee-status ' + statusClass + '"><span class="admin-employee-status-dot"></span>' + statusLabel + '</span>';
        html += '</div>';

        html += '<div class="admin-employee-stats">';
        html += '<div class="admin-employee-stat"><div class="admin-employee-stat-value">' + self.formatNumber(paidOrders.length) + '</div><div class="admin-employee-stat-label">' + Nawa.I18n.t('completed_orders') + '</div></div>';
        html += '<div class="admin-employee-stat"><div class="admin-employee-stat-value">' + self.formatCurrency(empSales) + '</div><div class="admin-employee-stat-label">' + Nawa.I18n.t('total_sales') + '</div></div>';
        html += '</div>';

        html += '<div class="admin-employee-actions">';
        html += '<button class="btn btn-sm ' + (emp.isActive ? 'btn-danger' : 'btn-success') + '" data-toggle-emp="' + emp.id + '">' + (emp.isActive ? Nawa.I18n.t('deactivate') : Nawa.I18n.t('activate')) + '</button>';
        html += '</div>';
        html += '</div>';
      });

      html += '</div>';

      html += '<div class="modal-overlay hidden" id="employee-modal-overlay">';
      html += '<div class="modal">';
      html += '<div class="modal-header"><h3>' + Nawa.I18n.t('add_employee') + '</h3>';
      html += '<button class="btn btn-ghost btn-icon" id="employee-modal-close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
      html += '<div class="modal-body">';
      html += '<div id="employee-error" class="hidden" style="color:#ef4444;text-align:center;margin-bottom:12px;font-size:14px;"></div>';
      html += '<div class="form-group"><label>' + Nawa.I18n.t('employee_name') + ' *</label>';
      html += '<input type="text" class="form-input" id="emp-name" placeholder="' + Nawa.I18n.t('employee_name') + '"></div>';
      html += '<div class="form-group"><label>' + Nawa.I18n.t('employee_name_en') + '</label>';
      html += '<input type="text" class="form-input" id="emp-name-en" placeholder="' + Nawa.I18n.t('employee_name_en') + '" dir="ltr"></div>';
      html += '<div class="form-group"><label>' + Nawa.I18n.t('employee_username') + ' *</label>';
      html += '<input type="text" class="form-input" id="emp-username" placeholder="' + Nawa.I18n.t('employee_username') + '" dir="ltr" autocomplete="off"></div>';
      html += '<div class="form-group"><label>' + Nawa.I18n.t('employee_password') + ' *</label>';
      html += '<input type="password" class="form-input" id="emp-password" placeholder="' + Nawa.I18n.t('employee_password') + '" dir="ltr" autocomplete="off"></div>';
      html += '<div class="form-group"><label>' + Nawa.I18n.t('employee_role') + '</label>';
      html += '<select class="form-input" id="emp-role">';
      html += '<option value="cashier">' + Nawa.I18n.t('role_cashier') + '</option>';
      html += '<option value="admin">' + Nawa.I18n.t('role_admin') + '</option>';
      html += '</select></div>';
      html += '</div>';
      html += '<div class="modal-footer">';
      html += '<button class="btn btn-ghost" id="employee-modal-cancel">' + Nawa.I18n.t('close_btn') + '</button>';
      html += '<button class="btn btn-primary" id="employee-modal-save">' + Nawa.I18n.t('save') + '</button>';
      html += '</div></div></div>';

      html += '</div>';
      return html;
    },

    renderSettings() {
      var st = this.state.settings;
      var t = Nawa.I18n.t;
      var html = '<div class="admin-settings">';

      html += '<div class="admin-settings-card">';
      html += '<div class="admin-settings-card-header"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg> ' + t('settings') + '</div>';
      html += '<div class="admin-settings-card-body">';

      html += '<div class="admin-settings-row">';
      html += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + t('tax_rate') + '</span><span class="admin-settings-label-desc">' + t('tax_rate_desc') + '</span></div>';
      html += '<div class="form-group" style="max-width:120px"><input type="number" class="form-input" id="setting-tax" value="' + (st.taxRate || '15') + '" min="0" max="100"></div>';
      html += '</div>';

      html += '<div class="admin-settings-row">';
      html += '<div class="admin-settings-label"><span class="admin-settings-label-text">' + t('receipt_header') + '</span><span class="admin-settings-label-desc">' + t('receipt_header_desc') + '</span></div>';
      html += '<div class="form-group" style="flex:2"><input type="text" class="form-input" id="setting-receipt-header" value="' + (st.receiptHeader || CFG.COMPANY_NAME) + '"></div>';
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

      html += '<button class="btn btn-primary btn-lg admin-settings-save" id="settings-save-btn"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> ' + t('save_settings') + '</button>';

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
      var name = (document.getElementById('emp-name').value || '').trim();
      var nameEn = (document.getElementById('emp-name-en').value || '').trim();
      var username = (document.getElementById('emp-username').value || '').trim();
      var password = (document.getElementById('emp-password').value || '').trim();
      var role = document.getElementById('emp-role').value;
      var errorEl = document.getElementById('employee-error');

      if (errorEl) errorEl.classList.add('hidden');

      if (!name || !username || !password) {
        if (errorEl) {
          errorEl.textContent = Nawa.I18n.t('required_field');
          errorEl.classList.remove('hidden');
        }
        return;
      }

      for (var i = 0; i < this.state.employees.length; i++) {
        if (this.state.employees[i].username === username) {
          if (errorEl) {
            errorEl.textContent = Nawa.I18n.getLang() === 'ar' ? 'اسم المستخدم مستخدم بالفعل' : 'Username already taken';
            errorEl.classList.remove('hidden');
          }
          return;
        }
      }

      try {
        var response = await Nawa.Auth.apiFetch('/employees', {
          method: 'POST',
          body: {
            name: name,
            nameEn: nameEn || name,
            username: username,
            password: password,
            role: role || 'cashier'
          }
        });

        if (!response.ok) {
          var errData = await response.json();
          throw new Error(errData.error || Nawa.I18n.t('employee_add_error'));
        }

        var saved = await response.json();

        if (window.Nawa.Audit && window.Nawa.Audit.log) {
          await window.Nawa.Audit.log('add', 'employees', saved.id, { name: name, username: username, role: role });
        }

        this.showNotification(Nawa.I18n.t('employee_added'), 'success');
        var overlay = document.getElementById('employee-modal-overlay');
        if (overlay) overlay.classList.add('hidden');
        await this.loadData();
        this.render();
      } catch (e) {
        if (errorEl) {
          errorEl.textContent = Nawa.I18n.t('employee_add_error');
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
      if (!taxEl || !receiptEl || !syncEl || !soundEl || !printEl) return;

      var settingsToSave = [
        { key: 'taxRate', value: taxEl.value || '15' },
        { key: 'receiptHeader', value: receiptEl.value || CFG.COMPANY_NAME },
        { key: 'syncInterval', value: syncEl.value || '300' },
        { key: 'soundEnabled', value: soundEl.checked },
        { key: 'autoPrint', value: printEl.checked }
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
        this.showNotification(Nawa.I18n.t('success_save'), 'success');
      } catch (e) {
        this.showNotification(Nawa.I18n.t('error_generic'), 'error');
      }
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

      var addEmpBtn = document.getElementById('add-employee-btn');
      if (addEmpBtn) {
        addEmpBtn.addEventListener('click', function () {
          var overlay = document.getElementById('employee-modal-overlay');
          if (overlay) overlay.classList.remove('hidden');
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

      if (this.state.activeTab === 'settings') {
        var saveBtn = document.getElementById('settings-save-btn');
        if (saveBtn) {
          saveBtn.addEventListener('click', function () { self.saveSettings(); });
        }
      }
    }
  };

  window.Nawa = window.Nawa || {};
  window.Nawa.Admin = Admin;
})();
