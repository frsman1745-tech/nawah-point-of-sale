/* ========================================================
   Super Admin Module - نواة POS
   ======================================================== */

Nawa.SuperAdmin = {
  state: {
    restaurants: [],
    stats: { total: 0, active: 0, suspended: 0, inactive: 0, revenue: 0 },
    selectedRestaurant: null,
    currentView: 'dashboard',
    searchQuery: '',
    filterStatus: 'all',
    salesReport: null,
    reportWeeks: 1
  },

  async init() {
    if (Nawa.Auth && Nawa.Auth.requireAuth) {
      Nawa.Auth.requireAuth('super_admin');
    }
    await this.loadData();
    this.render();
  },

  async loadData() {
    try {
      const db = Nawa.DB;
      const allRestaurants = await db.getAll('restaurants') || [];
      this.state.restaurants = allRestaurants;
      this.state.stats = {
        total: allRestaurants.length,
        active: allRestaurants.filter(r => r.status === 'active').length,
        suspended: allRestaurants.filter(r => r.status === 'suspended').length,
        inactive: allRestaurants.filter(r => r.status === 'inactive').length,
        revenue: allRestaurants.reduce((sum, r) => sum + (r.revenue || 0), 0)
      };
    } catch (e) {
      console.warn('SuperAdmin loadData fallback:', e);
      this.state.restaurants = [];
      this.state.stats = { total: 0, active: 0, suspended: 0, inactive: 0, revenue: 0 };
    }
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
    const nav = [
      { id: 'dashboard', label: 'لوحة التحكم', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>' },
      { id: 'restaurants', label: 'المطاعم', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21V7l9-4 9 4v14"/><path d="M9 21V11h6v10"/></svg>' },
      { id: 'plans', label: 'الباقات', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>' },
      { id: 'weekly-sales', label: 'تقرير المبيعات الأسبوعي', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>' },
    ];

    return `
    <aside class="sa-sidebar">
      <div class="sa-sidebar-header">
        <div class="sa-sidebar-logo">
          <svg width="36" height="36" viewBox="0 0 100 100" fill="none">
            <circle cx="50" cy="50" r="12" fill="#0D9488"/>
            <ellipse cx="50" cy="50" rx="35" ry="14" stroke="#0D9488" stroke-width="2.5" fill="none"/>
            <ellipse cx="50" cy="50" rx="35" ry="14" stroke="#14B8A6" stroke-width="2.5" fill="none" transform="rotate(60 50 50)"/>
            <ellipse cx="50" cy="50" rx="35" ry="14" stroke="#0F766E" stroke-width="2.5" fill="none" transform="rotate(120 50 50)"/>
            <circle cx="85" cy="50" r="5" fill="#14B8A6"/>
            <circle cx="32.5" cy="21.7" r="5" fill="#0D9488"/>
            <circle cx="32.5" cy="78.3" r="5" fill="#0F766E"/>
          </svg>
          <span class="sa-sidebar-brand">نواة</span>
        </div>
        <p class="sa-sidebar-subtitle">نظام نقاط البيع</p>
        <span class="sa-sidebar-role">مدير النظام العام</span>
      </div>
      <nav class="sa-nav">
        <p class="sa-nav-label">القائمة</p>
        ${nav.map(item => `
          <button class="sa-nav-item ${this.state.currentView === item.id ? 'active' : ''}" data-nav="${item.id}">
            ${item.icon}
            <span>${item.label}</span>
          </button>
        `).join('')}
        <div class="sa-nav-divider"></div>
        <p class="sa-nav-label">النظام</p>
        <button class="sa-nav-item" data-nav="settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          <span>الإعدادات</span>
        </button>
      </nav>
      <div class="sa-sidebar-footer">
        <button class="sa-sidebar-footer-btn" id="saLogout">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span>تسجيل الخروج</span>
        </button>
      </div>
    </aside>`;
  },

  renderTopbar() {
    const titles = {
      dashboard: ['لوحة التحكم', 'نظرة عامة على النظام'],
      restaurants: ['المطاعم', 'إدارة جميع المطاعم المشتركين'],
      plans: ['الباقات', 'خطط الاشتراك المتاحة'],
      'weekly-sales': ['تقرير المبيعات الأسبوعي', 'تحليل مبيعات جميع المطاعم'],
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
            إضافة مطعم
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
    return `
    <div class="sa-stats-grid">
      <div class="sa-stat-card">
        <div class="sa-stat-icon total">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21V7l9-4 9 4v14"/><path d="M9 21V11h6v10"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">إجمالي المطاعم</div>
          <div class="sa-stat-value">${s.total}</div>
        </div>
      </div>
      <div class="sa-stat-card">
        <div class="sa-stat-icon active">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">نشطة</div>
          <div class="sa-stat-value">${s.active}</div>
        </div>
      </div>
      <div class="sa-stat-card">
        <div class="sa-stat-icon suspended">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">معلقة</div>
          <div class="sa-stat-value">${s.suspended}</div>
        </div>
      </div>
      <div class="sa-stat-card">
        <div class="sa-stat-icon revenue">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">إجمالي الإيرادات</div>
          <div class="sa-stat-value">${this.formatCurrency(s.revenue)}</div>
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:2fr 1fr;gap:24px;">
      <div class="sa-card">
        <div class="sa-card-header">
          <h2>آخر النشاطات</h2>
        </div>
        <div class="sa-card-body">
          ${this.renderRecentActivity()}
        </div>
      </div>
      <div class="sa-card">
        <div class="sa-card-header">
          <h2>ملخص سريع</h2>
        </div>
        <div class="sa-card-body">
          <div style="display:flex;flex-direction:column;gap:14px;">
            <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--sa-border);">
              <span style="color:var(--sa-text-muted);font-size:13px;">غير نشطة</span>
              <span style="font-weight:700;">${s.inactive}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--sa-border);">
              <span style="color:var(--sa-text-muted);font-size:13px;">نسبة التنشيط</span>
              <span style="font-weight:700;color:var(--sa-success);">${s.total > 0 ? Math.round((s.active / s.total) * 100) : 0}%</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--sa-border);">
              <span style="color:var(--sa-text-muted);font-size:13px;">متوسط الإيراد/مطعم</span>
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
    const restaurants = this.state.restaurants.slice(0, 5);
    const templates = [
      { text: (r) => `تم تفعيل مطعم "${r.name}"`, color: 'green', time: 'منذ 5 دقائق' },
      { text: (r) => `مطعم "${r.name}" قام بتحديث المنيو`, color: 'blue', time: 'منذ 15 دقيقة' },
      { text: (r) => `تم تعليق اشتراك "${r.name}"`, color: 'yellow', time: 'منذ ساعة' },
      { text: (r) => `مطعم "${r.name}" - تم إصدار فاتورة جديدة`, color: 'green', time: 'منذ 3 ساعات' },
      { text: (r) => `إضافة مستخدم جديد لمطعم "${r.name}"`, color: 'blue', time: 'منذ يوم' },
    ];

    if (restaurants.length === 0) {
      return [
        { text: 'مرحباً بك في لوحة التحكم العام', color: 'green', time: 'الآن' },
        { text: 'يمكنك إضافة مطعم جديد للبدء', color: 'blue', time: 'الآن' },
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
                        <button class="sa-btn sa-btn-danger sa-btn-sm" data-action="deactivate" data-id="${r.id}" title="إيقاف">إيقاف</button>
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

  renderRestaurantDetail(restaurant) {
    if (!restaurant) return '';
    const modalRoot = document.getElementById('sa-modal-root');
    if (!modalRoot) return;

    const orders = restaurant.ordersThisMonth || Math.floor(Math.random() * 500) + 50;
    const storage = restaurant.storageUsed || (Math.random() * 500 + 50).toFixed(1);

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
            </div>
          </div>

          <div class="sa-detail-section">
            <h3>إحصائيات الاستخدام</h3>
            <div class="sa-detail-grid">
              <div class="sa-detail-field">
                <div class="sa-detail-field-label">الطلبات هذا الشهر</div>
                <div class="sa-detail-field-value">${orders.toLocaleString()}</div>
              </div>
              <div class="sa-detail-field">
                <div class="sa-detail-field-label">المساحة المستخدمة</div>
                <div class="sa-detail-field-value">${storage} MB</div>
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
        await this.toggleRestaurant(id, action);
        this.closeDetail();
      });
    });

    const loginAsBtn = modalRoot.querySelector('[data-login-as]');
    if (loginAsBtn) {
      loginAsBtn.addEventListener('click', () => {
        this.showNotification('جاري تسجيل الدخول كمدير مطعم...', 'info');
        setTimeout(() => {
          window.location.hash = '#/admin';
        }, 1000);
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
          <div class="sa-plan-price">${p.price} <span>ر.س / شهرياً</span></div>
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
    content.innerHTML = view === 'weekly-sales' ? this.renderWeeklySales() : '';
    this.bindEvents();
  },

  renderWeeklySales() {
    const report = this.state.salesReport;
    if (!report) {
      return `<div class="sa-card"><div class="sa-card-body"><div class="sa-empty"><h3>جاري تحميل البيانات...</h3></div></div></div>`;
    }

    if (!report.totalSales && report.totalSales !== 0) {
      return `<div class="sa-card"><div class="sa-card-body"><div class="sa-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg><h3>لا توجد بيانات مبيعات لهذا الفترة</h3></div></div></div>`;
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
      <button class="sa-btn sa-btn-outline ${this.state.reportWeeks === 1 ? 'active' : ''}" data-report-weeks="1">أسبوع واحد</button>
      <button class="sa-btn sa-btn-outline ${this.state.reportWeeks === 2 ? 'active' : ''}" data-report-weeks="2">أسبوعين</button>
    </div>

    <div class="sa-stats-grid">
      <div class="sa-stat-card">
        <div class="sa-stat-icon revenue">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">إجمالي المبيعات</div>
          <div class="sa-stat-value">${this.formatCurrency(report.totalSales)}</div>
        </div>
      </div>
      <div class="sa-stat-card">
        <div class="sa-stat-icon total">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">عدد الطلبات</div>
          <div class="sa-stat-value">${(report.orderCount || 0).toLocaleString()}</div>
        </div>
      </div>
      <div class="sa-stat-card">
        <div class="sa-stat-icon active">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20V10"/><path d="M18 20V4"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">متوسط قيمة الطلب</div>
          <div class="sa-stat-value">${this.formatCurrency(report.orderCount > 0 ? report.totalSales / report.orderCount : 0)}</div>
        </div>
      </div>
      <div class="sa-stat-card">
        <div class="sa-stat-icon ${changePercent >= 0 ? 'active' : 'suspended'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>
        </div>
        <div class="sa-stat-info">
          <div class="sa-stat-label">نسبة التغيير</div>
          <div class="sa-stat-value">${changePercent >= 0 ? '+' : ''}${changePercent}%</div>
        </div>
      </div>
    </div>

    <div class="sa-card sa-chart-container" style="margin-bottom:24px;">
      <div class="sa-card-header">
        <h2>المبيعات اليومية</h2>
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
        ` : '<div class="sa-empty"><h3>لا توجد بيانات يومية</h3></div>'}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div class="sa-card">
        <div class="sa-card-header">
          <h2>أكثر المنتجات مبيعاً</h2>
        </div>
        <div class="sa-card-body" style="padding:0;">
          ${topProducts.length > 0 ? `
            <div class="sa-table-wrap">
              <table class="sa-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>المنتج</th>
                    <th>الكمية المباعة</th>
                    <th>إجمالي المبيعات</th>
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
          ` : '<div class="sa-empty"><h3>لا توجد بيانات منتجات</h3></div>'}
        </div>
      </div>

      <div class="sa-card">
        <div class="sa-card-header">
          <h2>مبيعات المطاعم</h2>
        </div>
        <div class="sa-card-body" style="padding:0;">
          ${restaurantSales.length > 0 ? `
            <div class="sa-table-wrap">
              <table class="sa-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>المطعم</th>
                    <th>عدد الطلبات</th>
                    <th>إجمالي المبيعات</th>
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
          ` : '<div class="sa-empty"><h3>لا توجد بيانات مطاعم</h3></div>'}
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
                  <option value="basic">أساسي - 199 ر.س/شهر</option>
                  <option value="medium" selected>متوسط - 499 ر.س/شهر</option>
                  <option value="advanced">متقدم - 999 ر.س/شهر</option>
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
      const restaurant = {
        id: 'rest_' + Date.now(),
        name: data.name,
        owner: data.owner,
        phone: data.phone,
        email: data.email,
        plan: data.plan,
        password: data.password,
        status: 'active',
        startDate: new Date().toLocaleDateString('ar-SA'),
        endDate: '',
        revenue: 0,
        ordersThisMonth: 0,
        storageUsed: 0,
        createdAt: new Date().toISOString()
      };

      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 1);
      restaurant.endDate = endDate.toLocaleDateString('ar-SA');

      try {
        await Nawa.DB.add('restaurants', restaurant);
      } catch (e) {
        console.warn('DB add failed, storing locally:', e);
        this.state.restaurants.push(restaurant);
      }

      if (Nawa.Audit && Nawa.Audit.log) {
        Nawa.Audit.log('restaurant_added', {
          restaurantId: restaurant.id,
          name: restaurant.name,
          plan: restaurant.plan
        });
      }

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
      await Nawa.DB.put('restaurants', restaurant);
    } catch (e) {
      console.warn('DB update failed:', e);
    }

    if (Nawa.Audit && Nawa.Audit.log) {
      Nawa.Audit.log(`restaurant_${action}`, {
        restaurantId: id,
        name: restaurant.name,
        newStatus
      });
    }

    const labels = { activate: 'تم تفعيل', suspend: 'تم تعليق', deactivate: 'تم إيقاف' };
    this.showNotification(`${labels[action]} مطعم "${restaurant.name}"`, 'success');

    await this.loadData();
    this.render();
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
        if (confirm(this.getConfirmMessage(action))) {
          await this.toggleRestaurant(id, action);
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
      deactivate: 'هل أنت متأكد من إيقاف هذا المطعم؟ لا يمكن التراجع عن هذا الإجراء.'
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
    return new Intl.NumberFormat('ar-SA', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount || 0) + ' ر.س';
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
