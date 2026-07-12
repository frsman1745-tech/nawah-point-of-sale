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
  discType: { type: String, enum: ['percent', 'fixed'], default: null },
  discVal: { type: Number, default: 0 },
  discAmt: { type: Number, default: 0 },
  discName: { type: String, default: '' },
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
  email: { type: String, trim: true, lowercase: true },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'cashier'], default: 'cashier' },
  isPrimary: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
}, commonOpts);

employeeSchema.index({ restaurantId: 1, username: 1 }, { unique: true });

const productSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  nameEn: { type: String, trim: true },
  price: { type: Number, default: 0 },
  barcode: { type: String, trim: true },
  categoryId: { type: String, trim: true },
  notes: { type: String, trim: true },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
}, commonOpts);

const categorySchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  sortOrder: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
}, commonOpts);

const tableSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, index: true },
  number: { type: Number, required: true },
  name: { type: String, trim: true },
  seats: { type: Number, default: 4 },
  floorId: { type: String, trim: true },
  shape: { type: String, enum: ['round', 'square', 'rectangle', 'pill'], default: 'square' },
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
  color: { type: String, default: '' },
  status: { type: String, enum: ['free', 'occupied', 'reserved'], default: 'free' },
  createdAt: { type: Date, default: Date.now }
}, commonOpts);

const floorSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  color: { type: String, default: '' },
  sortOrder: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
}, commonOpts);

const attendanceSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, index: true },
  employeeId: { type: String, required: true, index: true },
  employeeName: { type: String, trim: true },
  clockIn: { type: Date, default: Date.now },
  clockOut: { type: Date },
  date: { type: String, index: true }
}, commonOpts);

const settingSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, index: true },
  key: { type: String, required: true, trim: true },
  value: { type: mongoose.Schema.Types.Mixed, default: '' }
}, commonOpts);

const discountSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['percent', 'fixed'], default: 'percent' },
  value: { type: Number, required: true },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
}, commonOpts);

const customerSchema = new mongoose.Schema({
  restaurantId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, trim: true },
  notes: { type: String, trim: true },
  createdAt: { type: Date, default: Date.now }
}, commonOpts);

let Restaurant, Registration, Order, AuditLog, Employee, Product, Cat, TableM, Floor, Attendance, Discount, Customer, Setting;

