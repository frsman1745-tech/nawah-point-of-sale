const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://nawah-point-of-sale.vercel.app';
app.use(cors({
  origin: function (origin, cb) {
    if (!origin || origin === ALLOWED_ORIGIN) return cb(null, true);
    return cb(null, false);
  },
  credentials: true
}));

app.use(function (req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));

const JWT_SECRET = process.env.JWT_SECRET;
const MONGODB_URI = process.env.MONGODB_URI;
const SUPER_ADMIN_USER = process.env.SUPER_ADMIN_USERNAME;
const SUPER_ADMIN_PASS = process.env.SUPER_ADMIN_PASSWORD;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and >= 32 chars');
  process.exit(1);
}
if (!MONGODB_URI) {
  console.error('FATAL: MONGODB_URI must be set');
  process.exit(1);
}
if (!SUPER_ADMIN_USER || !SUPER_ADMIN_PASS) {
  console.error('FATAL: SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD must be set');
  process.exit(1);
}

const BCRYPT_ROUNDS = 12;

let cached = global._mongoose;
if (!cached) cached = global._mongoose = { conn: null, promise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, { bufferCommands: false }).then(m => m);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

async function ensureDB(req, res, next) {
  try { await connectDB(); next(); }
  catch (e) { console.error('DB connection error:', e); res.status(500).json({ error: 'Database connection failed' }); }
}
app.use(ensureDB);

// === Rate Limiting (in-memory) ===

const loginAttempts = {};
function rateLimit(windowMs, maxAttempts) {
  return function (req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const key = req.path + ':' + ip;
    const now = Date.now();
    if (!loginAttempts[key] || loginAttempts[key].resetAt < now) {
      loginAttempts[key] = { count: 1, resetAt: now + windowMs };
      return next();
    }
    loginAttempts[key].count++;
    if (loginAttempts[key].count > maxAttempts) {
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    next();
  };
}

setInterval(function () {
  const now = Date.now();
  for (const key in loginAttempts) {
    if (loginAttempts[key].resetAt < now) delete loginAttempts[key];
  }
}, 60000);

const authRateLimit = rateLimit(60 * 1000, 10);
const regRateLimit = rateLimit(60 * 60 * 1000, 5);

const commonOpts = { versionKey: false, minimize: true, strict: true };

// === Schemas ===

const restaurantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  owner: { type: String, trim: true },
  phone: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  plan: { type: String, enum: ['basic', 'medium', 'advanced'], default: 'basic', index: true },
  status: { type: String, enum: ['active', 'suspended', 'inactive'], default: 'active', index: true },
  password: { type: String, select: false },
  startDate: String,
  endDate: String,
  revenue: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, index: true }
}, commonOpts);

const registrationSchema = new mongoose.Schema({
  restaurantName: { type: String, required: true, trim: true },
  ownerName: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true },
  phone: { type: String, trim: true },
  password: { type: String, required: true, select: false },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  rejectReason: { type: String, trim: true },
  reviewedAt: Date,
  createdAt: { type: Date, default: Date.now, index: true }
}, commonOpts);

const orderSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, index: true },
  tableId: String,
  employeeId: String,
  items: [{ p: String, q: Number, pr: Number }],
  sub: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  tot: { type: Number, default: 0 },
  rcv: { type: Number, default: 0 },
  chg: { type: Number, default: 0 },
  m: { type: String, default: 'cash' },
  createdAt: { type: Date, default: Date.now, index: true, expires: 7776000 }
}, commonOpts);

const auditLogSchema = new mongoose.Schema({
  restaurantId: { type: String, index: true },
  userId: String,
  action: { type: String, index: true },
  store: { type: String, index: true },
  rid: String,
  d: mongoose.Schema.Types.Mixed,
  hash: String,
  ph: String,
  ts: { type: Date, default: Date.now, index: true, expires: 2592000 }
}, commonOpts);

const employeeSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, index: true },
  name: { type: String, trim: true },
  nameEn: { type: String, trim: true },
  username: { type: String, required: true, trim: true },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'cashier'], default: 'cashier' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
}, commonOpts);

employeeSchema.index({ restaurantId: 1, username: 1 }, { unique: true });

let Restaurant, Registration, Order, AuditLog, Employee;

