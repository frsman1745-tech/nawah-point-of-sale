/* ========================================================
   Super Admin Module - نواة POS
   ======================================================== */

Nawa.SuperAdmin = {
  _passwordCache: {},
  state: {
    restaurants: [],
    stats: { total: 0, active: 0, suspended: 0, inactive: 0, revenue: 0 },
    selectedRestaurant: null,
    currentView: 'dashboard',
    searchQuery: '',
    filterStatus: 'all',
    salesReport: null,
    reportWeeks: 1,
    registrations: [],
    pendingCount: 0
  },

  async init() {
    if (Nawa.Auth && Nawa.Auth.requireAuth) {
      var user = Nawa.Auth.requireAuth('super_admin');
      if (!user) return;
    }
    await Promise.all([this.loadData(), this.loadRegistrations()]);
    this.render();
  },

  async loadData() {
    try {
      // Try API first
      const session = JSON.parse(localStorage.getItem('nawa_session') || '{}');
      if (session.token) {
        const res = await fetch(Nawa.CONFIG.API_BASE + '/restaurants', {
          headers: { 'Authorization': 'Bearer ' + session.token }
        });
        if (res.ok) {
          const restaurants = await res.json();
          this.state.restaurants = restaurants;
          this._updateStats(restaurants);
          return;
        }
      }
    } catch (e) {
      console.warn('API load failed, using IndexedDB:', e.message);
    }

    // Fallback to IndexedDB
    try {
      const allRestaurants = await Nawa.DB.getAll('restaurants') || [];
      this.state.restaurants = allRestaurants;
      this._updateStats(allRestaurants);
    } catch (e) {
      this.state.restaurants = [];
      this.state.stats = { total: 0, active: 0, suspended: 0, inactive: 0, revenue: 0 };
    }
  },

  async loadRegistrations() {
    try {
      var session = Nawa.Auth ? Nawa.Auth.getCurrentUser() : null;
      if (session && session.token) {
        var isAr = (Nawa.I18n && Nawa.I18n.getLang) ? Nawa.I18n.getLang() === 'ar' : true;
        const res = await fetch(Nawa.CONFIG.API_BASE + '/registrations?status=pending', {
          headers: { 'Authorization': 'Bearer ' + session.token }
        });
        if (res.ok) {
          const regs = await res.json();
          this.state.registrations = regs;
          this.state.pendingCount = regs.length;
          return;
        }
      }
    } catch (e) {
      console.warn('Failed to load registrations:', e.message);
    }
    this.state.registrations = [];
    this.state.pendingCount = 0;
  },

  _updateStats(restaurants) {
    this.state.stats = {
      total: restaurants.length,
      active: restaurants.filter(r => r.status === 'active').length,
      suspended: restaurants.filter(r => r.status === 'suspended').length,
      inactive: restaurants.filter(r => r.status === 'inactive').length,
      revenue: restaurants.reduce((sum, r) => sum + (r.revenue || 0), 0)
    };
  },

  render() {
    const app = document.getElementById('app');
    if (!app) return;

    const view = this.state.currentView;
    app.innerHTML = `
    <div class="sa-layout">
      ${this.renderSidebar()}
      <main class="sa-main">
        ${this.renderTopbar()}
        <div class="sa-content">
          ${view === 'dashboard' ? this.renderDashboard() :
            view === 'restaurants' ? this.renderRestaurants() :
            view === 'registrations' ? this.renderRegistrations() :
            view === 'plans' ? this.renderPlans() :
            view === 'weekly-sales' ? this.renderWeeklySales() :
            this.renderDashboard()}
        </div>
      </main>
    </div>
    <div id="sa-modal-root"></div>
    <div id="sa-toast" class="sa-toast"></div>`;

    this.bindEvents();
  },

  renderSidebar() {
    const isAr = (Nawa.I18n && Nawa.I18n.getLang) ? Nawa.I18n.getLang() === 'ar' : true;
    const nav = [
      { id: 'dashboard', label: isAr ? 'لوحة التحكم' : 'Dashboard', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' },
      { id: 'registrations', label: isAr ? 'طلبات التسجيل' : 'Registrations', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>', badge: this.state.pendingCount || '' },
      { id: 'restaurants', label: isAr ? 'المطاعم' : 'Restaurants', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21V7l9-4 9 4v14"/><path d="M9 21V11h6v10"/></svg>' },
      { id: 'plans', label: isAr ? 'الباقات' : 'Plans', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>' },
      { id: 'weekly-sales', label: isAr ? 'تقرير المبيعات الأسبوعي' : 'Weekly Sales', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>' },
    ];

    return `
    <aside class="sa-sidebar">
      <div class="sa-sidebar-header">
        <div class="sa-sidebar-logo">
          <svg width="36" height="36" viewBox="0 0 100 100" fill="none">
            <circle cx="50" cy="50" r="12" fill="#C9A84C"/>
            <ellipse cx="50" cy="50" rx="35" ry="14" stroke="#C9A84C" stroke-width="2.5" fill="none"/>
            <ellipse cx="50" cy="50" rx="35" ry="14" stroke="#D4B76A" stroke-width="2.5" fill="none" transform="rotate(60 50 50)"/>
            <ellipse cx="50" cy="50" rx="35" ry="14" stroke="#B8933A" stroke-width="2.5" fill="none" transform="rotate(120 50 50)"/>
            <circle cx="85" cy="50" r="5" fill="#D4B76A"/>
            <circle cx="32.5" cy="21.7" r="5" fill="#C9A84C"/>
            <circle cx="32.5" cy="78.3" r="5" fill="#B8933A"/>
          </svg>
          <span class="sa-sidebar-brand">نواة</span>
        </div>
        <p class="sa-sidebar-subtitle">${isAr ? 'نظام نقاط البيع' : 'POS System'}</p>
        <span class="sa-sidebar-role">${isAr ? 'مدير النظام العام' : 'Super Admin'}</span>
      </div>
      <nav class="sa-nav">
        <p class="sa-nav-label">${isAr ? 'القائمة' : 'Menu'}</p>
        ${nav.map(item => `
          <button class="sa-nav-item ${this.state.currentView === item.id ? 'active' : ''}" data-nav="${item.id}">
            ${item.icon}
            <span>${item.label}</span>
          </button>
        `).join('')}
        <div class="sa-nav-divider"></div>
        <p class="sa-nav-label">${isAr ? 'النظام' : 'System'}</p>
        <button class="sa-nav-item" data-nav="settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          <span>${isAr ? 'الإعدادات' : 'Settings'}</span>
        </button>
      </nav>
      <div class="sa-sidebar-footer">
        <button class="sa-sidebar-footer-btn" id="saLogout">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span>${isAr ? 'تسجيل الخروج' : 'Logout'}</span>
        </button>
      </div>
    </aside>`;
  },

  renderTopbar() {
    const isAr = (Nawa.I18n && Nawa.I18n.getLang) ? Nawa.I18n.getLang() === 'ar' : true;
    const titles = {
      dashboard: [isAr ? 'لوحة التحكم' : 'Dashboard', isAr ? 'نظرة عامة على النظام' : 'System Overview'],
      restaurants: [isAr ? 'المطاعم' : 'Restaurants', isAr ? 'إدارة جميع المطاعم المشتركين' : 'Manage all subscribed restaurants'],
      plans: [isAr ? 'الباقات' : 'Plans', isAr ? 'خطط الاشتراك المتاحة' : 'Available subscription plans'],
      'weekly-sales': [isAr ? 'تقرير المبيعات الأسبوعي' : 'Weekly Sales Report', isAr ? 'تحليل مبيعات جميع المطاعم' : 'Analyze sales across all restaurants'],
    };
    const [title, subtitle] = titles[this.state.currentView] || titles.dashboard;

    return `
    <div class="sa-topbar">
      <div class="sa-topbar-title">
        <h1>${title}</h1>
        <p>${subtitle}</p>
      </div>
      <div class="sa-topbar-actions">
        ${this.renderSyncStatus()}
        ${this.state.currentView === 'restaurants' ?
          `<button class="sa-btn sa-btn-primary" id="saAddRestaurant">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            ${isAr ? 'إضافة مطعم' : 'Add Restaurant'}
          </button>` : ''}
      </div>
    </div>`;
  },

  renderSyncStatus() {
    let status = 'online';
    let label = 'متصل';
    if (Nawa.Sync && Nawa.Sync.getStatus) {
      status = Nawa.Sync.getStatus();
      if (status === 'offline') label = 'غير متصل';
      else if (status === 'syncing') label = 'جاري المزامنة';
      else label = 'متصل';
    } else if (!navigator.onLine) {
      status = 'offline';
      label = 'غير متصل';
    }

    return `<div class="sa-sync-status ${status}"><span class="sa-sync-dot"></span>${label}</div>`;
  },

  renderDashboard() {
    const s = this.state.stats;
    const isAr = (Nawa.I18n && Nawa.I18n.getLang) ? Nawa.I18n.getLang() === 'ar' : true;
    return `
    <div class="sa-stats-grid">
      <div class="sa-stat-card">
        <div class="sa-stat-icon total">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21V7l9-4 9 4v14"/><path d="M9 21V11h6v10"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">${isAr ? 'إجمالي المطاعم' : 'Total Restaurants'}</div>
          <div class="sa-stat-value">${s.total}</div>
        </div>
      </div>
      <div class="sa-stat-card">
        <div class="sa-stat-icon active">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">${isAr ? 'نشطة' : 'Active'}</div>
          <div class="sa-stat-value">${s.active}</div>
        </div>
      </div>
      <div class="sa-stat-card">
        <div class="sa-stat-icon suspended">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">${isAr ? 'معلقة' : 'Suspended'}</div>
          <div class="sa-stat-value">${s.suspended}</div>
        </div>
      </div>
      <div class="sa-stat-card">
        <div class="sa-stat-icon revenue">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">${isAr ? 'إجمالي الإيرادات' : 'Total Revenue'}</div>
          <div class="sa-stat-value">${this.formatCurrency(s.revenue)}</div>
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:2fr 1fr;gap:24px;">
      <div class="sa-card">
        <div class="sa-card-header">
          <h2>${isAr ? 'آخر النشاطات' : 'Recent Activity'}</h2>
        </div>
        <div class="sa-card-body">
          ${this.renderRecentActivity()}
        </div>
      </div>
      <div class="sa-card">
        <div class="sa-card-header">
          <h2>${isAr ? 'ملخص سريع' : 'Quick Summary'}</h2>
        </div>
        <div class="sa-card-body">
          <div style="display:flex;flex-direction:column;gap:14px;">
            <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--sa-border);">
              <span style="color:var(--sa-text-muted);font-size:13px;">${isAr ? 'غير نشطة' : 'Inactive'}</span>
              <span style="font-weight:700;">${s.inactive}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--sa-border);">
              <span style="color:var(--sa-text-muted);font-size:13px;">${isAr ? 'نسبة التنشيط' : 'Activation Rate'}</span>
              <span style="font-weight:700;color:var(--sa-success);">${s.total > 0 ? Math.round((s.active / s.total) * 100) : 0}%</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--sa-border);">
              <span style="color:var(--sa-text-muted);font-size:13px;">${isAr ? 'متوسط الإيراد/مطعم' : 'Avg Revenue/Restaurant'}</span>
              <span style="font-weight:700;">${this.formatCurrency(s.total > 0 ? s.revenue / s.total : 0)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  },

  renderRecentActivity() {
    const activities = this.generateMockActivity();
    if (activities.length === 0) {
      return `<div class="sa-empty"><h3>لا توجد نشاطات بعد</h3></div>`;
    }
    return `
    <ul class="sa-activity-list">
      ${activities.map(a => `
        <li class="sa-activity-item">
          <span class="sa-activity-dot ${a.color}"></span>
          <div>
            <div class="sa-activity-text">${a.text}</div>
            <div class="sa-activity-time">${a.time}</div>
          </div>
        </li>
      `).join('')}
    </ul>`;
  },

  generateMockActivity() {
    const isAr = (Nawa.I18n && Nawa.I18n.getLang) ? Nawa.I18n.getLang() === 'ar' : true;
    const restaurants = this.state.restaurants.slice(0, 5);
    const templates = [
      { text: (r) => isAr ? `تم تفعيل مطعم "${r.name}"` : `Restaurant "${r.name}" activated`, color: 'green', time: isAr ? 'منذ 5 دقائق' : '5 min ago' },
      { text: (r) => isAr ? `مطعم "${r.name}" قام بتحديث المنيو` : `Restaurant "${r.name}" updated menu`, color: 'blue', time: isAr ? 'منذ 15 دقيقة' : '15 min ago' },
      { text: (r) => isAr ? `تم تعليق اشتراك "${r.name}"` : `Subscription suspended for "${r.name}"`, color: 'yellow', time: isAr ? 'منذ ساعة' : '1 hour ago' },
      { text: (r) => isAr ? `مطعم "${r.name}" - تم إصدار فاتورة جديدة` : `Restaurant "${r.name}" - new invoice issued`, color: 'green', time: isAr ? 'منذ 3 ساعات' : '3 hours ago' },
      { text: (r) => isAr ? `إضافة مستخدم جديد لمطعم "${r.name}"` : `New user added to restaurant "${r.name}"`, color: 'blue', time: isAr ? 'منذ يوم' : '1 day ago' },
    ];

    if (restaurants.length === 0) {
      return [
        { text: isAr ? 'مرحباً بك في لوحة التحكم العام' : 'Welcome to the super admin dashboard', color: 'green', time: isAr ? 'الآن' : 'Now' },
        { text: isAr ? 'يمكنك إضافة مطعم جديد للبدء' : 'You can add a new restaurant to get started', color: 'blue', time: isAr ? 'الآن' : 'Now' },
      ];
    }

    return templates.slice(0, restaurants.length).map((t, i) => ({
      text: t.text(restaurants[i]),
      color: t.color,
      time: t.time
    }));
  },

  renderRestaurants() {
    let filtered = [...this.state.restaurants];

    if (this.state.filterStatus !== 'all') {
      filtered = filtered.filter(r => r.status === this.state.filterStatus);
    }

    if (this.state.searchQuery) {
      const q = this.state.searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.owner || '').toLowerCase().includes(q) ||
        (r.email || '').toLowerCase().includes(q)
      );
    }

    return `
    <div class="sa-filter-bar">
      <div class="sa-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="saSearchInput" placeholder="بحث بالاسم أو المالك أو البريد..." value="${this.state.searchQuery}">
      </div>
      <select class="sa-filter-select" id="saFilterStatus">
        <option value="all" ${this.state.filterStatus === 'all' ? 'selected' : ''}>الكل</option>
        <option value="active" ${this.state.filterStatus === 'active' ? 'selected' : ''}>نشط</option>
        <option value="suspended" ${this.state.filterStatus === 'suspended' ? 'selected' : ''}>معلق</option>
        <option value="inactive" ${this.state.filterStatus === 'inactive' ? 'selected' : ''}>متوقف</option>
      </select>
    </div>

    <div class="sa-card">
      <div class="sa-card-body" style="padding:0;">
        ${filtered.length === 0 ? `
          <div class="sa-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21V7l9-4 9 4v14"/><path d="M9 21V11h6v10"/></svg>
            <h3>لا توجد مطاعم</h3>
            <p>لم يتم العثور على نتائج مطابقة</p>
          </div>
        ` : `
          <div class="sa-table-wrap">
            <table class="sa-table">
              <thead>
                <tr>
                  <th>المطعم</th>
                  <th>المالك</th>
                  <th>الحالة</th>
                  <th>الباقة</th>
                  <th>تاريخ البداية</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map(r => `
                  <tr data-id="${r.id}">
                    <td>
                      <div style="font-weight:600;">${r.name || '—'}</div>
                      <div style="font-size:12px;color:var(--sa-text-muted);">${r.email || ''}</div>
                    </td>
                    <td>${r.owner || '—'}</td>
                    <td><span class="sa-badge ${r.status || 'inactive'}">${this.statusLabel(r.status)}</span></td>
                    <td><span class="sa-badge ${r.plan || 'basic'}">${this.planLabel(r.plan)}</span></td>
                    <td>${r.startDate || '—'}</td>
                    <td>
                      <div class="sa-btn-group">
                        <button class="sa-btn sa-btn-outline sa-btn-sm" data-detail="${r.id}" title="التفاصيل">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                        </button>
                        ${r.status === 'active' ?
                          `<button class="sa-btn sa-btn-warning sa-btn-sm" data-action="suspend" data-id="${r.id}" title="تعليق">تعليق</button>` :
                          `<button class="sa-btn sa-btn-success sa-btn-sm" data-action="activate" data-id="${r.id}" title="تشغيل">تشغيل</button>`}
                        <button class="sa-btn sa-btn-danger sa-btn-sm" data-action="delete" data-id="${r.id}" title="حذف">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>`;
  },

  async renderRestaurantDetail(restaurant) {
    if (!restaurant) return '';
    const modalRoot = document.getElementById('sa-modal-root');
    if (!modalRoot) return;

    let ordersCount = 0;
    let storageMB = 0;
    try {
      const res = await Nawa.Auth.apiFetch('/orders?restaurantId=' + restaurant.id);
      if (res.ok) {
        const orders = await res.json();
        const now = new Date();
        ordersCount = orders.filter(o => {
          const d = new Date(o.createdAt);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }).length;
      }
    } catch (e) {}

    try {
      const [prods, cats, tabs] = await Promise.all([
        Nawa.Auth.apiFetch('/products').then(r => r.ok ? r.json() : []),
        Nawa.Auth.apiFetch('/categories').then(r => r.ok ? r.json() : []),
        Nawa.Auth.apiFetch('/tables').then(r => r.ok ? r.json() : [])
      ]);
      storageMB = ((prods.length + cats.length + tabs.length) * 0.5).toFixed(1);
    } catch (e) {}

    modalRoot.innerHTML = `
    <div class="sa-detail-overlay" id="saDetailOverlay">
      <div class="sa-detail-panel">
        <div class="sa-detail-header">
          <h2>${restaurant.name}</h2>
          <button class="sa-modal-close" id="saDetailClose">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="sa-detail-body">
          <div class="sa-detail-section">
            <h3>معلومات الاشتراك</h3>
            <div class="sa-detail-grid">
              <div class="sa-detail-field">
                <div class="sa-detail-field-label">الباقة</div>
                <div class="sa-detail-field-value">${this.planLabel(restaurant.plan)}</div>
              </div>
              <div class="sa-detail-field">
                <div class="sa-detail-field-label">الحالة</div>
                <div class="sa-detail-field-value"><span class="sa-badge ${restaurant.status}">${this.statusLabel(restaurant.status)}</span></div>
              </div>
              <div class="sa-detail-field">
                <div class="sa-detail-field-label">تاريخ البداية</div>
                <div class="sa-detail-field-value">${restaurant.startDate || '—'}</div>
              </div>
              <div class="sa-detail-field">
                <div class="sa-detail-field-label">تاريخ الانتهاء</div>
                <div class="sa-detail-field-value">${restaurant.endDate || '—'}</div>
              </div>
            </div>
          </div>

          <div class="sa-detail-section">
            <h3>معلومات المالك</h3>
            <div class="sa-detail-grid">
              <div class="sa-detail-field">
                <div class="sa-detail-field-label">اسم المالك</div>
                <div class="sa-detail-field-value">${restaurant.owner || '—'}</div>
              </div>
              <div class="sa-detail-field">
                <div class="sa-detail-field-label">الهاتف</div>
                <div class="sa-detail-field-value" style="direction:ltr;text-align:right;">${restaurant.phone || '—'}</div>
              </div>
              <div class="sa-detail-field" style="grid-column:1/-1;">
                <div class="sa-detail-field-label">البريد الإلكتروني</div>
                <div class="sa-detail-field-value" style="direction:ltr;text-align:right;">${restaurant.email || '—'}</div>
              </div>
              <div class="sa-detail-field" style="grid-column:1/-1;">
                <div class="sa-detail-field-label">كلمة المرور</div>
                <div class="sa-detail-field-value" style="direction:ltr;text-align:right;display:flex;align-items:center;gap:8px;">
                  <span id="saDetailPassword" style="font-family:monospace;">••••••••</span>
                  <button class="sa-btn sa-btn-ghost" id="saTogglePassword" style="padding:2px 6px;font-size:0.75rem;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="sa-detail-section">
            <h3>إحصائيات الاستخدام</h3>
            <div class="sa-detail-grid">
              <div class="sa-detail-field">
                <div class="sa-detail-field-label">الطلبات هذا الشهر</div>
                <div class="sa-detail-field-value">${ordersCount.toLocaleString()}</div>
              </div>
              <div class="sa-detail-field">
                <div class="sa-detail-field-label">المساحة المستخدمة</div>
                <div class="sa-detail-field-value">${storageMB} MB</div>
              </div>
            </div>
          </div>

          <div class="sa-detail-section">
            <h3>إجراءات سريعة</h3>
            <div class="sa-detail-actions">
              ${restaurant.status !== 'active' ?
                `<button class="sa-btn sa-btn-success" data-detail-action="activate" data-id="${restaurant.id}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                  تفعيل
                </button>` : ''}
              ${restaurant.status !== 'suspended' ?
                `<button class="sa-btn sa-btn-warning" data-detail-action="suspend" data-id="${restaurant.id}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  تعليق
                </button>` : ''}
              ${restaurant.status !== 'inactive' ?
                `<button class="sa-btn sa-btn-danger" data-detail-action="deactivate" data-id="${restaurant.id}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                  إيقاف
                </button>` : ''}
              <button class="sa-btn sa-btn-outline" data-login-as="${restaurant.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                الدخول كمدير
              </button>
            </div>
          </div>

          <div class="sa-detail-section" style="margin-top:24px;border:1px solid #fee2e2;border-radius:12px;padding:16px;">
            <h3 style="color:#dc2626;margin-bottom:12px;">منطقة الخطر</h3>
            <button class="sa-btn sa-btn-danger" data-detail-action="delete" data-id="${restaurant.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              حذف المطعم نهائياً
            </button>
            <p style="color:#6b7280;font-size:13px;margin-top:8px;">هذا الإجراء لا يمكن التراجع عنه. سيتم حذف جميع البيانات المرتبطة بهذا المطعم.</p>
          </div>
        </div>
      </div>
    </div>`;

    document.getElementById('saDetailClose').addEventListener('click', () => this.closeDetail());
    document.getElementById('saDetailOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'saDetailOverlay') this.closeDetail();
    });

    modalRoot.querySelectorAll('[data-detail-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const action = e.currentTarget.dataset.detailAction;
        const id = e.currentTarget.dataset.id;
        if (action === 'delete') {
          await this.deleteRestaurant(id);
        } else {
          await this.toggleRestaurant(id, action);
          this.closeDetail();
        }
      });
    });

    const loginAsBtn = modalRoot.querySelector('[data-login-as]');
    if (loginAsBtn) {
      loginAsBtn.addEventListener('click', async () => {
        const pwd = restaurant.password || this._passwordCache[restaurant.id];
        if (!restaurant.email || !pwd) {
          this.showNotification('لا يوجد بيانات تسجيل دخول لهذا المطعم', 'error');
          return;
        }
        try {
          await Nawa.Auth.adminLogin(restaurant.email, pwd);
          window.location.hash = '#/admin';
        } catch (e) {
          this.showNotification('فشل تسجيل الدخول', 'error');
        }
      });
    }

    const togglePwdBtn = document.getElementById('saTogglePassword');
    const pwdSpan = document.getElementById('saDetailPassword');
    if (togglePwdBtn && pwdSpan) {
      togglePwdBtn.addEventListener('click', () => {
        const pwd = restaurant.password || this._passwordCache[restaurant.id] || '—';
        if (pwdSpan.textContent === '••••••••') {
          pwdSpan.textContent = pwd;
        } else {
          pwdSpan.textContent = '••••••••';
        }
      });
    }
  },

  closeDetail() {
    const overlay = document.getElementById('saDetailOverlay');
    if (overlay) overlay.remove();
  },

  renderPlans() {
    const plans = [
      {
        name: 'أساسي',
        nameEn: 'Basic',
        price: 199,
        badge: '',
        features: [
          { text: 'مدير واحد', enabled: true },
          { text: 'كاشير واحد', enabled: true },
          { text: '100 طلب يومياً', enabled: true },
          { text: 'تقارير أساسية', enabled: true },
          { text: 'دعم فني عبر البريد', enabled: true },
          { text: 'تقرير مبيعات متقدم', enabled: false },
          { text: 'integrations', enabled: false },
        ]
      },
      {
        name: 'متوسط',
        nameEn: 'Medium',
        price: 499,
        badge: 'الأكثر طلباً',
        featured: true,
        features: [
          { text: '3 مديرين', enabled: true },
          { text: '5 كاشيرين', enabled: true },
          { text: '500 طلب يومياً', enabled: true },
          { text: 'تقارير متقدمة', enabled: true },
          { text: 'دعم فني هاتفي', enabled: true },
          { text: 'تقرير مبيعات متقدم', enabled: true },
          { text: 'تكامل مع أنظمة خارجية', enabled: false },
        ]
      },
      {
        name: 'متقدم',
        nameEn: 'Advanced',
        price: 999,
        badge: '',
        features: [
          { text: 'مديرين غير محدود', enabled: true },
          { text: 'كاشيرين غير محدود', enabled: true },
          { text: 'طلبات غير محدودة', enabled: true },
          { text: 'تقارير شاملة + BI', enabled: true },
          { text: 'دعم فني 24/7', enabled: true },
          { text: 'تقرير مبيعات متقدم', enabled: true },
          { text: 'تكامل مع أنظمة خارجية', enabled: true },
        ]
      }
    ];

    return `
    <div class="sa-plans-grid">
      ${plans.map(p => `
        <div class="sa-plan-card ${p.featured ? 'featured' : ''}">
          ${p.badge ? `<div class="sa-plan-badge">${p.badge}</div>` : ''}
          <div class="sa-plan-name">${p.name}</div>
          <div class="sa-plan-price">${p.price} <span>ل.س / شهرياً</span></div>
          <ul class="sa-plan-features">
            ${p.features.map(f => `
              <li class="${f.enabled ? '' : 'disabled'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  ${f.enabled ?
                    '<polyline points="20 6 9 17 4 12"/>' :
                    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'}
                </svg>
                ${f.text}
              </li>
            `).join('')}
          </ul>
        </div>
      `).join('')}
    </div>`;
  },

  renderContent() {
    const content = document.querySelector('.sa-content');
    if (!content) return;
    const view = this.state.currentView;
    if (view === 'registrations') content.innerHTML = this.renderRegistrations();
    else if (view === 'weekly-sales') content.innerHTML = this.renderWeeklySales();
    else content.innerHTML = '';
    this.bindEvents();
  },

  renderRegistrations() {
    var isAr = (Nawa.I18n && Nawa.I18n.getLang) ? Nawa.I18n.getLang() === 'ar' : true;
    var regs = this.state.registrations || [];

    if (regs.length === 0) {
      return '<div class="sa-card"><div class="sa-card-body"><div class="sa-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/></svg><h3>' + (isAr ? 'لا توجد طلبات معلقة' : 'No pending registrations') + '</h3><p style="color:var(--sa-text-muted);font-size:13px;">' + (isAr ? 'ستظهر طلبات التسجيل الجديدة هنا' : 'New registration requests will appear here') + '</p></div></div></div>';
    }

    var html = '<div class="sa-card"><div class="sa-card-header"><h2>' + (isAr ? 'طلبات التسجيل المعلقة (' + regs.length + ')' : 'Pending Registrations (' + regs.length + ')') + '</h2></div><div class="sa-card-body" style="padding:0;">';
    html += '<div class="sa-table-wrap"><table class="sa-table"><thead><tr>';
    html += '<th>#</th><th>' + (isAr ? 'المطعم' : 'Restaurant') + '</th><th>' + (isAr ? 'المالك' : 'Owner') + '</th><th>' + (isAr ? 'البريد' : 'Email') + '</th><th>' + (isAr ? 'الجوال' : 'Phone') + '</th><th>' + (isAr ? 'التاريخ' : 'Date') + '</th><th>' + (isAr ? 'إجراءات' : 'Actions') + '</th>';
    html += '</tr></thead><tbody>';

    regs.forEach(function (reg, i) {
      var date = reg.createdAt ? new Date(reg.createdAt).toLocaleDateString(isAr ? 'ar-SA' : 'en') : '--';
      html += '<tr>';
      html += '<td>' + (i + 1) + '</td>';
      html += '<td style="font-weight:600;">' + (reg.restaurantName || '--') + '</td>';
      html += '<td>' + (reg.ownerName || '--') + '</td>';
      html += '<td dir="ltr" style="text-align:start;">' + (reg.email || '--') + '</td>';
      html += '<td dir="ltr" style="text-align:start;">' + (reg.phone || '--') + '</td>';
      html += '<td>' + date + '</td>';
      html += '<td>';
      html += '<button class="btn btn-sm btn-success" data-approve-reg="' + reg.id + '" style="margin-inline-end:4px;">' + (isAr ? 'موافقة' : 'Approve') + '</button>';
      html += '<button class="btn btn-sm btn-danger" data-reject-reg="' + reg.id + '">' + (isAr ? 'رفض' : 'Reject') + '</button>';
      html += '</td></tr>';
    });

    html += '</tbody></table></div></div></div>';
    return html;
  },

  async approveRegistration(regId) {
    var session = Nawa.Auth ? Nawa.Auth.getCurrentUser() : null;
    if (!session || !session.token) return;
    try {
      var res = await fetch(Nawa.CONFIG.API_BASE + '/registrations/' + regId + '/approve', {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + session.token, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        await this.loadRegistrations();
        await this.loadData();
        this.render();
        this.showNotification(Nawa.I18n.getLang() === 'ar' ? 'تمت الموافقة على التسجيل' : 'Registration approved', 'success');
      }
    } catch (e) {
      this.showNotification(Nawa.I18n.getLang() === 'ar' ? 'خطأ في الموافقة' : 'Error approving', 'error');
    }
  },

  async rejectRegistration(regId) {
    var session = Nawa.Auth ? Nawa.Auth.getCurrentUser() : null;
    if (!session || !session.token) return;
    try {
      var res = await fetch(Nawa.CONFIG.API_BASE + '/registrations/' + regId + '/reject', {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + session.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '' })
      });
      if (res.ok) {
        await this.loadRegistrations();
        this.render();
        this.showNotification(Nawa.I18n.getLang() === 'ar' ? 'تم رفض التسجيل' : 'Registration rejected', 'success');
      }
    } catch (e) {
      this.showNotification(Nawa.I18n.getLang() === 'ar' ? 'خطأ في الرفض' : 'Error rejecting', 'error');
    }
  },

  renderWeeklySales() {
    const report = this.state.salesReport;
    const isAr = (Nawa.I18n && Nawa.I18n.getLang) ? Nawa.I18n.getLang() === 'ar' : true;
    if (!report) {
      return `<div class="sa-card"><div class="sa-card-body"><div class="sa-empty"><h3>${isAr ? 'جاري تحميل البيانات...' : 'Loading data...'}</h3></div></div></div>`;
    }

    if (!report.totalSales && report.totalSales !== 0) {
      return `<div class="sa-card"><div class="sa-card-body"><div class="sa-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg><h3>${isAr ? 'لا توجد بيانات مبيعات لهذا الفترة' : 'No sales data for this period'}</h3></div></div></div>`;
    }

    const changePercent = report.previousTotal > 0
      ? Math.round(((report.totalSales - report.previousTotal) / report.previousTotal) * 100)
      : 0;

    const dailySales = report.dailySales || [];
    const maxSale = Math.max(...dailySales.map(d => d.amount), 1);

    const topProducts = report.topProducts || [];
    const restaurantSales = report.restaurantSales || [];

    return `
    <div class="sa-report-period">
      <button class="sa-btn sa-btn-outline ${this.state.reportWeeks === 1 ? 'active' : ''}" data-report-weeks="1">${isAr ? 'أسبوع واحد' : '1 Week'}</button>
      <button class="sa-btn sa-btn-outline ${this.state.reportWeeks === 2 ? 'active' : ''}" data-report-weeks="2">${isAr ? 'أسبوعين' : '2 Weeks'}</button>
    </div>

    <div class="sa-stats-grid">
      <div class="sa-stat-card">
        <div class="sa-stat-icon revenue">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">${isAr ? 'إجمالي المبيعات' : 'Total Sales'}</div>
          <div class="sa-stat-value">${this.formatCurrency(report.totalSales)}</div>
        </div>
      </div>
      <div class="sa-stat-card">
        <div class="sa-stat-icon total">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">${isAr ? 'عدد الطلبات' : 'Order Count'}</div>
          <div class="sa-stat-value">${(report.orderCount || 0).toLocaleString()}</div>
        </div>
      </div>
      <div class="sa-stat-card">
        <div class="sa-stat-icon active">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20V10"/><path d="M18 20V4"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">${isAr ? 'متوسط قيمة الطلب' : 'Avg Order Value'}</div>
          <div class="sa-stat-value">${this.formatCurrency(report.orderCount > 0 ? report.totalSales / report.orderCount : 0)}</div>
        </div>
      </div>
      <div class="sa-stat-card">
        <div class="sa-stat-icon ${changePercent >= 0 ? 'active' : 'suspended'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">${isAr ? 'نسبة التغيير' : 'Change Rate'}</div>
          <div class="sa-stat-value">${changePercent >= 0 ? '+' : ''}${changePercent}%</div>
        </div>
      </div>
    </div>

    <div class="sa-card sa-chart-container" style="margin-bottom:24px;">
      <div class="sa-card-header">
        <h2>${isAr ? 'المبيعات اليومية' : 'Daily Sales'}</h2>
        <span style="font-size:12px;color:var(--sa-text-muted);">${report.dateRange || ''}</span>
      </div>
      <div class="sa-card-body">
        ${dailySales.length > 0 ? `
          <div class="sa-chart">
            ${dailySales.map(d => `
              <div class="sa-chart-bar-wrapper">
                <div class="sa-chart-value">${this.formatCurrency(d.amount)}</div>
                <div class="sa-chart-bar" style="height:${Math.max((d.amount / maxSale) * 160, 4)}px;"></div>
                <div class="sa-chart-label">${d.day}</div>
                <div class="sa-chart-date">${d.date || ''}</div>
              </div>
            `).join('')}
          </div>
        ` : `<div class="sa-empty"><h3>${isAr ? 'لا توجد بيانات يومية' : 'No daily data'}</h3></div>`}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div class="sa-card">
        <div class="sa-card-header">
          <h2>${isAr ? 'أكثر المنتجات مبيعاً' : 'Top Selling Products'}</h2>
        </div>
        <div class="sa-card-body" style="padding:0;">
          ${topProducts.length > 0 ? `
            <div class="sa-table-wrap">
              <table class="sa-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>${isAr ? 'المنتج' : 'Product'}</th>
                    <th>${isAr ? 'الكمية المباعة' : 'Qty Sold'}</th>
                    <th>${isAr ? 'إجمالي المبيعات' : 'Total Sales'}</th>
                  </tr>
                </thead>
                <tbody>
                  ${topProducts.slice(0, 10).map((p, i) => `
                    <tr style="cursor:default;">
                      <td>${i + 1}</td>
                      <td style="font-weight:600;">${p.name}</td>
                      <td>${(p.quantity || 0).toLocaleString()}</td>
                      <td style="font-weight:600;">${this.formatCurrency(p.total)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `<div class="sa-empty"><h3>${isAr ? 'لا توجد بيانات منتجات' : 'No product data'}</h3></div>`}
        </div>
      </div>

      <div class="sa-card">
        <div class="sa-card-header">
          <h2>${isAr ? 'مبيعات المطاعم' : 'Restaurant Sales'}</h2>
        </div>
        <div class="sa-card-body" style="padding:0;">
          ${restaurantSales.length > 0 ? `
            <div class="sa-table-wrap">
              <table class="sa-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>${isAr ? 'المطعم' : 'Restaurant'}</th>
                    <th>${isAr ? 'عدد الطلبات' : 'Orders'}</th>
                    <th>${isAr ? 'إجمالي المبيعات' : 'Total Sales'}</th>
                  </tr>
                </thead>
                <tbody>
                  ${restaurantSales.map((r, i) => `
                    <tr style="cursor:default;">
                      <td>${i + 1}</td>
                      <td style="font-weight:600;">${r.name}</td>
                      <td>${(r.orderCount || 0).toLocaleString()}</td>
                      <td style="font-weight:600;">${this.formatCurrency(r.total)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `<div class="sa-empty"><h3>${isAr ? 'لا توجد بيانات مطاعم' : 'No restaurant data'}</h3></div>`}
        </div>
      </div>
    </div>`;
  },

  async loadWeeklySales() {
    try {
      const session = JSON.parse(localStorage.getItem('nawa_session') || '{}');
      const res = await fetch(`/api/reports/weekly?weeks=${this.state.reportWeeks}`, {
        headers: { 'Authorization': `Bearer ${session.token}` }
      });
      if (res.ok) {
        this.state.salesReport = await res.json();
      }
    } catch (e) {
      const orders = await Nawa.DB.getAll('orders') || [];
      this.state.salesReport = this.generateLocalReport(orders);
    }
    this.renderContent();
  },

  generateLocalReport(orders) {
    const weeks = this.state.reportWeeks;
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - (now.getDay()) - ((weeks - 1) * 7));
    startOfWeek.setHours(0, 0, 0, 0);

    const periodStart = new Date(startOfWeek);
    const periodEnd = new Date(now);

    const prevPeriodStart = new Date(periodStart);
    prevPeriodStart.setDate(prevPeriodStart.getDate() - (weeks * 7));
    const prevPeriodEnd = new Date(periodStart);
    prevPeriodEnd.setDate(prevPeriodEnd.getDate() - 1);

    const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

    const currentOrders = orders.filter(o => {
      const d = new Date(o.date || o.createdAt || o.timestamp);
      return d >= periodStart && d <= periodEnd;
    });

    const prevOrders = orders.filter(o => {
      const d = new Date(o.date || o.createdAt || o.timestamp);
      return d >= prevPeriodStart && d <= prevPeriodEnd;
    });

    const totalSales = currentOrders.reduce((sum, o) => sum + (o.total || o.amount || 0), 0);
    const previousTotal = prevOrders.reduce((sum, o) => sum + (o.total || o.amount || 0), 0);

    const dailyMap = {};
    for (let i = 0; i < (weeks * 7); i++) {
      const d = new Date(periodStart);
      d.setDate(d.getDate() + i);
      if (d > now) break;
      const key = d.toISOString().slice(0, 10);
      dailyMap[key] = { day: dayNames[d.getDay()], date: d.toLocaleDateString('ar-SA'), amount: 0 };
    }

    currentOrders.forEach(o => {
      const d = new Date(o.date || o.createdAt || o.timestamp);
      const key = d.toISOString().slice(0, 10);
      if (dailyMap[key]) {
        dailyMap[key].amount += (o.total || o.amount || 0);
      }
    });

    const dailySales = Object.values(dailyMap);

    const productMap = {};
    currentOrders.forEach(o => {
      const items = o.items || o.orderItems || [];
      items.forEach(item => {
        const name = item.name || item.productName || 'منتج';
        if (!productMap[name]) productMap[name] = { name, quantity: 0, total: 0 };
        productMap[name].quantity += (item.quantity || 1);
        productMap[name].total += (item.price || item.total || 0) * (item.quantity || 1);
      });
    });

    const topProducts = Object.values(productMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const restaurantMap = {};
    currentOrders.forEach(o => {
      const name = o.restaurantName || o.restaurant || 'مطعم';
      if (!restaurantMap[name]) restaurantMap[name] = { name, orderCount: 0, total: 0 };
      restaurantMap[name].orderCount += 1;
      restaurantMap[name].total += (o.total || o.amount || 0);
    });

    const restaurantSales = Object.values(restaurantMap)
      .sort((a, b) => b.total - a.total);

    const startStr = periodStart.toLocaleDateString('ar-SA');
    const endStr = periodEnd.toLocaleDateString('ar-SA');

    return {
      totalSales,
      orderCount: currentOrders.length,
      previousTotal,
      dailySales,
      topProducts,
      restaurantSales,
      dateRange: `${startStr} - ${endStr}`
    };
  },

  showAddRestaurantModal() {
    const modalRoot = document.getElementById('sa-modal-root');
    if (!modalRoot) return;

    modalRoot.innerHTML = `
    <div class="sa-modal-overlay" id="saAddModal">
      <div class="sa-modal">
        <div class="sa-modal-header">
          <h2>إضافة مطعم جديد</h2>
          <button class="sa-modal-close" id="saAddClose">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="sa-modal-body">
          <form id="saAddForm">
            <div class="sa-form-group">
              <label>اسم المطعم</label>
              <input type="text" class="sa-form-input" id="saRestName" placeholder="مثال: مطعم البيك" required>
            </div>
            <div class="sa-form-row">
              <div class="sa-form-group">
                <label>اسم المالك</label>
                <input type="text" class="sa-form-input" id="saRestOwner" placeholder="الاسم الكامل" required>
              </div>
              <div class="sa-form-group">
                <label>رقم الهاتف</label>
                <input type="tel" class="sa-form-input" id="saRestPhone" placeholder="05XXXXXXXX" dir="ltr" required>
              </div>
            </div>
            <div class="sa-form-group">
              <label>البريد الإلكتروني</label>
              <input type="email" class="sa-form-input" id="saRestEmail" placeholder="owner@example.com" dir="ltr" required>
            </div>
            <div class="sa-form-row">
              <div class="sa-form-group">
                <label>باقة الاشتراك</label>
                <select class="sa-form-select" id="saRestPlan" required>
                  <option value="basic">أساسي - 199 ل.س/شهر</option>
                  <option value="medium" selected>متوسط - 499 ل.س/شهر</option>
                  <option value="advanced">متقدم - 999 ل.س/شهر</option>
                </select>
              </div>
              <div class="sa-form-group">
                <label>كلمة المرور</label>
                <input type="password" class="sa-form-input" id="saRestPassword" placeholder="8 أحرف على الأقل" required minlength="8">
              </div>
            </div>
            <div class="sa-modal-footer" style="padding:16px 0 0;">
              <button type="submit" class="sa-btn sa-btn-primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                إضافة المطعم
              </button>
              <button type="button" class="sa-btn sa-btn-ghost" id="saAddCancel">إلغاء</button>
            </div>
          </form>
        </div>
      </div>
    </div>`;

    document.getElementById('saAddClose').addEventListener('click', () => this.closeAddModal());
    document.getElementById('saAddCancel').addEventListener('click', () => this.closeAddModal());
    document.getElementById('saAddModal').addEventListener('click', (e) => {
      if (e.target.id === 'saAddModal') this.closeAddModal();
    });

    document.getElementById('saAddForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        name: document.getElementById('saRestName').value.trim(),
        owner: document.getElementById('saRestOwner').value.trim(),
        phone: document.getElementById('saRestPhone').value.trim(),
        email: document.getElementById('saRestEmail').value.trim(),
        plan: document.getElementById('saRestPlan').value,
        password: document.getElementById('saRestPassword').value,
      };
      await this.addRestaurant(data);
    });
  },

  closeAddModal() {
    const modal = document.getElementById('saAddModal');
    if (modal) modal.remove();
  },

  async addRestaurant(data) {
    try {
      const res = await Nawa.Auth.apiFetch('/admin/create-restaurant', {
        method: 'POST',
        body: data
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'Failed');
      }
      const result = await res.json();
      const restaurant = {
        id: result.restaurant.id || result.restaurant._id,
        ...data,
        ...result.restaurant,
        password: data.password,
        status: 'active',
        startDate: new Date().toLocaleDateString('ar-SA'),
        endDate: '',
        revenue: 0,
        ordersThisMonth: 0,
        storageUsed: 0,
        createdAt: new Date().toISOString()
      };
      try { await Nawa.DB.add('restaurants', restaurant); } catch (e) {}

      this._passwordCache[restaurant.id] = data.password;
      this.closeAddModal();
      await this.loadData();
      this.render();
      this.showNotification(`تم إضافة مطعم "${data.name}" بنجاح`, 'success');
    } catch (err) {
      this.showNotification('حدث خطأ أثناء إضافة المطعم', 'error');
      console.error('addRestaurant error:', err);
    }
  },

  async toggleRestaurant(id, action) {
    const statusMap = {
      activate: 'active',
      suspend: 'suspended',
      deactivate: 'inactive'
    };

    const restaurant = this.state.restaurants.find(r => r.id === id);
    if (!restaurant) return;

    const newStatus = statusMap[action];
    if (!newStatus) return;

    restaurant.status = newStatus;

    try {
      await Nawa.Auth.apiFetch('/restaurants/' + id, {
        method: 'PUT',
        body: { status: newStatus }
      });
    } catch (e) {
      console.warn('Server sync failed for toggle:', e);
    }

    try {
      await Nawa.DB.update('restaurants', id, { status: newStatus });
    } catch (e) {
      console.warn('DB update failed:', e);
    }

    if (Nawa.Audit && Nawa.Audit.log) {
      Nawa.Audit.log(`restaurant_${action}`, 'restaurants', id, {
        name: restaurant.name,
        newStatus
      });
    }

    const labels = { activate: 'تم تفعيل', suspend: 'تم تعليق', deactivate: 'تم إيقاف' };
    this.showNotification(`${labels[action]} مطعم "${restaurant.name}"`, 'success');

    await this.loadData();
    this.render();
  },

  async deleteRestaurant(id) {
    const restaurant = this.state.restaurants.find(r => r.id === id);
    if (!restaurant) return;

    const isAr = (Nawa.I18n && Nawa.I18n.getLang) ? Nawa.I18n.getLang() === 'ar' : true;
    const confirmMsg = isAr
      ? `هل أنت متأكد من حذف مطعم "${restaurant.name}" نهائياً؟ سيتم حذف جميع البيانات المرتبطة ولا يمكن التراجع عن هذا الإجراء.`
      : `Are you sure you want to permanently delete "${restaurant.name}"? All related data will be deleted and this action cannot be undone.`;
    if (!confirm(confirmMsg)) return;

    try {
      const res = await Nawa.Auth.apiFetch('/restaurants/' + id, { method: 'DELETE' });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'Server returned ' + res.status);
      }
      try { await Nawa.DB.hardDelete('restaurants', id); } catch (e) {}
      this.state.restaurants = this.state.restaurants.filter(r => r.id !== id);
      this.closeDetail();
      await this.loadData();
      this.render();
      this.showNotification(isAr ? `تم حذف مطعم "${restaurant.name}" نهائياً` : `Restaurant "${restaurant.name}" deleted permanently`, 'success');
    } catch (e) {
      console.error('deleteRestaurant error:', e);
      this.showNotification(isAr ? 'حدث خطأ أثناء حذف المطعم: ' + e.message : 'Error deleting restaurant: ' + e.message, 'error');
    }
  },

  bindEvents() {
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.state.currentView = btn.dataset.nav;
        this.render();
      });
    });

    const addBtn = document.getElementById('saAddRestaurant');
    if (addBtn) addBtn.addEventListener('click', () => this.showAddRestaurantModal());

    const searchInput = document.getElementById('saSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.state.searchQuery = e.target.value;
        this.renderRestaurantsContent();
      });
    }

    const filterSelect = document.getElementById('saFilterStatus');
    if (filterSelect) {
      filterSelect.addEventListener('change', (e) => {
        this.state.filterStatus = e.target.value;
        this.renderRestaurantsContent();
      });
    }

    document.querySelectorAll('[data-detail]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.detail;
        const restaurant = this.state.restaurants.find(r => r.id === id);
        if (restaurant) this.renderRestaurantDetail(restaurant);
      });
    });

    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = e.currentTarget.dataset.action;
        const id = e.currentTarget.dataset.id;
        if (action === 'delete') {
          await this.deleteRestaurant(id);
        } else {
          if (confirm(this.getConfirmMessage(action))) {
            await this.toggleRestaurant(id, action);
          }
        }
      });
    });

    const logoutBtn = document.getElementById('saLogout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        if (Nawa.Auth && Nawa.Auth.logout) Nawa.Auth.logout();
        window.location.hash = '#/login';
      });
    }

    document.querySelectorAll('[data-report-weeks]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.state.reportWeeks = parseInt(btn.dataset.reportWeeks);
        this.loadWeeklySales();
      });
    });

    document.querySelectorAll('[data-approve-reg]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm(Nawa.I18n.getLang() === 'ar' ? 'هل توافق على هذا التسجيل؟' : 'Approve this registration?')) {
          await this.approveRegistration(btn.dataset.approveReg);
        }
      });
    });

    document.querySelectorAll('[data-reject-reg]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm(Nawa.I18n.getLang() === 'ar' ? 'هل ترفض هذا التسجيل؟' : 'Reject this registration?')) {
          await this.rejectRegistration(btn.dataset.rejectReg);
        }
      });
    });

    if (this.state.currentView === 'weekly-sales' && !this.state.salesReport) {
      this.loadWeeklySales();
    }
  },

  renderRestaurantsContent() {
    const content = document.querySelector('.sa-content');
    if (content) {
      content.innerHTML = this.renderRestaurants();
      this.bindEvents();
    }
  },

  getConfirmMessage(action) {
    const msgs = {
      activate: 'هل أنت متأكد من تفعيل هذا المطعم؟',
      suspend: 'هل أنت متأكد من تعليق هذا المطعم؟',
      deactivate: 'هل أنت متأكد من إيقاف هذا المطعم؟ لا يمكن التراجع عن هذا الإجراء.',
      delete: 'هل أنت متأكد من حذف هذا المطعم نهائياً؟ سيتم حذف جميع البيانات المرتبطة ولا يمكن التراجع عن هذا الإجراء.'
    };
    return msgs[action] || 'هل أنت متأكد؟';
  },

  statusLabel(status) {
    const labels = { active: 'نشط', suspended: 'معلق', inactive: 'متوقف' };
    return labels[status] || 'غير معروف';
  },

  planLabel(plan) {
    const labels = { basic: 'أساسي', medium: 'متوسط', advanced: 'متقدم' };
    return labels[plan] || '—';
  },

  formatCurrency(amount) {
    const isAr = (Nawa.I18n && Nawa.I18n.getLang) ? Nawa.I18n.getLang() === 'ar' : true;
    const currency = isAr ? 'ل.س' : 'SYP';
    return new Intl.NumberFormat(isAr ? 'ar-SA' : 'en-US', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount || 0) + ' ' + currency;
  },

  showNotification(message, type = 'info') {
    const existing = document.querySelector('.sa-toast');
    if (!existing) return;

    existing.textContent = message;
    existing.className = `sa-toast ${type} show`;

    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      existing.classList.remove('show');
    }, 3500);
  }
};