function getModels() {
  if (!Restaurant) {
    Restaurant = mongoose.models.Restaurant || mongoose.model('Restaurant', restaurantSchema);
    Registration = mongoose.models.Registration || mongoose.model('Registration', registrationSchema);
    Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
    AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
    Employee = mongoose.models.Employee || mongoose.model('Employee', employeeSchema);
    Product = mongoose.models.Product || mongoose.model('Product', productSchema);
    Cat = mongoose.models.Cat || mongoose.model('Cat', categorySchema);
    TableM = mongoose.models.TableM || mongoose.model('TableM', tableSchema);
    Floor = mongoose.models.Floor || mongoose.model('Floor', floorSchema);
    Attendance = mongoose.models.Attendance || mongoose.model('Attendance', attendanceSchema);
    Discount = mongoose.models.Discount || mongoose.model('Discount', discountSchema);
    Customer = mongoose.models.Customer || mongoose.model('Customer', customerSchema);
    Setting = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
  }
  return { Restaurant, Registration, Order, AuditLog, Employee, Product, Cat, TableM, Floor, Attendance, Discount, Customer, Setting };
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
    discountType: obj.discType || null,
    discountValue: obj.discVal || 0,
    discountAmount: obj.discAmt || 0,
    discountName: obj.discName || '',
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

// --- Auth: Cashier (username + password) ---
app.post('/api/auth/cashier-login', authRateLimit, async (req, res) => {
  try {
    const { Employee: E } = getModels();
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const employees = await E.find({ username: username.toLowerCase().trim(), isActive: true }).select('+password');
    let matched = null;
    for (const emp of employees) {
      if (await bcrypt.compare(password, emp.password)) {
        matched = emp;
        break;
      }
    }
    if (!matched) return res.status(401).json({ error: 'Invalid username or password' });

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

// === Auth: Change Password (admin/manager only) ===
app.post('/api/auth/change-password', authMiddleware, authRateLimit, async (req, res) => {
  try {
    const { Employee: E } = getModels();
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Old and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    if (req.user.role === 'cashier' || req.user.role === 'super_admin') {
      return res.status(403).json({ error: 'Not authorized to change password' });
    }

    const employee = await E.findById(req.user.id).select('+password');
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const match = await bcrypt.compare(oldPassword, employee.password);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    employee.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await employee.save();

    res.json({ ok: true, message: 'Password updated' });
  } catch (e) {
    console.error('Change password error:', e);
    res.status(500).json({ error: 'Failed to change password' });
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
      email: reg.email,
      isPrimary: true,
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

// === Super Admin - Create Restaurant (with Registration) ===
app.post('/api/admin/create-restaurant', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { Restaurant: R, Registration: Reg, Employee: E } = getModels();
    const b = req.body;
    const { name, owner, phone, email, plan, password } = b;

    if (!name || !owner || !email || !password) {
      return res.status(400).json({ error: 'Restaurant name, owner, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await Reg.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const registration = new Reg({
      restaurantName: sanitizeStr(name, 100),
      ownerName: sanitizeStr(owner, 100),
      email: email.toLowerCase().trim(),
      phone: sanitizeStr(phone, 20),
      password: hashedPassword,
      status: 'approved'
    });
    await registration.save();

    const restaurant = new R({
      name: sanitizeStr(name, 100),
      owner: sanitizeStr(owner, 100),
      phone: sanitizeStr(phone, 20),
      email: email.toLowerCase().trim(),
      plan: ['basic', 'medium', 'advanced'].includes(plan) ? plan : 'basic',
      password: hashedPassword,
      status: 'active',
      startDate: new Date().toISOString().split('T')[0]
    });
    await restaurant.save();

    const adminEmployee = new E({
      restaurantId: restaurant._id.toString(),
      name: sanitizeStr(owner, 100),
      username: email.toLowerCase().trim().split('@')[0],
      password: hashedPassword,
      role: 'admin',
      email: email.toLowerCase().trim(),
      isPrimary: true,
      isActive: true
    });
    await adminEmployee.save();

    res.json({
      ok: true,
      restaurant: { id: restaurant._id.toString(), name: restaurant.name },
      registration: { id: registration._id.toString() }
    });
  } catch (e) {
    console.error('Create restaurant error:', e);
    res.status(500).json({ error: 'Failed to create restaurant' });
  }
});

// === Super Admin - Restaurants ===
app.get('/api/restaurants', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { Restaurant: R } = getModels();
    const restaurants = await R.find().select('+password').sort({ createdAt: -1 }).lean();
    res.json(restaurants.map(r => { const { password, ...rest } = r; return { ...rest, id: r._id.toString() }; }));
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
    const { Restaurant: R, Registration: Reg, Order: O, AuditLog: AL, Employee: E, Product: P, Cat: C, TableM: T, Floor: F, Attendance: A, Discount: D, Customer: Cus, Setting: S } = getModels();
    const rid = req.params.id;
    const restaurant = await R.findById(rid);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    const restaurantName = restaurant.name;
    const results = await Promise.all([
      E.deleteMany({ restaurantId: rid }),
      O.deleteMany({ restaurantId: rid }),
      AL.deleteMany({ restaurantId: rid }),
      P.deleteMany({ restaurantId: rid }),
      C.deleteMany({ restaurantId: rid }),
      T.deleteMany({ restaurantId: rid }),
      F.deleteMany({ restaurantId: rid }),
      A.deleteMany({ restaurantId: rid }),
      D.deleteMany({ restaurantId: rid }),
      Cus.deleteMany({ restaurantId: rid }),
      S.deleteMany({ restaurantId: rid }),
      Reg.deleteMany({ $or: [{ restaurantId: rid }, { restaurantName: restaurantName }] }),
      R.findByIdAndDelete(rid)
    ]);
    res.json({
      ok: true,
      deleted: {
        employees: results[0].deletedCount,
        orders: results[1].deletedCount,
        auditLogs: results[2].deletedCount,
        products: results[3].deletedCount,
        categories: results[4].deletedCount,
        tables: results[5].deletedCount,
        floors: results[6].deletedCount,
        attendance: results[7].deletedCount,
        discounts: results[8].deletedCount,
        customers: results[9].deletedCount,
        registrations: results[10].deletedCount
      }
    });
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

// === Daily Report ===
app.get('/api/reports/daily', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Order: O, Employee: E } = getModels();
    const dateStr = req.query.date || new Date().toISOString().split('T')[0];
    const dayStart = new Date(dateStr + 'T00:00:00.000Z');
    const dayEnd = new Date(dateStr + 'T23:59:59.999Z');

    const filter = { createdAt: { $gte: dayStart, $lte: dayEnd } };
    if (req.user.restaurantId) filter.restaurantId = req.user.restaurantId;

    const orders = await O.find(filter).lean();

    let totalSales = 0;
    let orderCount = 0;
    let paymentBreakdown = { cash: 0, card: 0, online: 0 };
    const productMap = {};
    const cashierMap = {};

    for (const order of orders) {
      const tot = order.tot || 0;
      totalSales += tot;
      orderCount++;

      const method = order.m || 'cash';
      if (paymentBreakdown[method] !== undefined) {
        paymentBreakdown[method] += tot;
      } else {
        paymentBreakdown[method] = tot;
      }

      for (const item of (order.items || [])) {
        const name = item.p || 'Unknown';
        if (!productMap[name]) productMap[name] = { name: name, quantity: 0, total: 0 };
        productMap[name].quantity += item.q || 0;
        productMap[name].total += (item.pr || 0) * (item.q || 0);
      }

      const empId = order.employeeId || 'unknown';
      if (!cashierMap[empId]) cashierMap[empId] = { employeeId: empId, name: empId, orderCount: 0, totalSales: 0 };
      cashierMap[empId].orderCount++;
      cashierMap[empId].totalSales += tot;
    }

    const topProducts = Object.values(productMap)
      .sort(function (a, b) { return b.quantity - a.quantity; })
      .slice(0, 5);

    const cashierArr = Object.values(cashierMap);

    if (cashierArr.length > 0) {
      const empIds = cashierArr.map(function (c) { return c.employeeId; });
      const emps = await E.find({ _id: { $in: empIds } }).lean();
      const empNameMap = {};
      emps.forEach(function (e) { empNameMap[e._id.toString()] = e.name || e.username; });
      cashierArr.forEach(function (c) {
        c.name = empNameMap[c.employeeId] || c.name;
      });
    }

    const avgOrderValue = orderCount > 0 ? Math.round(totalSales / orderCount) : 0;

    res.json({
      date: dateStr,
      totalSales: totalSales,
      orderCount: orderCount,
      avgOrderValue: avgOrderValue,
      paymentBreakdown: paymentBreakdown,
      topProducts: topProducts,
      cashierSummary: cashierArr
    });
  } catch (e) {
    console.error('Daily report error:', e);
    res.status(500).json({ error: 'Failed to generate daily report' });
  }
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

app.get('/api/orders/history', authMiddleware, async (req, res) => {
  try {
    const { Order: O, Employee: E } = getModels();
    const filter = {};
    if (req.user.restaurantId) filter.restaurantId = req.user.restaurantId;
    if (req.query.all === 'true' && req.user.role === 'super_admin') delete filter.restaurantId;
    if (req.query.from) filter.createdAt = { $gte: new Date(req.query.from + 'T00:00:00.000Z') };
    if (req.query.to) filter.createdAt = { ...filter.createdAt, $lte: new Date(req.query.to + 'T23:59:59.999Z') };
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const orders = await O.find(filter).sort({ createdAt: -1 }).limit(limit).lean();

    const employeeFilter = {};
    if (req.user.restaurantId) employeeFilter.restaurantId = req.user.restaurantId;
    const employees = await Employee.find(employeeFilter).lean();
    const empMap = {};
    employees.forEach(function (e) { empMap[e._id.toString()] = e.name || e.username; });

    res.json(orders.map(function (o) {
      var mapped = mapOrder(o);
      mapped.cashierName = empMap[o.employeeId] || '';
      return mapped;
    }));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch order history' }); }
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
      m: ['cash', 'card', 'online'].includes(body.paymentMethod) ? body.paymentMethod : 'cash',
      discType: body.discountType || null,
      discVal: Math.max(parseFloat(body.discountValue) || 0, 0),
      discAmt: Math.max(parseFloat(body.discountAmount) || 0, 0),
      discName: sanitizeStr(body.discountName, 100)
    };
    const order = new O(orderData);
    await order.save();
    res.json(mapOrder(order));
  } catch (e) { res.status(500).json({ error: 'Failed to create order' }); }
});

app.put('/api/orders/:id/status', authMiddleware, async (req, res) => {
  try {
    const { Order: O } = getModels();
    const order = await O.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (req.user.role !== 'super_admin' && order.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const newStatus = req.body.status;
    if (!['active', 'held', 'completed', 'cancelled', 'paid'].includes(newStatus)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    order.status = newStatus;
    await order.save();
    res.json(mapOrder(order));
  } catch (e) { res.status(500).json({ error: 'Failed to update order status' }); }
});

// === Discount Presets ===
app.get('/api/discounts', authMiddleware, async (req, res) => {
  try {
    const { Discount: D } = getModels();
    const filter = {};
    if (req.user.role !== 'super_admin' && req.user.restaurantId) filter.restaurantId = req.user.restaurantId;
    if (req.query.all === 'true' && req.user.role === 'super_admin') delete filter.restaurantId;
    const items = await D.find(filter).sort({ createdAt: -1 }).lean();
    res.json(items.map(i => ({ ...i, id: i._id.toString() })));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch discounts' }); }
});

app.post('/api/discounts', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Discount: D } = getModels();
    if (!req.user.restaurantId && req.user.role !== 'super_admin') return res.status(403).json({ error: 'No restaurant associated' });
    const b = req.body;
    const name = sanitizeStr(b.name, 100);
    const type = ['percent', 'fixed'].includes(b.type) ? b.type : 'percent';
    const value = Math.max(parseFloat(b.value) || 0, 0);
    if (!name || value <= 0) return res.status(400).json({ error: 'Name and positive value are required' });
    if (type === 'percent' && value > 100) return res.status(400).json({ error: 'Percent cannot exceed 100' });
    const item = new D({
      restaurantId: req.user.restaurantId || sanitizeStr(b.restaurantId, 50),
      name,
      type,
      value,
      active: b.active !== false
    });
    await item.save();
    res.json({ ...item.toObject(), id: item._id.toString() });
  } catch (e) { res.status(500).json({ error: 'Failed to create discount' }); }
});

app.put('/api/discounts/:id', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Discount: D } = getModels();
    const item = await D.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Discount not found' });
    if (req.user.role !== 'super_admin' && item.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const b = req.body;
    const allowed = {};
    if (b.name !== undefined) allowed.name = sanitizeStr(b.name, 100);
    if (b.type !== undefined && ['percent', 'fixed'].includes(b.type)) allowed.type = b.type;
    if (b.value !== undefined) {
      const v = Math.max(parseFloat(b.value) || 0, 0);
      if (b.type === 'percent' && v > 100) return res.status(400).json({ error: 'Percent cannot exceed 100' });
      allowed.value = v;
    }
    if (b.active !== undefined && typeof b.active === 'boolean') allowed.active = b.active;
    const updated = await D.findByIdAndUpdate(req.params.id, allowed, { new: true });
    res.json({ ...updated.toObject(), id: updated._id.toString() });
  } catch (e) { res.status(500).json({ error: 'Failed to update discount' }); }
});

app.delete('/api/discounts/:id', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Discount: D } = getModels();
    const item = await D.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Discount not found' });
    if (req.user.role !== 'super_admin' && item.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await D.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete discount' }); }
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

app.post('/api/audit', authMiddleware, adminOrAbove, async (req, res) => {
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
    const { Employee: E, Restaurant: R } = getModels();

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

    const role = ['admin', 'cashier'].includes(b.role) ? b.role : 'cashier';

    // Enforce plan-based manager limits
    if (role === 'admin' && req.user.role !== 'super_admin') {
      const restaurant = await R.findById(req.user.restaurantId);
      if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
      const planLimits = { basic: 1, medium: 2, advanced: 3 };
      const maxAdmins = planLimits[restaurant.plan] || 1;
      const currentAdminCount = await E.countDocuments({ restaurantId: req.user.restaurantId, role: 'admin' });
      if (currentAdminCount >= maxAdmins) {
        return res.status(403).json({ error: 'Plan limit reached for managers. Upgrade your plan to add more.' });
      }
    }

    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const employee = new E({
      restaurantId: req.user.restaurantId,
      name: name,
      nameEn: sanitizeStr(b.nameEn, 100),
      username: username,
      email: b.email ? sanitizeStr(b.email, 100) : undefined,
      password: hashed,
      role: role,
      isPrimary: false,
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

    // Prevent admin from toggling/disabling the primary admin
    if (employee.isPrimary && req.user.role !== 'super_admin') {
      if (req.body.isActive !== undefined && req.body.isActive !== employee.isActive) {
        return res.status(403).json({ error: 'Cannot disable the primary administrator' });
      }
    }

    const b = req.body;
    const allowed = {};
    if (b.name !== undefined) allowed.name = sanitizeStr(b.name, 100);
    if (b.nameEn !== undefined) allowed.nameEn = sanitizeStr(b.nameEn, 100);
    if (b.username !== undefined) allowed.username = sanitizeStr(b.username, 50);
    if (b.email !== undefined) allowed.email = sanitizeStr(b.email, 100);
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

    // Prevent deleting the primary admin
    if (employee.isPrimary && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Cannot delete the primary administrator' });
    }

    await E.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete employee' }); }
});

// === Admin: Get own restaurant info ===
app.get('/api/restaurant', authMiddleware, async (req, res) => {
  try {
    const { Restaurant: R } = getModels();
    if (!req.user.restaurantId) return res.status(400).json({ error: 'No restaurant' });
    const restaurant = await R.findById(req.user.restaurantId).lean();
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({ id: restaurant._id.toString(), name: restaurant.name, plan: restaurant.plan || 'basic', status: restaurant.status });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch restaurant info' }); }
});

// === Super Admin: Impersonate restaurant admin ===
app.post('/api/admin/restaurant/:id/impersonate', authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const { Restaurant: R, Registration: Reg } = getModels();
    const restaurant = await R.findById(req.params.id).lean();
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

    const reg = await Reg.findOne({ email: restaurant.email, status: 'approved' }).lean();
    if (!reg) return res.status(404).json({ error: 'Registration not found' });

    const token = jwt.sign({
      id: reg._id.toString(),
      email: reg.email,
      name: reg.ownerName,
      restaurantId: restaurant._id.toString(),
      role: 'admin'
    }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      token,
      user: {
        id: reg._id.toString(),
        email: reg.email,
        name: reg.ownerName,
        restaurantId: restaurant._id.toString(),
        role: 'admin'
      }
    });
  } catch (e) {
    console.error('Impersonate error:', e);
    res.status(500).json({ error: 'Failed to impersonate' });
  }
});

app.get('/api/products', authMiddleware, async (req, res) => {
  try {
    const { Product: P } = getModels();
    const filter = {};
    if (req.user.role !== 'super_admin' && req.user.restaurantId) filter.restaurantId = req.user.restaurantId;
    if (req.query.all === 'true' && req.user.role === 'super_admin') delete filter.restaurantId;
    const items = await P.find(filter).sort({ createdAt: -1 }).lean();
    res.json(items.map(i => ({ ...i, id: i._id.toString() })));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch products' }); }
});

app.post('/api/products', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Product: P } = getModels();
    if (!req.user.restaurantId && req.user.role !== 'super_admin') return res.status(403).json({ error: 'No restaurant associated' });
    const b = req.body;
    const item = new P({
      restaurantId: req.user.restaurantId || sanitizeStr(b.restaurantId, 50),
      name: sanitizeStr(b.name, 200),
      nameEn: sanitizeStr(b.nameEn, 200),
      price: typeof b.price === 'number' ? b.price : 0,
      barcode: sanitizeStr(b.barcode, 100),
      categoryId: sanitizeStr(b.categoryId, 50),
      notes: sanitizeStr(b.notes, 500),
      active: typeof b.active === 'boolean' ? b.active : true
    });
    await item.save();
    res.json({ ...item.toObject(), id: item._id.toString() });
  } catch (e) { res.status(500).json({ error: 'Failed to create product' }); }
});

app.put('/api/products/:id', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Product: P } = getModels();
    const item = await P.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Product not found' });
    if (req.user.role !== 'super_admin' && item.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const b = req.body;
    const allowed = {};
    if (b.name !== undefined) allowed.name = sanitizeStr(b.name, 200);
    if (b.nameEn !== undefined) allowed.nameEn = sanitizeStr(b.nameEn, 200);
    if (b.price !== undefined && typeof b.price === 'number') allowed.price = b.price;
    if (b.barcode !== undefined) allowed.barcode = sanitizeStr(b.barcode, 100);
    if (b.categoryId !== undefined) allowed.categoryId = sanitizeStr(b.categoryId, 50);
    if (b.notes !== undefined) allowed.notes = sanitizeStr(b.notes, 500);
    if (b.active !== undefined && typeof b.active === 'boolean') allowed.active = b.active;
    const updated = await P.findByIdAndUpdate(req.params.id, allowed, { new: true });
    res.json({ ...updated.toObject(), id: updated._id.toString() });
  } catch (e) { res.status(500).json({ error: 'Failed to update product' }); }
});