function getModels() {
  if (!Restaurant) {
    Restaurant = mongoose.models.Restaurant || mongoose.model('Restaurant', restaurantSchema);
    Registration = mongoose.models.Registration || mongoose.model('Registration', registrationSchema);
    Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
    AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
    Employee = mongoose.models.Employee || mongoose.model('Employee', employeeSchema);
  }
  return { Restaurant, Registration, Order, AuditLog, Employee };
}

// === Auth Middleware ===

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch (e) { res.status(401).json({ error: 'Invalid token' }); }
}

function superAdminOnly(req, res, next) {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

function adminOrAbove(req, res, next) {
  if (!['super_admin', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// === Helpers ===

function mapOrder(o) {
  const obj = o.toObject ? o.toObject() : o;
  return {
    id: obj._id?.toString?.() || obj.id,
    restaurantId: obj.restaurantId,
    tableId: obj.tableId,
    employeeId: obj.employeeId,
    items: (obj.items || []).map(i => ({
      productId: i.p, name: '', nameEn: '', price: i.pr, quantity: i.q, subtotal: i.pr * i.q
    })),
    subtotal: obj.sub,
    tax: obj.tax,
    total: obj.tot,
    amountReceived: obj.rcv,
    change: obj.chg,
    paymentMethod: obj.m,
    status: 'paid',
    createdAt: obj.createdAt
  };
}

function mapAudit(l) {
  const obj = l.toObject ? l.toObject() : l;
  return {
    id: obj._id?.toString?.() || obj.id,
    restaurantId: obj.restaurantId,
    userId: obj.userId,
    action: obj.action,
    store: obj.store,
    recordId: obj.rid,
    data: obj.d,
    hash: obj.hash,
    previousHash: obj.ph,
    timestamp: obj.ts
  };
}

function mapRegistration(r) {
  const obj = r.toObject ? r.toObject() : r;
  return {
    id: obj._id?.toString?.() || obj.id,
    restaurantName: obj.restaurantName,
    ownerName: obj.ownerName,
    email: obj.email,
    phone: obj.phone,
    status: obj.status,
    rejectReason: obj.rejectReason,
    reviewedAt: obj.reviewedAt,
    createdAt: obj.createdAt
  };
}

function sanitizeStr(val, maxLen) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen || 200);
}

// === Routes ===

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '3.0.0' }));

