const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const cors = require('cors');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Helper: ensure folders and files
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function ensureFile(p, defaultContent = '{}') {
  if (!fs.existsSync(p)) fs.writeFileSync(p, defaultContent);
}

// initialize storage
ensureDir(DATA_DIR);
ensureDir(UPLOADS_DIR);
ensureDir(path.join(DATA_DIR, 'sessions'));

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ZIPS_FILE = path.join(DATA_DIR, 'zips.json');

ensureFile(USERS_FILE, JSON.stringify({} , null, 2));
ensureFile(ZIPS_FILE, JSON.stringify([], null, 2));

// create default admin user if missing
const usersRaw = fs.readFileSync(USERS_FILE, 'utf8');
let users = {};
try { users = JSON.parse(usersRaw || '{}'); } catch(e) { users = {}; }
if (!users['admin']) {
  const pass = 'JamesTech123'; // change after first run if desired
  const hash = bcrypt.hashSync(pass, 10);
  users['admin'] = { username: 'admin', passwordHash: hash, name: 'James (Admin)'};
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  console.log('Default admin created -> username: admin  password: JamesTech123');
}

// express app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// session
app.use(session({
  store: new FileStore({ path: path.join(DATA_DIR, 'sessions') }),
  secret: 'ziphub-secret-no-env',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
}));

// auth middleware
function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// multer for zip uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const id = uuidv4();
    const name = id + path.extname(file.originalname).toLowerCase();
    cb(null, name);
  }
});

function zipFileFilter(req, file, cb) {
  const allowedExt = ['.zip'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExt.includes(ext)) return cb(new Error('Only .zip allowed'));
  // basic mime check
  if (!file.mimetype.includes('zip') && file.mimetype !== 'application/octet-stream') {
    // allow octet-stream because some zips come as that
    // we won't reject strictly here; extension check is authoritative
  }
  cb(null, true);
}

const upload = multer({ storage, fileFilter: zipFileFilter, limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB

// Routes
app.get('/', (req, res) => res.redirect('/public/index.html'));

// login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const raw = fs.readFileSync(USERS_FILE, 'utf8');
  const u = JSON.parse(raw || '{}');
  if (!u[username]) return res.status(401).json({ error: 'invalid' });
  const ok = bcrypt.compareSync(password, u[username].passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid' });
  req.session.user = { username: u[username].username, name: u[username].name };
  res.json({ ok: true, user: req.session.user });
});

app.post('/api/logout', requireLogin, (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'logout' });
    res.json({ ok: true });
  });
});

// Upload zip (only .zip). All uploads require login
app.post('/api/upload', requireLogin, upload.single('zipfile'), (req, res) => {
  try {
    const meta = req.body || {};
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'no file' });
    const zips = JSON.parse(fs.readFileSync(ZIPS_FILE, 'utf8') || '[]');
    const entry = {
      id: path.parse(file.filename).name,
      filename: file.filename,
      originalname: file.originalname,
      creatorName: meta.creatorName || 'Unknown',
      channel: meta.channel || '',
      repo: meta.repo || '',
      moreDetails: meta.moreDetails || '',
      description: meta.description || '',
      size: file.size,
      uploadedBy: req.session.user.username,
      createdAt: new Date().toISOString()
    };
    zips.unshift(entry);
    fs.writeFileSync(ZIPS_FILE, JSON.stringify(zips, null, 2));
    res.json({ ok: true, entry });
  } catch (e) {
    console.error('Upload error', e);
    res.status(500).json({ error: 'server' });
  }
});

// list zips (protected)
app.get('/api/zips', requireLogin, (req, res) => {
  const zips = JSON.parse(fs.readFileSync(ZIPS_FILE, 'utf8') || '[]');
  res.json({ ok: true, zips });
});

// download
app.get('/api/download/:id', requireLogin, (req, res) => {
  const id = req.params.id;
  const zips = JSON.parse(fs.readFileSync(ZIPS_FILE, 'utf8') || '[]');
  const found = zips.find(z => z.id === id);
  if (!found) return res.status(404).json({ error: 'not found' });
  const filePath = path.join(UPLOADS_DIR, found.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file missing' });
  res.download(filePath, found.originalname);
});

// admin-only endpoint (example): delete
app.post('/api/delete/:id', requireLogin, (req, res) => {
  // basic admin check: only 'admin' user can delete
  if (!req.session.user || req.session.user.username !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const id = req.params.id;
  let zips = JSON.parse(fs.readFileSync(ZIPS_FILE, 'utf8') || '[]');
  const idx = zips.findIndex(z => z.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const [removed] = zips.splice(idx, 1);
  fs.writeFileSync(ZIPS_FILE, JSON.stringify(zips, null, 2));
  const filePath = path.join(UPLOADS_DIR, removed.filename);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(e){ console.error('unlink', e); }
  res.json({ ok: true });
});

// ping endpoint
app.get('/ping', (req, res) => {
  console.log(new Date().toISOString(), 'Received /ping');
  res.json({ ok: true, ts: new Date().toISOString() });
});

// server listen
const server = app.listen(PORT, () => {
  console.log(`ZipHub server listening on http://localhost:${PORT}`);
  console.log('Data files: ', USERS_FILE, ZIPS_FILE);
});

// PingBot: internal periodic ping every 5 seconds to local /ping
function startPingBot() {
  setInterval(() => {
    const options = { host: '127.0.0.1', port: PORT, path: '/ping', method: 'GET' };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const ts = new Date().toISOString();
        console.log(`${ts} - PingBot: alive (status ${res.statusCode})`);
      });
    });
    req.on('error', err => {
      const ts = new Date().toISOString();
      console.error(`${ts} - PingBot ERROR:`, err.message);
    });
    req.end();
  }, 5000); // 5s
}

startPingBot();

// graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});