app.delete('/api/products/:id', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Product: P } = getModels();
    const item = await P.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Product not found' });
    if (req.user.role !== 'super_admin' && item.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await P.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete product' }); }
});

app.get('/api/categories', authMiddleware, async (req, res) => {
  try {
    const { Cat: C } = getModels();
    const filter = {};
    if (req.user.role !== 'super_admin' && req.user.restaurantId) filter.restaurantId = req.user.restaurantId;
    if (req.query.all === 'true' && req.user.role === 'super_admin') delete filter.restaurantId;
    const items = await C.find(filter).sort({ sortOrder: 1 }).lean();
    res.json(items.map(i => ({ ...i, id: i._id.toString() })));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch categories' }); }
});

app.post('/api/categories', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Cat: C } = getModels();
    if (!req.user.restaurantId && req.user.role !== 'super_admin') return res.status(403).json({ error: 'No restaurant associated' });
    const b = req.body;
    const item = new C({
      restaurantId: req.user.restaurantId || sanitizeStr(b.restaurantId, 50),
      name: sanitizeStr(b.name, 100),
      sortOrder: typeof b.sortOrder === 'number' ? b.sortOrder : 0
    });
    await item.save();
    res.json({ ...item.toObject(), id: item._id.toString() });
  } catch (e) { res.status(500).json({ error: 'Failed to create category' }); }
});

