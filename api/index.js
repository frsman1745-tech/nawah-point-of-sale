const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'nawa-pos-secret-key';

// Connect to MongoDB
mongoose.connect(MONGODB_URI).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// === Models ===
// Restaurant Schema
const restaurantSchema = new mongoose.Schema({
  name: String,
  owner: String,
  phone: String,
  email: String,
  plan: { type: String, enum: ['basic', 'medium', 'advanced'], default: 'basic' },
  status: { type: String, enum: ['active', 'suspended', 'inactive'], default: 'active' },
  password: String,
  startDate: Date,
  endDate: Date,
  revenue: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// Order Schema
const orderSchema = new mongoose.Schema({
  restaurantId: mongoose.Schema.Types.ObjectId,
  tableId: String,
  employeeId: String,
  employeeName: String,
  items: [{ productId: String, name: String, price: Number, quantity: Number }],
  subtotal: Number,
  tax: Number,
  total: Number,
  status: { type: String, default: 'paid' },
  paymentMethod: { type: String, default: 'cash' },
  paidAt: Date,
  createdAt: { type: Date, default: Date.now }
});

// Audit Log Schema (append-only)
const auditLogSchema = new mongoose.Schema({
  restaurantId: mongoose.Schema.Types.ObjectId,
  userId: String,
  userName: String,
  action: String,
  store: String,
  recordId: String,
  data: mongoose.Schema.Types.Mixed,
  hash: String,
  previousHash: String,
  timestamp: { type: Date, default: Date.now }
});
// NO UPDATE OR DELETE METHODS - append only

// Employee Schema
const employeeSchema = new mongoose.Schema({
  restaurantId: mongoose.Schema.Types.ObjectId,
  name: String,
  username: String,
  password: String,
  role: { type: String, enum: ['admin', 'cashier'], default: 'cashier' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const Restaurant = mongoose.model('Restaurant', restaurantSchema);
const Order = mongoose.model('Order', orderSchema);
const AuditLog = mongoose.model('AuditLog', auditLogSchema);
const Employee = mongoose.model('Employee', employeeSchema);

// === Auth Middleware ===
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

// === Routes ===

// Auth
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  // Check super admin
  if (username === 'superadmin' && password === process.env.SEED_KEY) {
    const token = jwt.sign({ role: 'super_admin', name: 'مدير النظام' }, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ token, user: { role: 'super_admin', name: 'مدير النظام' } });
  }
  // Check restaurant admin/cashier
  const employee = await Employee.findOne({ username, password });
  if (!employee) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({
    id: employee._id,
    restaurantId: employee.restaurantId,
    role: employee.role,
    name: employee.name
  }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { id: employee._id, role: employee.role, name: employee.name } });
});

// Super Admin - Restaurants
app.get('/api/restaurants', authMiddleware, adminOnly, async (req, res) => {
  const restaurants = await Restaurant.find().sort({ createdAt: -1 });
  res.json(restaurants);
});

app.post('/api/restaurants', authMiddleware, adminOnly, async (req, res) => {
  const restaurant = new Restaurant(req.body);
  await restaurant.save();
  res.json(restaurant);
});

app.put('/api/restaurants/:id', authMiddleware, adminOnly, async (req, res) => {
  const restaurant = await Restaurant.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(restaurant);
});

// Super Admin - Weekly Sales Reports
app.get('/api/reports/weekly', authMiddleware, adminOnly, async (req, res) => {
  const { weeks = 1 } = req.query;
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - (parseInt(weeks) * 7));

  const orders = await Order.find({ createdAt: { $gte: startDate, $lte: now } });

  const dailySales = {};
  const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().split('T')[0];
    dailySales[key] = { date: key, dayName: dayNames[d.getDay()], total: 0, count: 0 };
  }

  orders.forEach(order => {
    const key = order.createdAt.toISOString().split('T')[0];
    if (dailySales[key]) {
      dailySales[key].total += order.total || 0;
      dailySales[key].count += 1;
    }
  });

  const totalSales = orders.reduce((sum, o) => sum + (o.total || 0), 0);
  const totalOrders = orders.length;
  const avgOrder = totalOrders > 0 ? totalSales / totalOrders : 0;

  // Top products
  const productSales = {};
  orders.forEach(order => {
    (order.items || []).forEach(item => {
      if (!productSales[item.name]) productSales[item.name] = { name: item.name, quantity: 0, total: 0 };
      productSales[item.name].quantity += item.quantity;
      productSales[item.name].total += item.price * item.quantity;
    });
  });
  const topProducts = Object.values(productSales).sort((a, b) => b.total - a.total).slice(0, 10);

  // Per restaurant breakdown
  const restaurantSales = {};
  orders.forEach(order => {
    const rid = order.restaurantId?.toString() || 'unknown';
    if (!restaurantSales[rid]) restaurantSales[rid] = { restaurantId: rid, total: 0, count: 0 };
    restaurantSales[rid].total += order.total || 0;
    restaurantSales[rid].count += 1;
  });

  res.json({
    period: { from: startDate, to: now, weeks: parseInt(weeks) },
    summary: { totalSales, totalOrders, avgOrder: Math.round(avgOrder) },
    dailySales: Object.values(dailySales),
    topProducts,
    restaurantSales: Object.values(restaurantSales)
  });
});

// Super Admin - All orders for reports
app.get('/api/orders/all', authMiddleware, adminOnly, async (req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 }).limit(500);
  res.json(orders);
});

// Admin - Restaurant orders
app.get('/api/orders', authMiddleware, async (req, res) => {
  const orders = await Order.find({ restaurantId: req.user.restaurantId }).sort({ createdAt: -1 }).limit(100);
  res.json(orders);
});

app.post('/api/orders', authMiddleware, async (req, res) => {
  const order = new Order({ ...req.body, restaurantId: req.user.restaurantId });
  await order.save();
  res.json(order);
});

// Audit Log (append-only)
app.get('/api/audit', authMiddleware, async (req, res) => {
  const logs = await AuditLog.find({ restaurantId: req.user.restaurantId }).sort({ timestamp: -1 }).limit(200);
  res.json(logs);
});

app.post('/api/audit', authMiddleware, async (req, res) => {
  const log = new AuditLog({ ...req.body, restaurantId: req.user.restaurantId });
  await log.save();
  res.json(log);
});

// Verify audit integrity
app.get('/api/audit/verify', authMiddleware, async (req, res) => {
  const logs = await AuditLog.find({ restaurantId: req.user.restaurantId }).sort({ timestamp: 1 });
  let valid = true;
  for (let i = 1; i < logs.length; i++) {
    if (logs[i].previousHash !== logs[i-1].hash) {
      valid = false;
      break;
    }
  }
  res.json({ valid, totalEntries: logs.length });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

module.exports = app;
