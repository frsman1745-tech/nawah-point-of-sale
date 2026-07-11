var Nawa = window.Nawa || {};

Nawa.CONFIG = {
  APP_NAME: 'نواة POS',
  COMPANY_NAME: 'شركة نواة',
  VERSION: '1.0.0',
  DB_NAME: 'nawa_pos_db',
  DB_VERSION: 1,
  OFFLINE_HOURS: 24,
  SYNC_INTERVAL: 300000,
  API_BASE: '/api',
  STORES: {
    PRODUCTS: 'products',
    ORDERS: 'orders',
    TABLES: 'tables',
    FLOORS: 'floors',
    EMPLOYEES: 'employees',
    AUDIT_LOG: 'audit_log',
    SETTINGS: 'settings',
    CUSTOMERS: 'customers',
    CATEGORIES: 'categories',
    PENDING_SYNC: 'pending_sync'
  }
};