app.put('/api/categories/:id', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Cat: C } = getModels();
    const item = await C.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Category not found' });
    if (req.user.role !== 'super_admin' && item.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const b = req.body;
    const allowed = {};
    if (b.name !== undefined) allowed.name = sanitizeStr(b.name, 100);
    if (b.sortOrder !== undefined && typeof b.sortOrder === 'number') allowed.sortOrder = b.sortOrder;
    const updated = await C.findByIdAndUpdate(req.params.id, allowed, { new: true });
    res.json({ ...updated.toObject(), id: updated._id.toString() });
  } catch (e) { res.status(500).json({ error: 'Failed to update category' }); }
});

app.delete('/api/categories/:id', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Cat: C } = getModels();
    const item = await C.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Category not found' });
    if (req.user.role !== 'super_admin' && item.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await C.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete category' }); }
});

app.get('/api/tables', authMiddleware, async (req, res) => {
  try {
    const { TableM: T } = getModels();
    const filter = {};
    if (req.user.role !== 'super_admin' && req.user.restaurantId) filter.restaurantId = req.user.restaurantId;
    if (req.query.all === 'true' && req.user.role === 'super_admin') delete filter.restaurantId;
    if (req.query.floorId) filter.floorId = req.query.floorId;
    const items = await T.find(filter).sort({ number: 1 }).lean();
    res.json(items.map(i => ({ ...i, id: i._id.toString() })));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch tables' }); }
});

app.post('/api/tables', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { TableM: T } = getModels();
    if (!req.user.restaurantId && req.user.role !== 'super_admin') return res.status(403).json({ error: 'No restaurant associated' });
    const b = req.body;
    const item = new T({
      restaurantId: req.user.restaurantId || sanitizeStr(b.restaurantId, 50),
      number: typeof b.number === 'number' ? b.number : 1,
      name: sanitizeStr(b.name, 100),
      seats: typeof b.seats === 'number' ? b.seats : 4,
      floorId: sanitizeStr(b.floorId, 50),
      shape: ['round', 'square', 'rectangle', 'pill'].includes(b.shape) ? b.shape : 'square',
      width: typeof b.width === 'number' ? b.width : 0,
      height: typeof b.height === 'number' ? b.height : 0,
      color: typeof b.color === 'string' ? b.color : '',
      status: ['free', 'occupied', 'reserved'].includes(b.status) ? b.status : 'free'
    });
    await item.save();
    res.json({ ...item.toObject(), id: item._id.toString() });
  } catch (e) { res.status(500).json({ error: 'Failed to create table' }); }
});

