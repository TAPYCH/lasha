'use strict';

const path = require('path');
const fs = require('fs').promises;
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const LOGIN_RE = /^[a-zA-Z0-9._-]{3,48}$/;
const BCRYPT_ROUNDS = 11;

function normalizeLogin(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .slice(0, 48);
}

function publicUser(row) {
  const base = {
    id: row.id,
    role: row.role,
    login: row.login,
    name: row.name,
    phone: row.phone || '',
    avatar_url: row.avatar_url || null,
  };
  if (row.role === 'guide') {
    base.guide_status = row.guide_status || 'pending';
  }
  return base;
}

function createAuthRouter({ db, upload, JWT_SECRET, cookieBase }) {
  const router = express.Router();

  function setAuthCookie(res, userId) {
    const token = jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('apsny_token', token, {
      ...cookieBase,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  function readUserFromCookie(req) {
    const token = req.cookies?.apsny_token;
    if (!token) return null;
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
      return row || null;
    } catch {
      return null;
    }
  }

  function authMiddleware(req, res, next) {
    const row = readUserFromCookie(req);
    if (!row) return res.status(401).json({ error: 'Требуется вход' });
    req.authUser = row;
    next();
  }

  router.get('/me', (req, res) => {
    const row = readUserFromCookie(req);
    if (!row) return res.status(401).json({ error: 'Не авторизован' });
    res.json({ user: publicUser(row) });
  });

  router.post('/logout', (req, res) => {
    res.clearCookie('apsny_token', cookieBase);
    res.json({ ok: true });
  });

  router.post('/login', express.json(), (req, res) => {
    const login = normalizeLogin(req.body?.login);
    const password = String(req.body?.password || '');

    if (!LOGIN_RE.test(login)) {
      return res.status(400).json({ error: 'Логин: 3–48 символов (буквы, цифры, ._-)' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Пароль не короче 8 символов' });
    }

    const row = db.prepare('SELECT * FROM users WHERE login = ?').get(login);
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    setAuthCookie(res, row.id);
    res.json({ ok: true, user: publicUser(row) });
  });

  router.post('/register/tourist', express.json(), (req, res) => {
    const login = normalizeLogin(req.body?.login);
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();

    if (!LOGIN_RE.test(login)) {
      return res.status(400).json({ error: 'Логин: 3–48 символов (буквы, цифры, ._-)' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Пароль не короче 8 символов' });
    }
    if (name.length < 2) {
      return res.status(400).json({ error: 'Укажите имя' });
    }

    const exists = db.prepare('SELECT id FROM users WHERE login = ?').get(login);
    if (exists) {
      return res.status(409).json({ error: 'Такой логин уже занят' });
    }

    const id = crypto.randomUUID();
    const password_hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    const now = Date.now();

    db.prepare(
      `INSERT INTO users (id, role, login, password_hash, name, phone, passport_url, selfie_url, avatar_url, guide_status, created_at)
       VALUES (?, 'tourist', ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
    ).run(id, login, password_hash, name, phone || null, now);

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    setAuthCookie(res, row.id);
    res.status(201).json({ ok: true, user: publicUser(row) });
  });

  router.post(
    '/register/guide',
    upload.fields([
      { name: 'passport', maxCount: 1 },
      { name: 'selfie', maxCount: 1 },
    ]),
    (req, res) => {
      const login = normalizeLogin(req.body?.login);
      const password = String(req.body?.password || '');
      const name = String(req.body?.name || '').trim();
      const phone = String(req.body?.phone || '').trim();

      const passportFile = req.files?.passport?.[0];
      const selfieFile = req.files?.selfie?.[0];

      if (!LOGIN_RE.test(login)) {
        return res.status(400).json({ error: 'Логин: 3–48 символов (буквы, цифры, ._-)' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Пароль не короче 8 символов' });
      }
      if (name.length < 2) {
        return res.status(400).json({ error: 'Укажите имя' });
      }
      if (!passportFile || !selfieFile) {
        return res.status(400).json({ error: 'Загрузите фото паспорта и селфи' });
      }

      const exists = db.prepare('SELECT id FROM users WHERE login = ?').get(login);
      if (exists) {
        return res.status(409).json({ error: 'Такой логин уже занят' });
      }

      const id = crypto.randomUUID();
      const password_hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
      const now = Date.now();
      const passport_url = `/uploads/${passportFile.filename}`;
      const selfie_url = `/uploads/${selfieFile.filename}`;

      db.prepare(
        `INSERT INTO users (id, role, login, password_hash, name, phone, passport_url, selfie_url, avatar_url, guide_status, created_at)
         VALUES (?, 'guide', ?, ?, ?, ?, ?, ?, NULL, 'pending', ?)`,
      ).run(id, login, password_hash, name, phone || null, passport_url, selfie_url, now);

      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      setAuthCookie(res, row.id);
      res.status(201).json({ ok: true, user: publicUser(row) });
    },
  );

  router.patch('/profile', authMiddleware, express.json(), (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const phone = String(req.body?.phone ?? '').trim();

    if (name.length < 2) {
      return res.status(400).json({ error: 'Укажите имя' });
    }

    db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(
      name,
      phone || null,
      req.authUser.id,
    );

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.authUser.id);
    res.json({ ok: true, user: publicUser(row) });
  });

  router.post('/profile/avatar', authMiddleware, (req, res, next) => {
    upload.single('avatar')(req, res, (err) => {
      if (err) return res.status(400).json({ error: String(err.message || err) });
      next();
    });
  }, (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Нет файла (поле avatar)' });
    }

    const prev = req.authUser.avatar_url;
    const url = `/uploads/${req.file.filename}`;

    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(url, req.authUser.id);

    if (prev && /^\/uploads\//.test(prev)) {
      const fname = prev.replace(/^\/uploads\//, '');
      fs.unlink(path.join(__dirname, '..', 'uploads', fname)).catch(() => {});
    }

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.authUser.id);
    res.json({ ok: true, user: publicUser(row) });
  });

  return router;
}

module.exports = { createAuthRouter };
