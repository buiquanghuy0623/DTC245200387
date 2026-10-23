const express = require('express');
const helmet = require('helmet');
const mysql = require('mysql2/promise');
const client = require('prom-client');
const pino = require('pino');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);

const logDir = path.dirname(process.env.LOG_FILE || '/app/logs/app.log');
fs.mkdirSync(logDir, { recursive: true });
const logger = pino({
  base: { service: 'gym-app' },
  timestamp: pino.stdTimeFunctions.isoTime
}, pino.destination(process.env.LOG_FILE || '/app/logs/app.log'));

const adminUsername = process.env.GYM_ADMIN_USERNAME;
const adminPassword = process.env.GYM_ADMIN_PASSWORD;
const sessionSecret = process.env.GYM_SESSION_SECRET;
if (!adminUsername || !adminPassword || !sessionSecret || sessionSecret.length < 32) {
  throw new Error('Configure GYM_ADMIN_USERNAME, GYM_ADMIN_PASSWORD, and a GYM_SESSION_SECRET of at least 32 characters.');
}
const sessionCookie = 'gymfit_session';
const sessionDurationMs = 8 * 60 * 60 * 1000;
const expectedUsername = crypto.createHash('sha256').update(adminUsername).digest();
const expectedPassword = crypto.createHash('sha256').update(adminPassword).digest();

function digest(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function safeEqual(value, expected) {
  return crypto.timingSafeEqual(digest(value), expected);
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function readSession(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${sessionCookie}=`));
  if (!cookie) return null;

  const token = cookie.slice(sessionCookie.length + 1);
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra !== undefined) return null;

  const expectedSignature = crypto.createHmac('sha256', sessionSecret).update(encoded).digest();
  let actualSignature;
  try {
    actualSignature = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (actualSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(actualSignature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (payload.username !== adminUsername || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    secure: req.secure || req.get('x-forwarded-proto') === 'https',
    sameSite: 'strict',
    path: '/',
    maxAge: sessionDurationMs
  };
}

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'gym_' });
const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [registry]
});
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry]
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route?.path || req.path || 'unknown';
    httpRequests.inc({ method: req.method, route, status: String(res.statusCode) });
    httpDuration.observe({ method: req.method, route, status: String(res.statusCode) }, seconds);
    logger.info({ method: req.method, path: req.originalUrl, route, status: res.statusCode, duration_ms: Math.round(seconds * 1000) }, 'request');
  });
  next();
});

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'gymuser',
  password: process.env.DB_PASSWORD || 'change_me_gym',
  database: process.env.DB_NAME || 'gymdb',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

const fields = {
  members: ['full_name','phone','email','gender','package_id','start_date','end_date','profile_photo','status'],
  trainers: ['full_name','gender','specialty','phone','email','profile_photo','status'],
  packages: ['name','duration_months','price','status','description'],
  schedules: ['title','class_type','schedule_date','start_time','end_time','room','trainer_id','max_members']
};

function clean(value) {
  if (value === undefined || value === '') return null;
  return value;
}

function validate(table, body) {
  const errors = [];
  if (table === 'members' && (!body.full_name || !body.phone)) errors.push('Họ tên và số điện thoại là bắt buộc.');
  if (table === 'trainers' && (!body.full_name || !body.specialty)) errors.push('Họ tên và chuyên môn là bắt buộc.');
  if ((table === 'members' || table === 'trainers') && body.profile_photo != null) {
    const match = typeof body.profile_photo === 'string'
      && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.profile_photo);
    if (!match || body.profile_photo.length > 1_400_000) {
      errors.push('Ảnh phải là PNG, JPG hoặc WEBP và không vượt quá 1 MB.');
    } else {
      const photo = Buffer.from(match[2], 'base64');
      const isPng = match[1] === 'png' && photo.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const isJpeg = match[1] === 'jpeg' && photo.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
      const isWebp = match[1] === 'webp' && photo.toString('ascii', 0, 4) === 'RIFF' && photo.toString('ascii', 8, 12) === 'WEBP';
      if (photo.length > 1024 * 1024 || (!isPng && !isJpeg && !isWebp)) {
        errors.push('Ảnh không hợp lệ hoặc vượt quá 1 MB.');
      }
    }
  }
  if (table === 'packages' && (!body.name || Number(body.duration_months) <= 0 || Number(body.price) < 0)) errors.push('Tên gói, thời hạn và giá phải hợp lệ.');
  if (table === 'packages' && body.status != null && !['Đang bán','Dừng bán'].includes(body.status)) errors.push('Trạng thái gói tập không hợp lệ.');
  if (table === 'schedules' && (!body.title || !body.class_type || !body.schedule_date || !body.start_time || !body.end_time)) errors.push('Tên lớp, loại lớp, ngày và thời gian là bắt buộc.');
  return errors;
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'gym-app', database: 'connected' });
  } catch (error) {
    logger.error({ err: error }, 'health check failed');
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
});

if (process.env.ENABLE_TEST_ERROR_ENDPOINT === 'true') {
  httpRequests.labels({
    method: 'GET',
    route: '/__test__/http-500',
    status: '500'
  }).inc(0);

  const respondWithTestError = (req, res) => {
    res.status(500).json({ message: 'Có lỗi hệ thống, vui lòng thử lại sau.' });
  };
  app.get('/__test/error', respondWithTestError);
  app.get('/__test__/http-500', respondWithTestError);
}

app.get('/api/auth/session', (req, res) => {
  const session = readSession(req);
  res.json(session
    ? { authenticated: true, username: session.username }
    : { authenticated: false });
});

app.post('/api/auth/login', (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const validUsername = safeEqual(username, expectedUsername);
  const validPassword = safeEqual(password, expectedPassword);
  if (!validUsername || !validPassword) {
    return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
  }

  const expiresAt = Date.now() + sessionDurationMs;
  const token = signSession({ username: adminUsername, expiresAt });
  res.cookie(sessionCookie, token, cookieOptions(req));
  res.json({ authenticated: true, username: adminUsername });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(sessionCookie, cookieOptions(req));
  res.json({ authenticated: false });
});

app.use('/api', (req, res, next) => {
  if (!readSession(req)) return res.status(401).json({ message: 'Vui lòng đăng nhập để tiếp tục.' });
  next();
});

app.get('/api/dashboard', async (req, res, next) => {
  try {
    const [[members]] = await pool.query("SELECT COUNT(*) AS total, SUM(status='Hoạt động') AS active, SUM(status='Hết hạn') AS expired FROM members");
    const [[trainers]] = await pool.query("SELECT COUNT(*) AS total FROM trainers");
    const [[packages]] = await pool.query("SELECT COUNT(*) AS total FROM packages");
    const [[schedules]] = await pool.query("SELECT COUNT(*) AS total FROM schedules WHERE schedule_date >= CURDATE()");
    res.json({ members, trainers, packages, schedules });
  } catch (err) { next(err); }
});

app.get('/api/members', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT m.*, p.name AS package_name
      FROM members m LEFT JOIN packages p ON p.id = m.package_id
      ORDER BY m.id DESC`);
    res.json(rows);
  } catch (err) { next(err); }
});