app.put('/api/tables/:id', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { TableM: T } = getModels();
    const item = await T.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Table not found' });
    if (req.user.role !== 'super_admin' && item.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const b = req.body;
    const allowed = {};
    if (b.number !== undefined && typeof b.number === 'number') allowed.number = b.number;
    if (b.name !== undefined) allowed.name = sanitizeStr(b.name, 100);
    if (b.seats !== undefined && typeof b.seats === 'number') allowed.seats = b.seats;
    if (b.floorId !== undefined) allowed.floorId = sanitizeStr(b.floorId, 50);
    if (b.shape !== undefined && ['round', 'square', 'rectangle', 'pill'].includes(b.shape)) allowed.shape = b.shape;
    if (b.width !== undefined && typeof b.width === 'number') allowed.width = b.width;
    if (b.height !== undefined && typeof b.height === 'number') allowed.height = b.height;
    if (b.color !== undefined) allowed.color = typeof b.color === 'string' ? b.color : '';
    if (b.status !== undefined && ['free', 'occupied', 'reserved'].includes(b.status)) allowed.status = b.status;
    const updated = await T.findByIdAndUpdate(req.params.id, allowed, { new: true });
    res.json({ ...updated.toObject(), id: updated._id.toString() });
  } catch (e) { res.status(500).json({ error: 'Failed to update table' }); }
});

