'use strict';

const express  = require('express');
const session  = require('express-session');
const crypto   = require('crypto');
const path     = require('path');
const { Pool } = require('pg');

const PORT           = process.env.PORT           || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const app  = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// ── Database ──────────────────────────────────────────────────────────────────

function hashPin(pin) {
  return crypto.createHash('sha256')
    .update('rafac_cadet_tracker_v1_' + String(pin))
    .digest('hex');
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cadets (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      rank       TEXT NOT NULL DEFAULT '',
      classification TEXT NOT NULL DEFAULT '',
      notes      TEXT NOT NULL DEFAULT '',
      next_interview_date TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS interviews (
      id          SERIAL PRIMARY KEY,
      cadet_id    INTEGER NOT NULL REFERENCES cadets(id) ON DELETE CASCADE,
      interviewer TEXT NOT NULL,
      date        TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS questions (
      id           SERIAL PRIMARY KEY,
      interview_id INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      question     TEXT NOT NULL DEFAULT '',
      answer       TEXT NOT NULL DEFAULT '',
      order_index  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS templates (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS template_questions (
      id          SERIAL PRIMARY KEY,
      template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      question    TEXT NOT NULL DEFAULT '',
      order_index INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS promotion_history (
      id                  SERIAL PRIMARY KEY,
      cadet_id            INTEGER NOT NULL REFERENCES cadets(id) ON DELETE CASCADE,
      from_rank           TEXT NOT NULL DEFAULT '',
      to_rank             TEXT NOT NULL DEFAULT '',
      from_classification TEXT NOT NULL DEFAULT '',
      to_classification   TEXT NOT NULL DEFAULT '',
      date                TEXT NOT NULL,
      notes               TEXT NOT NULL DEFAULT '',
      created_at          TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const { rows: tplRows } = await pool.query('SELECT id FROM templates LIMIT 1');
  if (!tplRows.length) {
    const seedTpl = async (name, qs) => {
      const { rows } = await pool.query(
        'INSERT INTO templates(name, is_default) VALUES($1, 1) RETURNING id', [name]
      );
      const id = rows[0].id;
      for (let i = 0; i < qs.length; i++) {
        await pool.query(
          'INSERT INTO template_questions(template_id, question, order_index) VALUES($1,$2,$3)',
          [id, qs[i], i]
        );
      }
    };
    await seedTpl('Initial Interview', [
      'Why did you join the Air Cadets?',
      'What do you hope to achieve during your time as a cadet?',
      'What activities or subjects interest you most?',
      'How are you finding life in the squadron so far?',
      'What are your goals for the next 6 months?',
    ]);
    await seedTpl('Annual Review', [
      'What have been your biggest achievements over the past year?',
      'What courses or qualifications have you completed?',
      'How have you contributed to squadron life?',
      'What challenges have you faced and how did you overcome them?',
      'What are your goals for the coming year?',
    ]);
    await seedTpl('Promotion Consideration', [
      'Why do you feel ready for promotion to the next rank?',
      'Describe a time when you demonstrated leadership.',
      'How have you supported junior cadets?',
      'What responsibilities have you taken on in the squadron?',
      'What do you think the next rank will require of you?',
    ]);
    await seedTpl('Classification Assessment', [
      'What subjects have you studied for this classification?',
      'How have you prepared for this assessment?',
      'What practical skills have you developed?',
      'What does this classification mean to you and your development?',
      'What will you focus on next in your cadet training?',
    ]);
  }

  const { rows: pinRows } = await pool.query("SELECT value FROM settings WHERE key='pin_hash'");
  if (!pinRows.length) {
    await pool.query("INSERT INTO settings(key,value) VALUES('pin_hash',$1)", [hashPin('0000')]);
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' },
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

app.post('/api/auth/verify', async (req, res) => {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='pin_hash'");
  const ok = Boolean(rows.length && rows[0].value === hashPin(String(req.body.pin)));
  if (ok) req.session.authenticated = true;
  res.json(ok);
});

app.post('/api/auth/change', requireAuth, async (req, res) => {
  const { currentPin, newPin } = req.body;
  const { rows } = await pool.query("SELECT value FROM settings WHERE key='pin_hash'");
  if (!rows.length || rows[0].value !== hashPin(currentPin)) {
    return res.json({ success: false, message: 'Current PIN is incorrect' });
  }
  await pool.query("UPDATE settings SET value=$1 WHERE key='pin_hash'", [hashPin(newPin)]);
  res.json({ success: true });
});

app.post('/api/auth/lock', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── Cadets ────────────────────────────────────────────────────────────────────

app.get('/api/cadets', requireAuth, async (req, res) => {
  const like = `%${(req.query.q || '').trim()}%`;
  const { rows } = await pool.query(`
    SELECT c.id, c.name, c.rank, c.classification, c.next_interview_date,
           COUNT(CASE WHEN i.date <= CURRENT_DATE::text THEN 1 END)::int AS interview_count,
           MAX(CASE WHEN i.date <= CURRENT_DATE::text THEN i.date END) AS last_interview_date,
           MIN(CASE WHEN i.date > CURRENT_DATE::text
                      OR COALESCE(ia.answered, 0) = 0
                    THEN i.date END) AS next_scheduled_date
    FROM   cadets c
    LEFT JOIN interviews i ON i.cadet_id = c.id
    LEFT JOIN (
      SELECT interview_id, COUNT(CASE WHEN answer != '' THEN 1 END)::int AS answered
      FROM   questions GROUP BY interview_id
    ) ia ON ia.interview_id = i.id
    WHERE  c.name ILIKE $1
    GROUP  BY c.id
    ORDER  BY LOWER(c.name)
  `, [like]);
  res.json(rows);
});

app.post('/api/cadets', requireAuth, async (req, res) => {
  const { name, rank, classification } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO cadets(name, rank, classification) VALUES($1,$2,$3) RETURNING *',
    [name.trim(), rank || '', classification || '']
  );
  res.json(rows[0]);
});

app.get('/api/cadets/:id', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM cadets WHERE id=$1', [req.params.id]);
  res.json(rows[0] || null);
});

app.put('/api/cadets/:id', requireAuth, async (req, res) => {
  const { name, rank, classification, next_interview_date } = req.body;
  await pool.query(
    'UPDATE cadets SET name=$1, rank=$2, classification=$3, next_interview_date=$4 WHERE id=$5',
    [name.trim(), rank || '', classification || '', next_interview_date || '', req.params.id]
  );
  res.json({ success: true });
});

app.patch('/api/cadets/:id/notes', requireAuth, async (req, res) => {
  await pool.query('UPDATE cadets SET notes=$1 WHERE id=$2', [req.body.notes, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/cadets/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM cadets WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── Interviews ────────────────────────────────────────────────────────────────

app.get('/api/cadets/:cadetId/interviews', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT i.id, i.date, i.interviewer, i.created_at,
           COUNT(q.id)::int AS question_count
    FROM   interviews i
    LEFT JOIN questions q ON q.interview_id = i.id
    WHERE  i.cadet_id = $1
    GROUP  BY i.id
    ORDER  BY i.date DESC
  `, [req.params.cadetId]);
  res.json(rows);
});

app.get('/api/interviews/:id', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT i.*, c.name AS cadet_name
    FROM   interviews i
    JOIN   cadets c ON c.id = i.cadet_id
    WHERE  i.id = $1
  `, [req.params.id]);
  if (!rows.length) return res.json(null);
  const iv = rows[0];
  const { rows: qs } = await pool.query(
    'SELECT * FROM questions WHERE interview_id=$1 ORDER BY order_index', [req.params.id]
  );
  iv.questions = qs;
  res.json(iv);
});

app.post('/api/interviews', requireAuth, async (req, res) => {
  const { cadetId, interviewer, date, questions } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO interviews(cadet_id, interviewer, date) VALUES($1,$2,$3) RETURNING id',
      [cadetId, interviewer.trim(), date]
    );
    const ivId = rows[0].id;
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      await client.query(
        'INSERT INTO questions(interview_id, question, answer, order_index) VALUES($1,$2,$3,$4)',
        [ivId, q.question.trim(), (q.answer || '').trim(), i]
      );
    }
    await client.query('COMMIT');
    res.json({ id: ivId, success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

app.put('/api/interviews/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  const { interviewer, date, questions } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE interviews SET interviewer=$1, date=$2 WHERE id=$3',
      [interviewer.trim(), date, id]);
    await client.query('DELETE FROM questions WHERE interview_id=$1', [id]);
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      await client.query(
        'INSERT INTO questions(interview_id, question, answer, order_index) VALUES($1,$2,$3,$4)',
        [id, q.question.trim(), (q.answer || '').trim(), i]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

app.delete('/api/interviews/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM interviews WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── Stats ─────────────────────────────────────────────────────────────────────

app.get('/api/stats', requireAuth, async (req, res) => {
  const todayStr  = new Date().toISOString().slice(0, 10);
  const monthStr  = todayStr.slice(0, 7);
  const in30days  = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const [{ rows: [{ n: total }] }, { rows: [{ n: thisMonth }] }] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS n FROM cadets'),
    pool.query("SELECT COUNT(*)::int AS n FROM interviews WHERE date LIKE $1", [`${monthStr}%`]),
  ]);

  const unansweredBase = `
    FROM interviews i
    LEFT JOIN (
      SELECT interview_id, COUNT(CASE WHEN answer != '' THEN 1 END)::int AS answered
      FROM questions GROUP BY interview_id
    ) ia ON ia.interview_id = i.id
    WHERE COALESCE(ia.answered, 0) = 0
  `;
  const [{ rows: [{ n: upcoming }] }, { rows: [{ n: overdue }] }] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n ${unansweredBase} AND i.date >= $1 AND i.date <= $2`, [todayStr, in30days]),
    pool.query(`SELECT COUNT(*)::int AS n ${unansweredBase} AND i.date < $1`, [todayStr]),
  ]);

  res.json({ total, thisMonth, upcoming, overdue });
});

// ── Templates ─────────────────────────────────────────────────────────────────

app.get('/api/templates', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM templates ORDER BY is_default DESC, LOWER(name)');
  res.json(rows);
});

app.get('/api/templates/:id', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM templates WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.json(null);
  const tmpl = rows[0];
  const { rows: qs } = await pool.query(
    'SELECT * FROM template_questions WHERE template_id=$1 ORDER BY order_index', [req.params.id]
  );
  tmpl.questions = qs;
  res.json(tmpl);
});

app.post('/api/templates', requireAuth, async (req, res) => {
  const { id: inId, name, questions } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let resolvedId = inId;
    if (resolvedId) {
      await client.query('UPDATE templates SET name=$1 WHERE id=$2', [name.trim(), resolvedId]);
      await client.query('DELETE FROM template_questions WHERE template_id=$1', [resolvedId]);
    } else {
      const { rows } = await client.query(
        'INSERT INTO templates(name, is_default) VALUES($1, 0) RETURNING id', [name.trim()]
      );
      resolvedId = rows[0].id;
    }
    for (let i = 0; i < questions.length; i++) {
      await client.query(
        'INSERT INTO template_questions(template_id, question, order_index) VALUES($1,$2,$3)',
        [resolvedId, questions[i].trim(), i]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, id: resolvedId });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

app.delete('/api/templates/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM templates WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── Promotions ────────────────────────────────────────────────────────────────

app.get('/api/cadets/:cadetId/promotions', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM promotion_history WHERE cadet_id=$1 ORDER BY date DESC, created_at DESC',
    [req.params.cadetId]
  );
  res.json(rows);
});

app.post('/api/promotions', requireAuth, async (req, res) => {
  const { cadetId, fromRank, toRank, fromClassification, toClassification, date, notes } = req.body;
  const { rows } = await pool.query(`
    INSERT INTO promotion_history
      (cadet_id, from_rank, to_rank, from_classification, to_classification, date, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
  `, [cadetId, fromRank || '', toRank || '', fromClassification || '', toClassification || '', date, notes || '']);

  const updates = []; const params = [];
  if (toRank)           { updates.push(`rank=$${params.push(toRank)}`); }
  if (toClassification) { updates.push(`classification=$${params.push(toClassification)}`); }
  if (updates.length) {
    params.push(cadetId);
    await pool.query(`UPDATE cadets SET ${updates.join(',')} WHERE id=$${params.length}`, params);
  }
  res.json({ success: true, id: rows[0].id });
});

app.delete('/api/promotions/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM promotion_history WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ── Backup / Restore ──────────────────────────────────────────────────────────

app.get('/api/backup/download', requireAuth, async (req, res) => {
  const [cadets, interviews, questions, templates, tplQs, promos, settings] = await Promise.all([
    pool.query('SELECT * FROM cadets ORDER BY id'),
    pool.query('SELECT * FROM interviews ORDER BY id'),
    pool.query('SELECT * FROM questions ORDER BY id'),
    pool.query('SELECT * FROM templates ORDER BY id'),
    pool.query('SELECT * FROM template_questions ORDER BY id'),
    pool.query('SELECT * FROM promotion_history ORDER BY id'),
    pool.query('SELECT * FROM settings'),
  ]);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="cadet-interviews-backup-${date}.json"`);
  res.json({
    version: 2,
    exported_at: new Date().toISOString(),
    cadets: cadets.rows,
    interviews: interviews.rows,
    questions: questions.rows,
    templates: templates.rows,
    template_questions: tplQs.rows,
    promotion_history: promos.rows,
    settings: settings.rows,
  });
});

app.post('/api/backup/restore', requireAuth, async (req, res) => {
  const data = req.body;
  if (!data || data.version !== 2) {
    return res.status(400).json({ success: false, message: 'Invalid backup file. Only JSON backups from the web version are supported.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Truncate in reverse FK dependency order
    await client.query('TRUNCATE promotion_history, template_questions, questions, interviews, templates, cadets, settings RESTART IDENTITY CASCADE');

    for (const r of (data.settings || [])) {
      await client.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2', [r.key, r.value]);
    }
    for (const r of (data.cadets || [])) {
      await client.query(
        'INSERT INTO cadets(id,name,rank,classification,notes,next_interview_date,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [r.id, r.name, r.rank||'', r.classification||'', r.notes||'', r.next_interview_date||'', r.created_at]
      );
    }
    for (const r of (data.templates || [])) {
      await client.query(
        'INSERT INTO templates(id,name,is_default,created_at) VALUES($1,$2,$3,$4)',
        [r.id, r.name, r.is_default, r.created_at]
      );
    }
    for (const r of (data.interviews || [])) {
      await client.query(
        'INSERT INTO interviews(id,cadet_id,interviewer,date,created_at) VALUES($1,$2,$3,$4,$5)',
        [r.id, r.cadet_id, r.interviewer, r.date, r.created_at]
      );
    }
    for (const r of (data.questions || [])) {
      await client.query(
        'INSERT INTO questions(id,interview_id,question,answer,order_index) VALUES($1,$2,$3,$4,$5)',
        [r.id, r.interview_id, r.question, r.answer, r.order_index]
      );
    }
    for (const r of (data.template_questions || [])) {
      await client.query(
        'INSERT INTO template_questions(id,template_id,question,order_index) VALUES($1,$2,$3,$4)',
        [r.id, r.template_id, r.question, r.order_index]
      );
    }
    for (const r of (data.promotion_history || [])) {
      await client.query(
        'INSERT INTO promotion_history(id,cadet_id,from_rank,to_rank,from_classification,to_classification,date,notes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [r.id, r.cadet_id, r.from_rank, r.to_rank, r.from_classification, r.to_classification, r.date, r.notes, r.created_at]
      );
    }
    // Reset sequences
    for (const tbl of ['cadets','interviews','questions','templates','template_questions','promotion_history']) {
      await client.query(`SELECT setval(pg_get_serial_sequence('${tbl}','id'), COALESCE((SELECT MAX(id) FROM ${tbl}), 0))`);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Restore failed:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ── SPA fallback ──────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'renderer', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('\nRAFAC Cadet Interview Tracker');
    console.log(`Running at http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
});