// --- Auth: Super Admin (env vars) ---
app.post('/api/auth/super-login', authRateLimit, (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username !== SUPER_ADMIN_USER || password !== SUPER_ADMIN_PASS) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ role: 'super_admin', name: 'مدير النظام', id: 'superadmin' }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { role: 'super_admin', name: 'مدير النظام', id: 'superadmin' } });
  } catch (e) {
    console.error('Super admin login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// --- Auth: Admin (email + password from Registration collection) ---
app.post('/api/auth/admin-login', authRateLimit, async (req, res) => {
  try {
    const { Restaurant: R, Registration: Reg } = getModels();
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const reg = await Reg.findOne({ email: email.toLowerCase().trim(), status: 'approved' }).select('+password');
    if (!reg) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, reg.password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const restaurant = await R.findOne({ email: email.toLowerCase().trim() });
    const restaurantId = restaurant ? restaurant._id.toString() : null;

    const token = jwt.sign({
      id: reg._id.toString(),
      email: reg.email,
      name: reg.ownerName,
      restaurantId: restaurantId,
      role: 'admin'
    }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      token,
      user: {
        id: reg._id.toString(),
        email: reg.email,
        name: reg.ownerName,
        restaurantId: restaurantId,
        role: 'admin'
      }
    });
  } catch (e) {
    console.error('Admin login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// --- Auth: Cashier (password only) ---
app.post('/api/auth/cashier-login', authRateLimit, async (req, res) => {
  try {
    const { Employee: E } = getModels();
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    const employees = await E.find({ isActive: true, role: 'cashier' }).select('+password');
    let matched = null;
    for (const emp of employees) {
      if (await bcrypt.compare(password, emp.password)) {
        matched = emp;
        break;
      }
    }
    if (!matched) return res.status(401).json({ error: 'Invalid password' });

    const token = jwt.sign({
      id: matched._id.toString(),
      restaurantId: matched.restaurantId,
      role: 'cashier',
      name: matched.name || matched.username
    }, JWT_SECRET, { expiresIn: '8h' });

    res.json({
      token,
      user: {
        id: matched._id.toString(),
        restaurantId: matched.restaurantId,
        role: 'cashier',
        name: matched.name,
        nameEn: matched.nameEn,
        username: matched.username
      }
    });
  } catch (e) {
    console.error('Cashier login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// --- Legacy login (for backwards compatibility) ---
app.post('/api/auth/login', authRateLimit, async (req, res) => {
  try {
    const { Employee: E } = getModels();
    const { username, password } = req.body;

    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    if (username === SUPER_ADMIN_USER && password === SUPER_ADMIN_PASS) {
      const token = jwt.sign({ role: 'super_admin', name: 'مدير النظام', id: 'superadmin' }, JWT_SECRET, { expiresIn: '8h' });
      return res.json({ token, user: { role: 'super_admin', name: 'مدير النظام', id: 'superadmin' } });
    }

    const employees = await E.find({ username }).select('+password');
    let matched = null;
    for (const emp of employees) {
      if (await bcrypt.compare(password, emp.password)) {
        matched = emp;
        break;
      }
    }
    if (!matched) return res.status(401).json({ error: 'Invalid credentials' });
    if (!matched.isActive) return res.status(401).json({ error: 'Account is disabled' });

    const token = jwt.sign({
      id: matched._id.toString(),
      restaurantId: matched.restaurantId,
      role: matched.role,
      name: matched.name
    }, JWT_SECRET, { expiresIn: '8h' });

    res.json({
      token,
      user: {
        id: matched._id.toString(),
        restaurantId: matched.restaurantId,
        role: matched.role,
        name: matched.name,
        nameEn: matched.nameEn,
        username: matched.username
      }
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// === Registration (public) ===
app.post('/api/register', regRateLimit, async (req, res) => {
  try {
    const { Registration: Reg } = getModels();
    const { restaurantName, ownerName, email, phone, password } = req.body;

    if (!restaurantName || !ownerName || !email || !password) {
      return res.status(400).json({ error: 'Restaurant name, owner name, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await Reg.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const registration = new Reg({
      restaurantName: sanitizeStr(restaurantName, 100),
      ownerName: sanitizeStr(ownerName, 100),
      email: email.toLowerCase().trim(),
      phone: sanitizeStr(phone, 20),
      password: hashed,
      status: 'pending'
    });
    await registration.save();

    res.json({ ok: true, message: 'Registration submitted. Waiting for approval.' });
  } catch (e) {
    console.error('Registration error:', e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// === Super Admin - Registrations (approve/reject) ===
app.get('/api/registrations', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { Registration: Reg } = getModels();
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const regs = await Reg.find(filter).sort({ createdAt: -1 }).lean();
    res.json(regs.map(r => ({ ...mapRegistration(r), password: undefined })));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch registrations' }); }
});

app.put('/api/registrations/:id/approve', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { Registration: Reg, Restaurant: R, Employee: E } = getModels();
    const reg = await Reg.findById(req.params.id).select('+password');
    if (!reg) return res.status(404).json({ error: 'Registration not found' });
    if (reg.status !== 'pending') return res.status(400).json({ error: 'Registration already reviewed' });

    const restaurant = new R({
      name: sanitizeStr(reg.restaurantName, 100),
      owner: sanitizeStr(reg.ownerName, 100),
      email: reg.email,
      phone: sanitizeStr(reg.phone, 20),
      status: 'active',
      plan: 'basic',
      startDate: new Date().toISOString().split('T')[0]
    });
    await restaurant.save();

    const adminEmployee = new E({
      restaurantId: restaurant._id.toString(),
      name: reg.ownerName,
      username: reg.email.split('@')[0],
      password: reg.password,
      role: 'admin',
      isActive: true
    });
    await adminEmployee.save();

    reg.status = 'approved';
    reg.reviewedAt = new Date();
    await reg.save();

    res.json({
      ok: true,
      restaurant: { id: restaurant._id.toString(), name: restaurant.name },
      admin: { id: adminEmployee._id.toString(), username: adminEmployee.username }
    });
  } catch (e) {
    console.error('Approve error:', e);
    res.status(500).json({ error: 'Failed to approve registration' });
  }
});

app.put('/api/registrations/:id/reject', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { Registration: Reg } = getModels();
    const reg = await Reg.findById(req.params.id);
    if (!reg) return res.status(404).json({ error: 'Registration not found' });
    if (reg.status !== 'pending') return res.status(400).json({ error: 'Registration already reviewed' });

    reg.status = 'rejected';
    reg.rejectReason = sanitizeStr(req.body.reason, 500);
    reg.reviewedAt = new Date();
    await reg.save();

    res.json({ ok: true });
  } catch (e) {
    console.error('Reject error:', e);
    res.status(500).json({ error: 'Failed to reject registration' });
  }
});

// === Super Admin - Restaurants ===
app.get('/api/restaurants', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { Restaurant: R } = getModels();
    const restaurants = await R.find().sort({ createdAt: -1 }).lean();
    res.json(restaurants.map(r => ({ ...r, id: r._id.toString() })));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch restaurants' }); }
});

app.post('/api/restaurants', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { Restaurant: R } = getModels();
    const b = req.body;
    const restaurant = new R({
      name: sanitizeStr(b.name, 100),
      owner: sanitizeStr(b.owner, 100),
      phone: sanitizeStr(b.phone, 20),
      email: sanitizeStr(b.email, 100),
      plan: ['basic', 'medium', 'advanced'].includes(b.plan) ? b.plan : 'basic',
      status: ['active', 'suspended', 'inactive'].includes(b.status) ? b.status : 'active',
      startDate: sanitizeStr(b.startDate, 20),
      endDate: sanitizeStr(b.endDate, 20),
      revenue: typeof b.revenue === 'number' ? b.revenue : 0
    });
    await restaurant.save();
    res.json({ ...restaurant.toObject(), id: restaurant._id.toString() });
  } catch (e) { res.status(500).json({ error: 'Failed to create restaurant' }); }
});

app.put('/api/restaurants/:id', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { Restaurant: R } = getModels();
    const b = req.body;
    const allowed = {};
    if (b.name !== undefined) allowed.name = sanitizeStr(b.name, 100);
    if (b.owner !== undefined) allowed.owner = sanitizeStr(b.owner, 100);
    if (b.phone !== undefined) allowed.phone = sanitizeStr(b.phone, 20);
    if (b.email !== undefined) allowed.email = sanitizeStr(b.email, 100);
    if (b.plan !== undefined && ['basic', 'medium', 'advanced'].includes(b.plan)) allowed.plan = b.plan;
    if (b.status !== undefined && ['active', 'suspended', 'inactive'].includes(b.status)) allowed.status = b.status;
    if (b.startDate !== undefined) allowed.startDate = sanitizeStr(b.startDate, 20);
    if (b.endDate !== undefined) allowed.endDate = sanitizeStr(b.endDate, 20);
    if (b.revenue !== undefined && typeof b.revenue === 'number') allowed.revenue = b.revenue;

    const restaurant = await R.findByIdAndUpdate(req.params.id, allowed, { new: true });
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({ ...restaurant.toObject(), id: restaurant._id.toString() });
  } catch (e) { res.status(500).json({ error: 'Failed to update restaurant' }); }
});

app.delete('/api/restaurants/:id', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { Restaurant: R, Order: O, AuditLog: AL, Employee: E } = getModels();
    const rid = req.params.id;
    await Promise.all([
      O.deleteMany({ restaurantId: rid }),
      AL.deleteMany({ restaurantId: rid }),
      E.deleteMany({ restaurantId: rid }),
      R.findByIdAndDelete(rid)
    ]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete restaurant' }); }
});

// === Super Admin - Weekly Sales Reports ===
app.get('/api/reports/weekly', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { Order: O, Restaurant: R } = getModels();
    const weeks = parseInt(req.query.weeks) || 1;
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - (weeks * 7));

    const orders = await O.find({ createdAt: { $gte: startDate, $lte: now } }).lean();

    const dailySales = {};
    const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0];
      dailySales[key] = { date: key, dayName: dayNames[d.getDay()], total: 0, count: 0 };
    }
    orders.forEach(order => {
      const key = new Date(order.createdAt).toISOString().split('T')[0];
      if (dailySales[key]) { dailySales[key].total += order.tot || 0; dailySales[key].count += 1; }
    });

    const totalSales = orders.reduce((sum, o) => sum + (o.tot || 0), 0);
    const totalOrders = orders.length;
    const avgOrder = totalOrders > 0 ? totalSales / totalOrders : 0;

    const productSales = {};
    orders.forEach(order => {
      (order.items || []).forEach(item => {
        if (!productSales[item.p]) productSales[item.p] = { name: item.p, quantity: 0, total: 0 };
        productSales[item.p].quantity += item.q;
        productSales[item.p].total += (item.pr || 0) * item.q;
      });
    });
    const topProducts = Object.values(productSales).sort((a, b) => b.total - a.total).slice(0, 10);

    const restaurants = await R.find().lean();
    const restMap = {};
    restaurants.forEach(r => { restMap[r._id.toString()] = r.name; });

    const restaurantSales = {};
    orders.forEach(order => {
      const rid = order.restaurantId || 'unknown';
      if (!restaurantSales[rid]) restaurantSales[rid] = { name: restMap[rid] || 'مطعم غير معروف', orderCount: 0, total: 0 };
      restaurantSales[rid].orderCount += 1;
      restaurantSales[rid].total += order.tot || 0;
    });

    res.json({
      totalSales, orderCount: totalOrders, avgOrder: Math.round(avgOrder),
      dailySales: Object.values(dailySales).map(d => ({ day: d.dayName, date: d.date, amount: d.total })),
      topProducts,
      restaurantSales: Object.values(restaurantSales),
      dateRange: `${startDate.toLocaleDateString('ar-SA')} - ${now.toLocaleDateString('ar-SA')}`
    });
  } catch (e) { console.error('Report error:', e); res.status(500).json({ error: 'Failed to generate report' }); }
});

// === Orders ===
app.get('/api/orders', authMiddleware, async (req, res) => {
  try {
    const { Order: O } = getModels();
    const filter = {};
    if (req.user.restaurantId) filter.restaurantId = req.user.restaurantId;
    if (req.query.all === 'true' && req.user.role === 'super_admin') delete filter.restaurantId;
    if (req.query.from) filter.createdAt = { $gte: new Date(req.query.from) };
    if (req.query.to) filter.createdAt = { ...filter.createdAt, $lte: new Date(req.query.to) };
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    const orders = await O.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    res.json(orders.map(mapOrder));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch orders' }); }
});

app.post('/api/orders', authMiddleware, async (req, res) => {
  try {
    const { Order: O } = getModels();
    const body = req.body;

    if (!req.user.restaurantId) return res.status(403).json({ error: 'No restaurant associated' });

    const orderData = {
      restaurantId: req.user.restaurantId,
      tableId: sanitizeStr(body.tableId, 50),
      employeeId: sanitizeStr(body.employeeId, 50),
      items: Array.isArray(body.items) ? body.items.slice(0, 100).map(i => ({
        p: sanitizeStr(i.name || i.productId, 100),
        q: Math.min(Math.max(parseInt(i.quantity) || 1, 1), 9999),
        pr: Math.max(parseFloat(i.price) || 0, 0)
      })) : [],
      sub: Math.max(parseFloat(body.subtotal) || 0, 0),
      tax: Math.max(parseFloat(body.tax) || 0, 0),
      tot: Math.max(parseFloat(body.total) || 0, 0),
      rcv: Math.max(parseFloat(body.amountReceived) || 0, 0),
      chg: Math.max(parseFloat(body.change) || 0, 0),
      m: ['cash', 'card', 'online'].includes(body.paymentMethod) ? body.paymentMethod : 'cash'
    };
    const order = new O(orderData);
    await order.save();
    res.json(mapOrder(order));
  } catch (e) { res.status(500).json({ error: 'Failed to create order' }); }
});

// === Audit Log ===
app.get('/api/audit', authMiddleware, async (req, res) => {
  try {
    const { AuditLog: AL } = getModels();
    const filter = {};
    if (req.user.restaurantId) filter.restaurantId = req.user.restaurantId;
    if (req.query.all === 'true' && req.user.role === 'super_admin') delete filter.restaurantId;
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const logs = await AL.find(filter).sort({ ts: -1 }).limit(limit).lean();
    res.json(logs.map(mapAudit));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch audit logs' }); }
});

app.post('/api/audit', authMiddleware, async (req, res) => {
  try {
    const { AuditLog: AL } = getModels();
    const b = req.body;

    if (!req.user.restaurantId) return res.status(403).json({ error: 'No restaurant associated' });

    const logData = {
      restaurantId: req.user.restaurantId,
      userId: sanitizeStr(b.userId, 50),
      action: sanitizeStr(b.action, 50),
      store: sanitizeStr(b.store, 50),
      rid: sanitizeStr(b.recordId, 50),
      d: b.data,
      hash: sanitizeStr(b.hash, 200),
      ph: sanitizeStr(b.previousHash, 200)
    };
    const log = new AL(logData);
    await log.save();
    res.json({ ok: true, id: log._id.toString() });
  } catch (e) { res.status(500).json({ error: 'Failed to save audit log' }); }
});

app.get('/api/audit/verify', authMiddleware, async (req, res) => {
  try {
    const { AuditLog: AL } = getModels();
    const filter = {};
    if (req.user.restaurantId) filter.restaurantId = req.user.restaurantId;
    const logs = await AL.find(filter).sort({ ts: 1 }).lean();
    let valid = true;
    for (let i = 1; i < logs.length; i++) {
      if (logs[i].ph !== logs[i - 1].hash) { valid = false; break; }
    }
    res.json({ valid, totalEntries: logs.length });
  } catch (e) { res.status(500).json({ error: 'Failed to verify audit' }); }
});

// === Cleanup old data ===
app.post('/api/cleanup', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { Order: O, AuditLog: AL } = getModels();
    const days = parseInt(req.body.days) || 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const orders = await O.deleteMany({ createdAt: { $lt: cutoff } });
    const logs = await AL.deleteMany({ ts: { $lt: cutoff } });
    res.json({ deletedOrders: orders.deletedCount, deletedLogs: logs.deletedCount });
  } catch (e) { res.status(500).json({ error: 'Cleanup failed' }); }
});

// === Employees ===
app.get('/api/employees', authMiddleware, async (req, res) => {
  try {
    const { Employee: E } = getModels();
    const filter = {};
    if (req.user.restaurantId) filter.restaurantId = req.user.restaurantId;
    if (req.query.all === 'true' && req.user.role === 'super_admin') delete filter.restaurantId;
    const employees = await E.find(filter).lean();
    res.json(employees.map(e => ({ ...e, id: e._id.toString(), password: undefined })));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch employees' }); }
});

app.post('/api/employees', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Employee: E } = getModels();

    if (!req.user.restaurantId) return res.status(403).json({ error: 'No restaurant associated' });

    const b = req.body;
    const name = sanitizeStr(b.name, 100);
    const username = sanitizeStr(b.username, 50);
    const password = b.password;

    if (!name || !username || !password) {
      return res.status(400).json({ error: 'Name, username, and password are required' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const employee = new E({
      restaurantId: req.user.restaurantId,
      name: name,
      nameEn: sanitizeStr(b.nameEn, 100),
      username: username,
      password: hashed,
      role: ['admin', 'cashier'].includes(b.role) ? b.role : 'cashier',
      isActive: true
    });
    await employee.save();
    res.json({ ...employee.toObject(), id: employee._id.toString(), password: undefined });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ error: 'Username already exists for this restaurant' });
    }
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

app.put('/api/employees/:id', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Employee: E } = getModels();

    const employee = await E.findById(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    if (req.user.role !== 'super_admin' && employee.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const b = req.body;
    const allowed = {};
    if (b.name !== undefined) allowed.name = sanitizeStr(b.name, 100);
    if (b.nameEn !== undefined) allowed.nameEn = sanitizeStr(b.nameEn, 100);
    if (b.username !== undefined) allowed.username = sanitizeStr(b.username, 50);
    if (b.role !== undefined && req.user.role === 'super_admin' && ['admin', 'cashier'].includes(b.role)) {
      allowed.role = b.role;
    }
    if (b.isActive !== undefined && typeof b.isActive === 'boolean') {
      allowed.isActive = b.isActive;
    }
    if (b.password && b.password.length >= 4) {
      allowed.password = await bcrypt.hash(b.password, BCRYPT_ROUNDS);
    }

    const updated = await E.findByIdAndUpdate(req.params.id, allowed, { new: true });
    res.json({ ...updated.toObject(), id: updated._id.toString(), password: undefined });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ error: 'Username already exists for this restaurant' });
    }
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

app.delete('/api/employees/:id', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Employee: E } = getModels();

    const employee = await E.findById(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    if (req.user.role !== 'super_admin' && employee.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await E.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete employee' }); }
});

module.exports = app;