app.delete('/api/tables/:id', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { TableM: T } = getModels();
    const item = await T.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Table not found' });
    if (req.user.role !== 'super_admin' && item.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await T.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete table' }); }
});

app.get('/api/floors', authMiddleware, async (req, res) => {
  try {
    const { Floor: F } = getModels();
    const filter = {};
    if (req.user.role !== 'super_admin' && req.user.restaurantId) filter.restaurantId = req.user.restaurantId;
    if (req.query.all === 'true' && req.user.role === 'super_admin') delete filter.restaurantId;
    const items = await F.find(filter).sort({ sortOrder: 1 }).lean();
    res.json(items.map(i => ({ ...i, id: i._id.toString() })));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch floors' }); }
});

app.post('/api/floors', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Floor: F } = getModels();
    if (!req.user.restaurantId && req.user.role !== 'super_admin') return res.status(403).json({ error: 'No restaurant associated' });
    const b = req.body;
    const item = new F({
      restaurantId: req.user.restaurantId || sanitizeStr(b.restaurantId, 50),
      name: sanitizeStr(b.name, 100),
      color: typeof b.color === 'string' ? b.color : '',
      sortOrder: typeof b.sortOrder === 'number' ? b.sortOrder : 0
    });
    await item.save();
    res.json({ ...item.toObject(), id: item._id.toString() });
  } catch (e) { res.status(500).json({ error: 'Failed to create floor' }); }
});

