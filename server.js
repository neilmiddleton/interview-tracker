'use strict';

const express  = require('express');
const session  = require('express-session');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const Database = require('better-sqlite3');

const PORT           = process.env.PORT           || 3000;
const DB_PATH        = process.env.DB_PATH        || path.join(__dirname, 'cadet-interviews.db');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const app = express();
let db;

// ── Database ──────────────────────────────────────────────────────────────────

function hashPin(pin) {
  return crypto.createHash('sha256')
    .update('rafac_cadet_tracker_v1_' + String(pin))
    .digest('hex');
}

function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cadets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS interviews (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      cadet_id    INTEGER NOT NULL REFERENCES cadets(id) ON DELETE CASCADE,
      interviewer TEXT NOT NULL,
      date        TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS questions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      interview_id INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      question     TEXT NOT NULL DEFAULT '',
      answer       TEXT NOT NULL DEFAULT '',
      order_index  INTEGER NOT NULL DEFAULT 0
    );
  `);

  try { db.exec("ALTER TABLE cadets ADD COLUMN rank TEXT NOT NULL DEFAULT ''"); } catch (_) {}
  try { db.exec("ALTER TABLE cadets ADD COLUMN classification TEXT NOT NULL DEFAULT ''"); } catch (_) {}
  try { db.exec("ALTER TABLE cadets ADD COLUMN notes TEXT NOT NULL DEFAULT ''"); } catch (_) {}
  try { db.exec("ALTER TABLE cadets ADD COLUMN next_interview_date TEXT NOT NULL DEFAULT ''"); } catch (_) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS template_questions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id  INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      question     TEXT NOT NULL DEFAULT '',
      order_index  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS promotion_history (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      cadet_id            INTEGER NOT NULL REFERENCES cadets(id) ON DELETE CASCADE,
      from_rank           TEXT NOT NULL DEFAULT '',
      to_rank             TEXT NOT NULL DEFAULT '',
      from_classification TEXT NOT NULL DEFAULT '',
      to_classification   TEXT NOT NULL DEFAULT '',
      date                TEXT NOT NULL,
      notes               TEXT NOT NULL DEFAULT '',
      created_at          TEXT DEFAULT (datetime('now'))
    );
  `);

  if (!db.prepare('SELECT id FROM templates LIMIT 1').get()) {
    const seedTpl = db.transaction((name, qs) => {
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO templates(name, is_default) VALUES(?,1)'
      ).run(name);
      const stmt = db.prepare(
        'INSERT INTO template_questions(template_id, question, order_index) VALUES(?,?,?)'
      );
      qs.forEach((q, i) => stmt.run(lastInsertRowid, q, i));
    });
    seedTpl('Initial Interview', [
      'Why did you join the Air Cadets?',
      'What do you hope to achieve during your time as a cadet?',
      'What activities or subjects interest you most?',
      'How are you finding life in the squadron so far?',
      'What are your goals for the next 6 months?',
    ]);
    seedTpl('Annual Review', [
      'What have been your biggest achievements over the past year?',
      'What courses or qualifications have you completed?',
      'How have you contributed to squadron life?',
      'What challenges have you faced and how did you overcome them?',
      'What are your goals for the coming year?',
    ]);
    seedTpl('Promotion Consideration', [
      'Why do you feel ready for promotion to the next rank?',
      'Describe a time when you demonstrated leadership.',
      'How have you supported junior cadets?',
      'What responsibilities have you taken on in the squadron?',
      'What do you think the next rank will require of you?',
    ]);
    seedTpl('Classification Assessment', [
      'What subjects have you studied for this classification?',
      'How have you prepared for this assessment?',
      'What practical skills have you developed?',
      'What does this classification mean to you and your development?',
      'What will you focus on next in your cadet training?',
    ]);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid    TEXT PRIMARY KEY,
      sess   TEXT NOT NULL,
      expire INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire);
  `);

  if (!db.prepare("SELECT value FROM settings WHERE key='pin_hash'").get()) {
    db.prepare("INSERT INTO settings(key,value) VALUES('pin_hash',?)").run(hashPin('0000'));
  }
}

// ── Session Store ─────────────────────────────────────────────────────────────

class SQLiteStore extends session.Store {
  constructor() {
    super();
    setInterval(() => {
      db.prepare('DELETE FROM sessions WHERE expire < ?').run(Math.floor(Date.now() / 1000));
    }, 60_000).unref();
  }

  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess FROM sessions WHERE sid=? AND expire > ?')
        .get(sid, Math.floor(Date.now() / 1000));
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try {
      const expire = sess.cookie?.expires
        ? Math.floor(new Date(sess.cookie.expires).getTime() / 1000)
        : Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      db.prepare('INSERT OR REPLACE INTO sessions(sid, sess, expire) VALUES(?,?,?)')
        .run(sid, JSON.stringify(sess), expire);
      cb(null);
    } catch (e) { cb(e); }
  }

  destroy(sid, cb) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);
      cb(null);
    } catch (e) { cb(e); }
  }

  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

// ── Middleware ────────────────────────────────────────────────────────────────

initDb();

app.set('trust proxy', 1); // Fly.io (and most PaaS) terminate TLS at a proxy
app.use(express.json());
app.use(session({
  store: new SQLiteStore(),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));
app.use(express.static(path.join(__dirname, 'renderer')));

app.get('/cadet-logo-blue-8f4a99728d.svg', (req, res) => {
  res.sendFile(path.join(__dirname, 'cadet-logo-blue-8f4a99728d.svg'));
});

function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/auth/verify', (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key='pin_hash'").get();
  const ok  = Boolean(row && row.value === hashPin(String(req.body.pin)));
  if (ok) req.session.authenticated = true;
  res.json(ok);
});

app.post('/api/auth/change', requireAuth, (req, res) => {
  const { currentPin, newPin } = req.body;
  const row = db.prepare("SELECT value FROM settings WHERE key='pin_hash'").get();
  if (!row || row.value !== hashPin(currentPin)) {
    return res.json({ success: false, message: 'Current PIN is incorrect' });
  }
  db.prepare("UPDATE settings SET value=? WHERE key='pin_hash'").run(hashPin(newPin));
  res.json({ success: true });
});

app.post('/api/auth/lock', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── Cadets ────────────────────────────────────────────────────────────────────

app.get('/api/cadets', requireAuth, (req, res) => {
  const like = `%${(req.query.q || '').trim()}%`;
  res.json(db.prepare(`
    SELECT c.id, c.name, c.rank, c.classification, c.next_interview_date,
           COUNT(CASE WHEN i.date <= date('now') THEN 1 END) AS interview_count,
           MAX(CASE WHEN i.date <= date('now') THEN i.date END) AS last_interview_date,
           MIN(CASE WHEN i.date > date('now')
                      OR COALESCE(ia.answered, 0) = 0
                    THEN i.date END) AS next_scheduled_date
    FROM   cadets c
    LEFT JOIN interviews i ON i.cadet_id = c.id
    LEFT JOIN (
      SELECT interview_id, COUNT(CASE WHEN answer != '' THEN 1 END) AS answered
      FROM   questions GROUP BY interview_id
    ) ia ON ia.interview_id = i.id
    WHERE  c.name LIKE ? COLLATE NOCASE
    GROUP  BY c.id
    ORDER  BY c.name COLLATE NOCASE
  `).all(like));
});

app.post('/api/cadets', requireAuth, (req, res) => {
  const { name, rank, classification } = req.body;
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO cadets(name, rank, classification) VALUES(?,?,?)'
  ).run(name.trim(), rank || '', classification || '');
  res.json(db.prepare('SELECT * FROM cadets WHERE id=?').get(lastInsertRowid));
});

app.get('/api/cadets/:id', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM cadets WHERE id=?').get(Number(req.params.id)) || null);
});

app.put('/api/cadets/:id', requireAuth, (req, res) => {
  const { name, rank, classification, next_interview_date } = req.body;
  db.prepare('UPDATE cadets SET name=?, rank=?, classification=?, next_interview_date=? WHERE id=?')
    .run(name.trim(), rank || '', classification || '', next_interview_date || '', Number(req.params.id));
  res.json({ success: true });
});

app.patch('/api/cadets/:id/notes', requireAuth, (req, res) => {
  db.prepare('UPDATE cadets SET notes=? WHERE id=?').run(req.body.notes, Number(req.params.id));
  res.json({ success: true });
});

app.delete('/api/cadets/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM cadets WHERE id=?').run(Number(req.params.id));
  res.json({ success: true });
});

// ── Interviews ────────────────────────────────────────────────────────────────

app.get('/api/cadets/:cadetId/interviews', requireAuth, (req, res) => {
  res.json(db.prepare(`
    SELECT i.id, i.date, i.interviewer, i.created_at,
           COUNT(q.id) AS question_count
    FROM   interviews i
    LEFT JOIN questions q ON q.interview_id = i.id
    WHERE  i.cadet_id = ?
    GROUP  BY i.id
    ORDER  BY i.date DESC
  `).all(Number(req.params.cadetId)));
});

app.get('/api/interviews/:id', requireAuth, (req, res) => {
  const row = db.prepare(`
    SELECT i.*, c.name AS cadet_name
    FROM   interviews i
    JOIN   cadets c ON c.id = i.cadet_id
    WHERE  i.id = ?
  `).get(Number(req.params.id));
  if (!row) return res.json(null);
  row.questions = db.prepare(
    'SELECT * FROM questions WHERE interview_id=? ORDER BY order_index'
  ).all(Number(req.params.id));
  res.json(row);
});

app.post('/api/interviews', requireAuth, (req, res) => {
  const { cadetId, interviewer, date, questions } = req.body;
  const run = db.transaction(() => {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO interviews(cadet_id, interviewer, date) VALUES(?,?,?)'
    ).run(cadetId, interviewer.trim(), date);
    const stmt = db.prepare(
      'INSERT INTO questions(interview_id, question, answer, order_index) VALUES(?,?,?,?)'
    );
    questions.forEach((q, i) => stmt.run(lastInsertRowid, q.question.trim(), (q.answer || '').trim(), i));
    return lastInsertRowid;
  });
  res.json({ id: Number(run()), success: true });
});

app.put('/api/interviews/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { interviewer, date, questions } = req.body;
  db.transaction(() => {
    db.prepare('UPDATE interviews SET interviewer=?, date=? WHERE id=?').run(interviewer.trim(), date, id);
    db.prepare('DELETE FROM questions WHERE interview_id=?').run(id);
    const stmt = db.prepare(
      'INSERT INTO questions(interview_id, question, answer, order_index) VALUES(?,?,?,?)'
    );
    questions.forEach((q, i) => stmt.run(id, q.question.trim(), (q.answer || '').trim(), i));
  })();
  res.json({ success: true });
});

app.delete('/api/interviews/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM interviews WHERE id=?').run(Number(req.params.id));
  res.json({ success: true });
});

// ── Stats ─────────────────────────────────────────────────────────────────────

app.get('/api/stats', requireAuth, (req, res) => {
  const total     = db.prepare('SELECT COUNT(*) AS n FROM cadets').get().n;
  const monthStr  = new Date().toISOString().slice(0, 7);
  const thisMonth = db.prepare("SELECT COUNT(*) AS n FROM interviews WHERE date LIKE ?").get(`${monthStr}%`).n;
  const todayStr  = new Date().toISOString().slice(0, 10);

  const unansweredBase = `
    FROM interviews i
    LEFT JOIN (
      SELECT interview_id, COUNT(CASE WHEN answer != '' THEN 1 END) AS answered
      FROM questions GROUP BY interview_id
    ) ia ON ia.interview_id = i.id
    WHERE COALESCE(ia.answered, 0) = 0
  `;
  const upcoming = db.prepare(`SELECT COUNT(*) AS n ${unansweredBase} AND i.date >= ? AND i.date <= date(?, '+30 days')`)
    .get(todayStr, todayStr).n;
  const overdue  = db.prepare(`SELECT COUNT(*) AS n ${unansweredBase} AND i.date < ?`).get(todayStr).n;

  res.json({ total, thisMonth, upcoming, overdue });
});

// ── Templates ─────────────────────────────────────────────────────────────────

app.get('/api/templates', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM templates ORDER BY is_default DESC, name COLLATE NOCASE').all());
});

app.get('/api/templates/:id', requireAuth, (req, res) => {
  const tmpl = db.prepare('SELECT * FROM templates WHERE id=?').get(Number(req.params.id));
  if (!tmpl) return res.json(null);
  tmpl.questions = db.prepare(
    'SELECT * FROM template_questions WHERE template_id=? ORDER BY order_index'
  ).all(Number(req.params.id));
  res.json(tmpl);
});

app.post('/api/templates', requireAuth, (req, res) => {
  const { id: inId, name, questions } = req.body;
  let resolvedId = inId;
  const run = db.transaction(() => {
    if (resolvedId) {
      db.prepare('UPDATE templates SET name=? WHERE id=?').run(name.trim(), resolvedId);
      db.prepare('DELETE FROM template_questions WHERE template_id=?').run(resolvedId);
    } else {
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO templates(name, is_default) VALUES(?,0)'
      ).run(name.trim());
      resolvedId = lastInsertRowid;
    }
    const stmt = db.prepare(
      'INSERT INTO template_questions(template_id, question, order_index) VALUES(?,?,?)'
    );
    questions.forEach((q, i) => stmt.run(resolvedId, q.trim(), i));
    return resolvedId;
  });
  res.json({ success: true, id: Number(run()) });
});

app.delete('/api/templates/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM templates WHERE id=?').run(Number(req.params.id));
  res.json({ success: true });
});

// ── Promotions ────────────────────────────────────────────────────────────────

app.get('/api/cadets/:cadetId/promotions', requireAuth, (req, res) => {
  res.json(db.prepare(
    'SELECT * FROM promotion_history WHERE cadet_id=? ORDER BY date DESC, created_at DESC'
  ).all(Number(req.params.cadetId)));
});

app.post('/api/promotions', requireAuth, (req, res) => {
  const { cadetId, fromRank, toRank, fromClassification, toClassification, date, notes } = req.body;
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO promotion_history
      (cadet_id, from_rank, to_rank, from_classification, to_classification, date, notes)
    VALUES (?,?,?,?,?,?,?)
  `).run(cadetId, fromRank || '', toRank || '', fromClassification || '', toClassification || '', date, notes || '');

  const updates = []; const params = [];
  if (toRank)           { updates.push('rank=?');           params.push(toRank); }
  if (toClassification) { updates.push('classification=?'); params.push(toClassification); }
  if (updates.length) {
    params.push(cadetId);
    db.prepare(`UPDATE cadets SET ${updates.join(',')} WHERE id=?`).run(...params);
  }
  res.json({ success: true, id: Number(lastInsertRowid) });
});

app.delete('/api/promotions/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM promotion_history WHERE id=?').run(Number(req.params.id));
  res.json({ success: true });
});

// ── Backup / Restore ──────────────────────────────────────────────────────────

app.get('/api/backup/download', requireAuth, async (req, res) => {
  const tmp  = path.join(os.tmpdir(), `cadet-backup-${Date.now()}.db`);
  const date = new Date().toISOString().slice(0, 10);
  await db.backup(tmp);
  res.download(tmp, `cadet-interviews-backup-${date}.db`, () => {
    fs.unlink(tmp, () => {});
  });
});

app.post('/api/backup/restore', requireAuth, express.raw({ type: '*/*', limit: '100mb' }), (req, res) => {
  try {
    db.close();
    fs.writeFileSync(DB_PATH, req.body);
    initDb();
    res.json({ success: true });
  } catch (err) {
    console.error('Restore failed:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── SPA fallback ──────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'renderer', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log('\nRAFAC Cadet Interview Tracker');
  console.log(`Running at http://localhost:${PORT}\n`);
});
