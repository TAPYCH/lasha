'use strict';

const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { getDb } = require('./db');
const { createAuthRouter } = require('./routes/auth');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const TOURS_FILE = path.join(DATA_DIR, 'tours.json');
const HOTELS_FILE = path.join(DATA_DIR, 'hotels.json');
const EXTRACT_SCRIPT = path.join(ROOT, 'scripts', 'extract-seed.js');

const PORT = Number(process.env.PORT) || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'apsny-dev-secret-change-in-production';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/ogg',
]);

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

async function ensureSeedData() {
  let need = false;
  try {
    await fs.access(TOURS_FILE);
  } catch {
    need = true;
  }
  try {
    await fs.access(HOTELS_FILE);
  } catch {
    need = true;
  }
  if (!need) return;

  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [EXTRACT_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error('Не удалось создать начальные данные (extract-seed.js)');
  }
  console.log(r.stdout?.trim());
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

function extractUploadFilenames(obj) {
  const names = new Set();
  const json = JSON.stringify(obj);
  const re = /\/uploads\/([^"'\s]+)/g;
  let m;
  while ((m = re.exec(json))) {
    names.add(m[1]);
  }
  return names;
}

function collectUserUploadRefs(db) {
  const names = new Set();
  try {
    const rows = db.prepare('SELECT passport_url, selfie_url, avatar_url FROM users').all();
    rows.forEach((r) => {
      [r.passport_url, r.selfie_url, r.avatar_url].forEach((u) => {
        if (!u || typeof u !== 'string') return;
        const m = u.match(/^\/uploads\/([^/?#]+)/);
        if (m) names.add(m[1]);
      });
    });
  } catch (_) {}
  return names;
}

async function cleanupUploads(tours, hotels, db) {
  const used = new Set();
  extractUploadFilenames(tours).forEach((x) => used.add(x));
  extractUploadFilenames(hotels).forEach((x) => used.add(x));
  if (db) {
    collectUserUploadRefs(db).forEach((x) => used.add(x));
  }

  let list = [];
  try {
    list = await fs.readdir(UPLOADS_DIR);
  } catch {
    return;
  }

  await Promise.all(
    list.map(async (name) => {
      if (!used.has(name)) {
        await fs.unlink(path.join(UPLOADS_DIR, name)).catch(() => {});
      }
    }),
  );
}

function validateTours(arr) {
  if (!Array.isArray(arr)) return false;
  return arr.every(
    (t) =>
      t &&
      typeof t.id === 'string' &&
      typeof t.title === 'string' &&
      typeof t.mainMedia === 'string' &&
      Array.isArray(t.attractions),
  );
}

function normalizeHotelBody(h) {
  let gallery = h.gallery;
  if (!Array.isArray(gallery) || gallery.length === 0) {
    if (Array.isArray(h.images) && h.images.length) {
      gallery = h.images.map((media) => ({ media, isVideo: false }));
    } else {
      gallery = [];
    }
  }
  const { images, ...rest } = h;
  return { ...rest, gallery };
}

function validateHotels(arr) {
  if (!Array.isArray(arr)) return false;
  return arr.every(
    (h) =>
      h &&
      typeof h.id === 'string' &&
      typeof h.title === 'string' &&
      Array.isArray(h.rooms) &&
      h.rooms.length > 0,
  );
}

async function main() {
  await ensureDirs();
  await ensureSeedData();

  const db = getDb();

  const app = express();
  app.set('trust proxy', 1);
  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '12mb' }));

  const cookieBase = {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  };

  const storage = multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt =
        ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov', '.ogg'].includes(ext)
          ? ext
          : '';
      cb(null, `${crypto.randomUUID()}${safeExt}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 80 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ok =
        ALLOWED_MIME.has(file.mimetype) ||
        file.mimetype.startsWith('image/') ||
        file.mimetype.startsWith('video/');
      cb(ok ? null : new Error('Недопустимый тип файла'), ok);
    },
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'apsny-guide', time: new Date().toISOString() });
  });

  app.get('/api/tours', async (req, res) => {
    const tours = await readJson(TOURS_FILE, []);
    res.json(tours);
  });

  app.put('/api/tours', async (req, res) => {
    const body = req.body;
    if (!validateTours(body)) {
      return res.status(400).json({ error: 'Ожидался массив экскурсий с полями id, title, mainMedia, attractions' });
    }
    await writeJson(TOURS_FILE, body);
    const hotels = await readJson(HOTELS_FILE, []);
    await cleanupUploads(body, hotels, db);
    res.json({ ok: true });
  });

  app.get('/api/hotels', async (req, res) => {
    const hotels = await readJson(HOTELS_FILE, []);
    res.json(hotels);
  });

  app.put('/api/hotels', async (req, res) => {
    const body = req.body.map(normalizeHotelBody);
    if (!validateHotels(body)) {
      return res.status(400).json({
        error: 'Ожидался массив отелей с полями id, title, rooms; gallery или images',
      });
    }
    const missingGal = body.some((h) => !Array.isArray(h.gallery) || h.gallery.length === 0);
    if (missingGal) {
      return res.status(400).json({ error: 'У каждого отеля должна быть галерея (хотя бы одно медиа)' });
    }
    await writeJson(HOTELS_FILE, body);
    const tours = await readJson(TOURS_FILE, []);
    await cleanupUploads(tours, body, db);
    res.json({ ok: true });
  });

  app.use(
    '/api/auth',
    createAuthRouter({
      db,
      upload,
      JWT_SECRET,
      cookieBase,
    }),
  );

  app.post('/api/upload', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: String(err.message || err) });
      next();
    });
  }, (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Нет файла (поле file)' });
    }
    const url = `/uploads/${req.file.filename}`;
    res.json({ ok: true, url, filename: req.file.filename });
  });

  app.post('/api/reset', async (req, res) => {
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, [EXTRACT_SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) {
      return res.status(500).json({ error: r.stderr || 'extract-seed failed' });
    }
    const tours = await readJson(TOURS_FILE, []);
    const hotels = await readJson(HOTELS_FILE, []);
    await cleanupUploads(tours, hotels, db);
    res.json({ ok: true, tours: tours.length, hotels: hotels.length });
  });

  app.use(
    '/uploads',
    express.static(UPLOADS_DIR, {
      maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
      fallthrough: false,
    }),
  );

  app.use(
    express.static(ROOT, {
      extensions: ['html'],
      maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
    }),
  );

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  });

  app.listen(PORT, () => {
    console.log(`Апсны-Гид API + статика: http://localhost:${PORT}`);
    console.log(`Админка: http://localhost:${PORT}/admin.html`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