app.put('/api/floors/:id', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Floor: F } = getModels();
    const item = await F.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Floor not found' });
    if (req.user.role !== 'super_admin' && item.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const b = req.body;
    const allowed = {};
    if (b.name !== undefined) allowed.name = sanitizeStr(b.name, 100);
    if (b.color !== undefined) allowed.color = typeof b.color === 'string' ? b.color : '';
    if (b.sortOrder !== undefined && typeof b.sortOrder === 'number') allowed.sortOrder = b.sortOrder;
    const updated = await F.findByIdAndUpdate(req.params.id, allowed, { new: true });
    res.json({ ...updated.toObject(), id: updated._id.toString() });
  } catch (e) { res.status(500).json({ error: 'Failed to update floor' }); }
});

app.delete('/api/floors/:id', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Floor: F } = getModels();
    const item = await F.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Floor not found' });
    if (req.user.role !== 'super_admin' && item.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await F.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete floor' }); }
});

app.get('/api/attendance/today', authMiddleware, async (req, res) => {
  try {
    const { Attendance: A } = getModels();
    const today = new Date().toISOString().split('T')[0];
    const filter = { date: today };
    if (req.user.role !== 'super_admin' && req.user.restaurantId) filter.restaurantId = req.user.restaurantId;
    if (req.user.role !== 'super_admin') filter.employeeId = req.user.id;
    const items = await A.find(filter).sort({ clockIn: -1 }).lean();
    res.json(items.map(i => ({ ...i, id: i._id.toString() })));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch today attendance' }); }
});

app.get('/api/attendance', authMiddleware, async (req, res) => {
  try {
    const { Attendance: A } = getModels();
    const filter = {};
    if (req.user.role !== 'super_admin' && req.user.restaurantId) filter.restaurantId = req.user.restaurantId;
    if (req.query.all === 'true' && req.user.role === 'super_admin') delete filter.restaurantId;
    if (req.query.employeeId) filter.employeeId = req.query.employeeId;
    if (req.query.date) filter.date = req.query.date;
    const items = await A.find(filter).sort({ clockIn: -1 }).lean();
    res.json(items.map(i => ({ ...i, id: i._id.toString() })));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch attendance' }); }
});

app.post('/api/attendance/clock-in', authMiddleware, async (req, res) => {
  try {
    const { Attendance: A } = getModels();
    if (!req.user.restaurantId && req.user.role !== 'super_admin') return res.status(403).json({ error: 'No restaurant associated' });
    const today = new Date().toISOString().split('T')[0];
    const item = new A({
      restaurantId: req.user.restaurantId || '',
      employeeId: req.user.id,
      employeeName: sanitizeStr(req.user.name, 100),
      clockIn: new Date(),
      date: today
    });
    await item.save();
    res.json({ ...item.toObject(), id: item._id.toString() });
  } catch (e) { res.status(500).json({ error: 'Failed to clock in' }); }
});

app.put('/api/attendance/:id/clock-out', authMiddleware, async (req, res) => {
  try {
    const { Attendance: A } = getModels();
    const item = await A.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Attendance record not found' });
    if (req.user.role !== 'super_admin' && item.employeeId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (item.clockOut) return res.status(400).json({ error: 'Already clocked out' });
    item.clockOut = new Date();
    await item.save();
    res.json({ ...item.toObject(), id: item._id.toString() });
  } catch (e) { res.status(500).json({ error: 'Failed to clock out' }); }
});

// === Settings (per-restaurant) ===
app.get('/api/settings', authMiddleware, async (req, res) => {
  try {
    const { Setting: S } = getModels();
    const filter = {};
    if (req.user.role !== 'super_admin' && req.user.restaurantId) filter.restaurantId = req.user.restaurantId;
    else if (req.user.role !== 'super_admin') return res.json([]);
    const items = await S.find(filter).lean();
    res.json(items.map(i => ({ id: i._id.toString(), key: i.key, value: i.value })));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch settings' }); }
});

app.put('/api/settings', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Setting: S } = getModels();
    const rid = req.user.restaurantId;
    if (!rid) return res.status(403).json({ error: 'No restaurant' });
    const entries = Array.isArray(req.body) ? req.body : [];
    const ops = entries.map(e => {
      return S.findOneAndUpdate({ restaurantId: rid, key: e.key }, { restaurantId: rid, key: e.key, value: e.value }, { upsert: true, new: true });
    });
    await Promise.all(ops);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to save settings' }); }
});

// === Customers ===
app.get('/api/customers', authMiddleware, async (req, res) => {
  try {
    const { Customer: C, Order: O } = getModels();
    const filter = {};
    if (req.user.restaurantId) filter.restaurantId = req.user.restaurantId;
    if (req.query.search) {
      const q = sanitizeStr(req.query.search, 100);
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } }
      ];
    }
    const customers = await C.find(filter).sort({ createdAt: -1 }).lean();

    const orderFilter = {};
    if (req.user.restaurantId) orderFilter.restaurantId = req.user.restaurantId;
    const orders = await O.find(orderFilter).lean();
    const statsMap = {};
    for (const order of orders) {
      if (!order.cid) continue;
      if (!statsMap[order.cid]) statsMap[order.cid] = { orderCount: 0, totalSpent: 0, lastVisit: null };
      statsMap[order.cid].orderCount++;
      statsMap[order.cid].totalSpent += order.tot || 0;
      const oDate = new Date(order.createdAt);
      if (!statsMap[order.cid].lastVisit || oDate > statsMap[order.cid].lastVisit) {
        statsMap[order.cid].lastVisit = oDate;
      }
    }

    res.json(customers.map(c => ({
      id: c._id?.toString() || c.id,
      restaurantId: c.restaurantId,
      name: c.name,
      phone: c.phone,
      notes: c.notes,
      createdAt: c.createdAt,
      orderCount: (statsMap[c._id?.toString()] || {}).orderCount || 0,
      totalSpent: (statsMap[c._id?.toString()] || {}).totalSpent || 0,
      lastVisit: (statsMap[c._id?.toString()] || {}).lastVisit || null
    })));
  } catch (e) { res.status(500).json({ error: 'Failed to fetch customers' }); }
});

