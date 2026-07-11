(function () {
  var CFG = window.Nawa.CONFIG;
  var S = CFG.STORES;
  var db = null;

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (db) { resolve(db); return; }
      var req = indexedDB.open(CFG.DB_NAME, CFG.DB_VERSION);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        var stores = [
          { name: S.PRODUCTS, key: 'id', indexes: ['categoryId', 'barcode', 'name'] },
          { name: S.ORDERS, key: 'id', indexes: ['tableId', 'employeeId', 'status', 'createdAt'] },
          { name: S.TABLES, key: 'id', indexes: ['floorId', 'number'] },
          { name: S.FLOORS, key: 'id', indexes: ['order'] },
          { name: S.EMPLOYEES, key: 'id', indexes: ['username', 'role'] },
          { name: S.AUDIT_LOG, key: 'id', indexes: ['store', 'recordId', 'timestamp', 'userId'] },
          { name: S.SETTINGS, key: 'id', indexes: ['key'] },
          { name: S.CUSTOMERS, key: 'id', indexes: ['phone', 'name'] },
          { name: S.CATEGORIES, key: 'id', indexes: ['order', 'name'] },
          { name: S.PENDING_SYNC, key: 'id', indexes: ['store', 'action'] },
          { name: 'restaurants', key: 'id', indexes: ['name', 'status', 'owner'] }
        ];
        stores.forEach(function (s) {
          var store = d.createObjectStore(s.name, { keyPath: s.key });
          s.indexes.forEach(function (ix) {
            store.createIndex(ix, ix, { unique: false });
          });
        });
      };
      req.onsuccess = function (e) { db = e.target.result; resolve(db); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function tx(storeName, mode) {
    return openDB().then(function (d) {
      return d.transaction(storeName, mode).objectStore(storeName);
    });
  }

  function promisify(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  var DB = {
    init: function () { return openDB(); },

    getAll: function (store) {
      return tx(store, 'readonly').then(function (s) { return promisify(s.getAll()); });
    },

    getById: function (store, id) {
      return tx(store, 'readonly').then(function (s) { return promisify(s.get(id)); });
    },

    add: function (store, data) {
      var rec = Object.assign({}, data);
      rec.id = rec.id || genId();
      rec.createdAt = rec.createdAt || new Date().toISOString();
      return tx(store, 'readwrite').then(function (s) { return promisify(s.add(rec)); }).then(function () { return rec; });
    },

    update: function (store, id, data) {
      var self = this;
      return this.getById(store, id).then(function (existing) {
        if (!existing) throw new Error('Record not found: ' + id);
        var updated = Object.assign({}, existing, data, { id: id, updatedAt: new Date().toISOString() });
        return tx(store, 'readwrite').then(function (s) { return promisify(s.put(updated)); }).then(function () { return updated; });
      });
    },

    delete: function (store, id) {
      return this.update(store, id, { deletedAt: new Date().toISOString() });
    },

    hardDelete: function (store, id) {
      return tx(store, 'readwrite').then(function (s) { return promisify(s.delete(id)); });
    },

    query: function (store, indexName, value) {
      return tx(store, 'readonly').then(function (s) {
        var idx = s.index(indexName);
        return promisify(idx.getAll(value));
      });
    },

    count: function (store) {
      return tx(store, 'readonly').then(function (s) { return promisify(s.count()); });
    },

    clear: function (store) {
      return tx(store, 'readwrite').then(function (s) { return promisify(s.clear()); });
    },

    search: function (store, field, term) {
      return this.getAll(store).then(function (items) {
        var lower = term.toLowerCase();
        return items.filter(function (item) {
          var val = item[field];
          if (typeof val === 'string') return val.toLowerCase().indexOf(lower) !== -1;
          return false;
        });
      });
    },

    seed: function () {
      var self = this;
      return this.count(S.CATEGORIES).then(function (c) {
        if (c > 0) return false;

        var floors = [
          { id: 'f1', name: 'الطابق العلوي', nameEn: 'Upper Floor', order: 1 },
          { id: 'f2', name: 'الطابق السفلي', nameEn: 'Lower Floor', order: 2 },
          { id: 'f3', name: 'التراس', nameEn: 'Terrace', order: 3 },
          { id: 'f4', name: 'الخاصة', nameEn: 'Private', order: 4 }
        ];

        var tables = [
          { id: 't1', floorId: 'f1', number: 1, shape: 'round', seats: 2, status: 'available' },
          { id: 't2', floorId: 'f1', number: 2, shape: 'round', seats: 2, status: 'available' },
          { id: 't3', floorId: 'f1', number: 3, shape: 'square', seats: 4, status: 'available' },
          { id: 't4', floorId: 'f1', number: 4, shape: 'square', seats: 4, status: 'available' },
          { id: 't5', floorId: 'f1', number: 5, shape: 'rectangle', seats: 6, status: 'available' },
          { id: 't6', floorId: 'f2', number: 1, shape: 'square', seats: 4, status: 'available' },
          { id: 't7', floorId: 'f2', number: 2, shape: 'square', seats: 4, status: 'available' },
          { id: 't8', floorId: 'f2', number: 3, shape: 'rectangle', seats: 6, status: 'available' },
          { id: 't9', floorId: 'f2', number: 4, shape: 'rectangle', seats: 8, status: 'available' },
          { id: 't10', floorId: 'f2', number: 5, shape: 'round', seats: 2, status: 'available' },
          { id: 't11', floorId: 'f3', number: 1, shape: 'round', seats: 2, status: 'available' },
          { id: 't12', floorId: 'f3', number: 2, shape: 'round', seats: 4, status: 'available' },
          { id: 't13', floorId: 'f3', number: 3, shape: 'square', seats: 4, status: 'available' },
          { id: 't14', floorId: 'f4', number: 1, shape: 'rectangle', seats: 8, status: 'available' },
          { id: 't15', floorId: 'f4', number: 2, shape: 'rectangle', seats: 8, status: 'available' }
        ];

        var categories = [
          { id: 'c1', name: 'المشروبات الساخنة', nameEn: 'Hot Drinks', order: 1 },
          { id: 'c2', name: 'المشروبات الباردة', nameEn: 'Cold Drinks', order: 2 },
          { id: 'c3', name: 'الأطباق الرئيسية', nameEn: 'Main Dishes', order: 3 },
          { id: 'c4', name: 'المقبلات', nameEn: 'Appetizers', order: 4 },
          { id: 'c5', name: 'الحلويات', nameEn: 'Desserts', order: 5 },
          { id: 'c6', name: 'الإضافات', nameEn: 'Add-ons', order: 6 }
        ];

        var products = [
          { id: 'p1', name: 'قهوة عربية', nameEn: 'Arabic Coffee', categoryId: 'c1', price: 15, image: null, barcode: '100001', isActive: true },
          { id: 'p2', name: 'قهوة تركية', nameEn: 'Turkish Coffee', categoryId: 'c1', price: 12, image: null, barcode: '100002', isActive: true },
          { id: 'p3', name: 'إسبريسو', nameEn: 'Espresso', categoryId: 'c1', price: 10, image: null, barcode: '100003', isActive: true },
          { id: 'p4', name: 'كابتشينو', nameEn: 'Cappuccino', categoryId: 'c1', price: 15, image: null, barcode: '100004', isActive: true },
          { id: 'p5', name: 'لاتيه', nameEn: 'Latte', categoryId: 'c1', price: 15, image: null, barcode: '100005', isActive: true },
          { id: 'p6', name: 'شاي أحمر', nameEn: 'Black Tea', categoryId: 'c1', price: 8, image: null, barcode: '100006', isActive: true },
          { id: 'p7', name: 'شاي بالنعناع', nameEn: 'Mint Tea', categoryId: 'c1', price: 10, image: null, barcode: '100007', isActive: true },
          { id: 'p8', name: 'موكا', nameEn: 'Mocha', categoryId: 'c1', price: 18, image: null, barcode: '100008', isActive: true },
          { id: 'p9', name: 'عصير برتقال', nameEn: 'Orange Juice', categoryId: 'c2', price: 12, image: null, barcode: '200001', isActive: true },
          { id: 'p10', name: 'عصير ليمون بالنعناع', nameEn: 'Lemon Mint Juice', categoryId: 'c2', price: 10, image: null, barcode: '200002', isActive: true },
          { id: 'p11', name: 'عصير مانجو', nameEn: 'Mango Juice', categoryId: 'c2', price: 14, image: null, barcode: '200003', isActive: true },
          { id: 'p12', name: 'ميلك شيك فراولة', nameEn: 'Strawberry Milkshake', categoryId: 'c2', price: 18, image: null, barcode: '200004', isActive: true },
          { id: 'p13', name: 'ميلك شيك شوكولاتة', nameEn: 'Chocolate Milkshake', categoryId: 'c2', price: 18, image: null, barcode: '200005', isActive: true },
          { id: 'p14', name: 'سفن أب', nameEn: '7UP', categoryId: 'c2', price: 5, image: null, barcode: '200006', isActive: true },
          { id: 'p15', name: 'بيبسي', nameEn: 'Pepsi', categoryId: 'c2', price: 5, image: null, barcode: '200007', isActive: true },
          { id: 'p16', name: 'ماء معدني', nameEn: 'Mineral Water', categoryId: 'c2', price: 3, image: null, barcode: '200008', isActive: true },
          { id: 'p17', name: 'مشكل مشاوي', nameEn: 'Mixed Grill', categoryId: 'c3', price: 85, image: null, barcode: '300001', isActive: true },
          { id: 'p18', name: 'كبسة لحم', nameEn: 'Lamb Kabsa', categoryId: 'c3', price: 55, image: null, barcode: '300002', isActive: true },
          { id: 'p19', name: 'مقلوبة', nameEn: 'Maqluba', categoryId: 'c3', price: 45, image: null, barcode: '300003', isActive: true },
          { id: 'p20', name: 'مندي دجاج', nameEn: 'Chicken Mandi', categoryId: 'c3', price: 40, image: null, barcode: '300004', isActive: true },
          { id: 'p21', name: 'برياني دجاج', nameEn: 'Chicken Biryani', categoryId: 'c3', price: 38, image: null, barcode: '300005', isActive: true },
          { id: 'p22', name: 'فاهيتا لحم', nameEn: 'Beef Fajita', categoryId: 'c3', price: 48, image: null, barcode: '300006', isActive: true },
          { id: 'p23', name: 'حمص', nameEn: 'Hummus', categoryId: 'c4', price: 12, image: null, barcode: '400001', isActive: true },
          { id: 'p24', name: 'فول مدمس', nameEn: 'Foul Medames', categoryId: 'c4', price: 10, image: null, barcode: '400002', isActive: true },
          { id: 'p25', name: 'ورق عنب', nameEn: 'Grape Leaves', categoryId: 'c4', price: 15, image: null, barcode: '400003', isActive: true },
          { id: 'p26', name: '.spring rolls', nameEn: 'Spring Rolls', categoryId: 'c4', price: 14, image: null, barcode: '400004', isActive: true },
          { id: 'p27', name: 'كنافة', nameEn: 'Kunafa', categoryId: 'c5', price: 22, image: null, barcode: '500001', isActive: true },
          { id: 'p28', name: 'بقلاوة', nameEn: 'Baklava', categoryId: 'c5', price: 20, image: null, barcode: '500002', isActive: true },
          { id: 'p29', name: 'أم علي', nameEn: 'Om Ali', categoryId: 'c5', price: 25, image: null, barcode: '500003', isActive: true },
          { id: 'p30', name: 'آيس كريم', nameEn: 'Ice Cream', categoryId: 'c5', price: 15, image: null, barcode: '500004', isActive: true },
          { id: 'p31', name: 'زبدة', nameEn: 'Butter', categoryId: 'c6', price: 3, image: null, barcode: '600001', isActive: true },
          { id: 'p32', name: 'خبز عربي', nameEn: 'Arabic Bread', categoryId: 'c6', price: 2, image: null, barcode: '600002', isActive: true },
          { id: 'p33', name: 'أرز إضافي', nameEn: 'Extra Rice', categoryId: 'c6', price: 5, image: null, barcode: '600003', isActive: true },
          { id: 'p34', name: 'صلصة حارة', nameEn: 'Hot Sauce', categoryId: 'c6', price: 2, image: null, barcode: '600004', isActive: true }
        ];

        var employees = [
          { id: 'e1', name: 'أحمد', nameEn: 'Ahmed', username: 'admin', password: 'admin123', role: 'admin', isActive: true },
          { id: 'e2', name: 'سارة', nameEn: 'Sara', username: 'cashier', password: 'cashier123', role: 'cashier', isActive: true },
          { id: 'e3', name: 'محمد', nameEn: 'Mohammed', username: 'cashier2', password: 'cashier123', role: 'cashier', isActive: true }
        ];

        var now = new Date().toISOString();
        var addTimestamp = function (arr) {
          return arr.map(function (item) {
            item.createdAt = now;
            return item;
          });
        };

        return Promise.all([
          self.clear(S.FLOORS),
          self.clear(S.TABLES),
          self.clear(S.CATEGORIES),
          self.clear(S.PRODUCTS),
          self.clear(S.EMPLOYEES)
        ]).then(function () {
          var ops = [];
          addTimestamp(floors).forEach(function (r) { ops.push(self.add(S.FLOORS, r)); });
          addTimestamp(tables).forEach(function (r) { ops.push(self.add(S.TABLES, r)); });
          addTimestamp(categories).forEach(function (r) { ops.push(self.add(S.CATEGORIES, r)); });
          addTimestamp(products).forEach(function (r) { ops.push(self.add(S.PRODUCTS, r)); });
          addTimestamp(employees).forEach(function (r) { ops.push(self.add(S.EMPLOYEES, r)); });
          return Promise.all(ops);
        }).then(function () { return true; });
      });
    }
  };

  window.Nawa = window.Nawa || {};
  window.Nawa.DB = DB;
})();
