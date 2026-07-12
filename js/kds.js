Nawa.KDS = {
  state: {
    orders: [],
    _refreshTimer: null,
    _listenersAttached: false
  },

  async init() {
    const root = document.getElementById('app');
    if (root) {
      root.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;"><div class="spinner-lg"></div></div>';
    }

    await this._loadOrders();
    this.render();
    this._startAutoRefresh();
  },

  destroy() {
    if (this.state._refreshTimer) {
      clearInterval(this.state._refreshTimer);
      this.state._refreshTimer = null;
    }
  },

  async _loadOrders() {
    try {
      var res = await Nawa.Auth.apiFetch('/orders/history?limit=100');
      if (res.ok) {
        var all = await res.json();
        this.state.orders = all.filter(function (o) {
          return o.status === 'active' || o.status === 'held' || o.status === 'pending';
        });
      }
    } catch (e) {}
  },

  _startAutoRefresh() {
    if (this.state._refreshTimer) clearInterval(this.state._refreshTimer);
    this.state._refreshTimer = setInterval(async () => {
      await this._loadOrders();
      this.render();
    }, 8000);
  },

  render() {
    var app = document.getElementById('app');
    if (!app) return;
    var isAr = Nawa.I18n.getLang() === 'ar';
    var t = Nawa.I18n.t;
    var orders = this.state.orders;

    var cardsHtml = '';
    if (orders.length === 0) {
      cardsHtml = '<div class="kds-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="64" height="64"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg><h2>' + (isAr ? 'لا توجد طلبات نشطة' : 'No Active Orders') + '</h2><p>' + (isAr ? 'سيظهر هنا أي طلب جديد يدخل' : 'New orders will appear here automatically') + '</p></div>';
    } else {
      cardsHtml = orders.map(function (order) {
        var orderNum = order.id ? order.id.slice(-6).toUpperCase() : '------';
        var tableName = order.tableId || (isAr ? 'تيك أواي' : 'Takeaway');
        var empName = order.employeeName || order.cashierName || '--';
        var elapsed = '';
        if (order.createdAt) {
          var diff = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 1000);
          var mins = Math.floor(diff / 60);
          var secs = diff % 60;
          elapsed = mins + ':' + (secs < 10 ? '0' : '') + secs;
        }
        var urgency = '';
        if (order.createdAt) {
          var diffMin = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000);
          if (diffMin > 15) urgency = ' urgent';
          else if (diffMin > 8) urgency = ' warning';
        }

        var itemsHtml = (order.items || []).map(function (item) {
          var name = isAr ? (item.name || item.nameEn) : (item.nameEn || item.name);
          var variantSpan = item.variantName ? ' <span class="kds-item-variant">(' + Nawa.POS._escapeHtml(item.variantName) + ')</span>' : '';
          var noteHtml = item.notes ? '<div class="kds-item-note">↳ ' + Nawa.POS._escapeHtml(item.notes) + '</div>' : '';
          return '<div class="kds-item"><span class="kds-item-qty">×' + (item.quantity || 1) + '</span><span class="kds-item-name">' + Nawa.POS._escapeHtml(name || t('item')) + variantSpan + '</span>' + noteHtml + '</div>';
        }).join('');

        var statusClass = order.status === 'held' ? ' held' : '';

        return '<div class="kds-card' + urgency + statusClass + '" data-order-id="' + order.id + '">' +
          '<div class="kds-card-header">' +
            '<div class="kds-card-num">#' + orderNum + '</div>' +
            '<div class="kds-card-table">' + Nawa.POS._escapeHtml(tableName) + '</div>' +
            '<div class="kds-card-time">' + elapsed + '</div>' +
          '</div>' +
          '<div class="kds-card-meta">' + (isAr ? 'الكاشير' : 'Cashier') + ': ' + Nawa.POS._escapeHtml(empName) + '</div>' +
          '<div class="kds-card-items">' + itemsHtml + '</div>' +
          (order.orderNote ? '<div class="kds-card-note"><strong>' + (isAr ? 'ملاحظة:' : 'Note:') + '</strong> ' + Nawa.POS._escapeHtml(order.orderNote) + '</div>' : '') +
          '<div class="kds-card-footer">' +
            '<button class="btn kds-btn-done" data-action="kds-done" data-order-id="' + order.id + '">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg> ' + (isAr ? 'جاهز' : 'Done') +
            '</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    app.innerHTML = '<div class="kds-container">' +
      '<header class="kds-header">' +
        '<div class="kds-header-left">' +
          '<span class="kds-logo">نواة</span>' +
          '<h1 class="kds-title">' + (isAr ? 'شاشة المطبخ' : 'Kitchen Display') + '</h1>' +
        '</div>' +
        '<div class="kds-header-right">' +
          '<span class="kds-count">' + orders.length + ' ' + (isAr ? 'طلبات نشطة' : 'active') + '</span>' +
          '<button class="btn kds-refresh-btn" id="kds-refresh">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6"/><path d="M2.5 11.5a10 10 0 0118.8-4.3M21.5 12.5a10 10 0 01-18.8 4.3"/></svg> ' + (isAr ? 'تحديث' : 'Refresh') +
          '</button>' +
          '<button class="btn kds-back-btn" id="kds-back">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg> ' + (isAr ? 'رجوع' : 'Back') +
          '</button>' +
        '</div>' +
      '</header>' +
      '<div class="kds-grid">' + cardsHtml + '</div>' +
    '</div>';

    this._attachEvents();
  },

  _attachEvents() {
    var self = this;
    var app = document.getElementById('app');
    if (!app) return;

    var refreshBtn = document.getElementById('kds-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async function () {
        await self._loadOrders();
        self.render();
      });
    }

    var backBtn = document.getElementById('kds-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        self.destroy();
        window.location.hash = '#/pos';
      });
    }

    app.querySelectorAll('.kds-btn-done').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var orderId = btn.dataset.orderId;
        if (!orderId) return;
        try {
          var res = await Nawa.Auth.apiFetch('/orders/' + orderId + '/status', {
            method: 'PUT',
            body: { status: 'completed' }
          });
          if (res.ok) {
            self.state.orders = self.state.orders.filter(function (o) { return o.id !== orderId; });
            self.render();
          }
        } catch (e) {}
      });
    });
  }
};