app.get('/api/customers/:id', authMiddleware, async (req, res) => {
  try {
    const { Customer: C, Order: O } = getModels();
    const customer = await C.findById(req.params.id).lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (customer.restaurantId !== req.user.restaurantId && req.user.role !== 'super_admin') return res.status(403).json({ error: 'Access denied' });

    const orderFilter = { cid: req.params.id };
    if (req.user.restaurantId) orderFilter.restaurantId = req.user.restaurantId;
    const orders = await O.find(orderFilter).sort({ createdAt: -1 }).limit(100).lean();

    let totalSpent = 0;
    orders.forEach(o => { totalSpent += o.tot || 0; });

    res.json({
      id: customer._id?.toString() || customer.id,
      restaurantId: customer.restaurantId,
      name: customer.name,
      phone: customer.phone,
      notes: customer.notes,
      createdAt: customer.createdAt,
      orderCount: orders.length,
      totalSpent: totalSpent,
      lastVisit: orders.length > 0 ? orders[0].createdAt : null,
      orders: orders.map(o => ({
        id: o._id?.toString() || o.id,
        total: o.tot,
        items: (o.items || []).map(i => ({
          productId: i.p, name: i.p, price: i.pr, quantity: i.q, subtotal: (i.pr || 0) * (i.q || 1)
        })),
        status: 'paid',
        createdAt: o.createdAt
      }))
    });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch customer' }); }
});

app.post('/api/customers', authMiddleware, async (req, res) => {
  try {
    const { Customer: C } = getModels();
    if (!req.user.restaurantId) return res.status(403).json({ error: 'No restaurant associated' });
    const b = req.body;
    const name = sanitizeStr(b.name, 100);
    if (!name) return res.status(400).json({ error: 'Customer name is required' });

    const customer = new C({
      restaurantId: req.user.restaurantId,
      name: name,
      phone: sanitizeStr(b.phone, 30),
      notes: sanitizeStr(b.notes, 500)
    });
    await customer.save();
    res.json({ id: customer._id.toString(), name: customer.name, phone: customer.phone, notes: customer.notes, createdAt: customer.createdAt });
  } catch (e) { res.status(500).json({ error: 'Failed to create customer' }); }
});

app.put('/api/customers/:id', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Customer: C } = getModels();
    const customer = await C.findById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (req.user.role !== 'super_admin' && customer.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const b = req.body;
    const allowed = {};
    if (b.name !== undefined) allowed.name = sanitizeStr(b.name, 100);
    if (b.phone !== undefined) allowed.phone = sanitizeStr(b.phone, 30);
    if (b.notes !== undefined) allowed.notes = sanitizeStr(b.notes, 500);
    if (!allowed.name && allowed.name !== '') delete allowed.name;

    const updated = await C.findByIdAndUpdate(req.params.id, allowed, { new: true });
    res.json({ id: updated._id.toString(), name: updated.name, phone: updated.phone, notes: updated.notes, createdAt: updated.createdAt });
  } catch (e) { res.status(500).json({ error: 'Failed to update customer' }); }
});

app.delete('/api/customers/:id', authMiddleware, adminOrAbove, async (req, res) => {
  try {
    const { Customer: C } = getModels();
    const customer = await C.findById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if (req.user.role !== 'super_admin' && customer.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await C.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete customer' }); }
});

module.exports = app;