app.get('/api/trainers', async (req, res, next) => {
  try { const [rows] = await pool.query('SELECT * FROM trainers ORDER BY id DESC'); res.json(rows); } catch (err) { next(err); }
});

app.get('/api/packages', async (req, res, next) => {
  try { const [rows] = await pool.query('SELECT * FROM packages ORDER BY id DESC'); res.json(rows); } catch (err) { next(err); }
});

app.get('/api/schedules', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*, t.full_name AS trainer_name
      FROM schedules s LEFT JOIN trainers t ON t.id = s.trainer_id
      ORDER BY s.schedule_date ASC, s.start_time ASC`);
    res.json(rows);
  } catch (err) { next(err); }
});

for (const table of Object.keys(fields)) {
  app.post(`/api/${table}`, async (req, res, next) => {
    try {
      const errors = validate(table, req.body);
      if (errors.length) return res.status(400).json({ message: errors.join(' ') });
      const cols = fields[table];
      const values = cols.map(c => clean(req.body[c]));
      const placeholders = cols.map(() => '?').join(',');
      const [result] = await pool.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`, values);
      res.status(201).json({ id: result.insertId, message: 'Đã thêm dữ liệu.' });
    } catch (err) { next(err); }
  });

  app.put(`/api/${table}/:id`, async (req, res, next) => {
    try {
      const errors = validate(table, req.body);
      if (errors.length) return res.status(400).json({ message: errors.join(' ') });
      const cols = fields[table];
      const values = cols.map(c => clean(req.body[c]));
      const setSql = cols.map(c => `${c}=?`).join(', ');
      values.push(req.params.id);
      const [result] = await pool.query(`UPDATE ${table} SET ${setSql} WHERE id=?`, values);
      if (!result.affectedRows) return res.status(404).json({ message: 'Không tìm thấy dữ liệu.' });
      res.json({ message: 'Đã cập nhật dữ liệu.' });
    } catch (err) { next(err); }
  });

  app.delete(`/api/${table}/:id`, async (req, res, next) => {
    try {
      const [result] = await pool.query(`DELETE FROM ${table} WHERE id=?`, [req.params.id]);
      if (!result.affectedRows) return res.status(404).json({ message: 'Không tìm thấy dữ liệu.' });
      res.json({ message: 'Đã xóa dữ liệu.' });
    } catch (err) { next(err); }
  });
}

app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', extensions: ['html'] }));

app.use((err, req, res, next) => {
  logger.error({ err, method: req.method, path: req.originalUrl }, 'unhandled error');
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  const message = status === 413
    ? 'Ảnh tải lên vượt quá dung lượng cho phép.'
    : status === 400
      ? 'Dữ liệu gửi lên không hợp lệ.'
      : 'Lỗi máy chủ. Kiểm tra log của ứng dụng.';
  res.status(status).json({ message });
});

async function startServer() {
  try {
    for (const table of ['trainers', 'members']) {
      const [columns] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE 'profile_photo'`);
      if (!columns.length) {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN profile_photo MEDIUMTEXT NULL`);
      }
    }
    const [packageColumns] = await pool.query("SHOW COLUMNS FROM packages LIKE 'status'");
    if (!packageColumns.length) {
      await pool.query("ALTER TABLE packages ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'Đang bán'");
    }
    const [trainerGenderColumns] = await pool.query("SHOW COLUMNS FROM trainers LIKE 'gender'");
    if (!trainerGenderColumns.length) {
      await pool.query('ALTER TABLE trainers ADD COLUMN gender VARCHAR(20) NULL');
    }
    app.listen(PORT, '0.0.0.0', () => {
      logger.info({ port: PORT }, 'Gym/Fitness application started');
    });
  } catch (error) {
    logger.fatal({ err: error }, 'application startup failed');
    await pool.end();
    process.exitCode = 1;
  }
}

startServer();
