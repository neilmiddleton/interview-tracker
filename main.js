const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const Database = require('better-sqlite3');

let db;
let mainWindow;

function hashPin(pin) {
  return crypto.createHash('sha256')
    .update('rafac_cadet_tracker_v1_' + String(pin))
    .digest('hex');
}

function initDb() {
  const dbPath = path.join(app.getPath('userData'), 'cadet-interviews.db');
  db = new Database(dbPath);
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

  // Migrations: add new columns to existing databases
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

  // Seed default templates if none exist
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

  if (!db.prepare("SELECT value FROM settings WHERE key='pin_hash'").get()) {
    db.prepare("INSERT INTO settings(key,value) VALUES('pin_hash',?)").run(hashPin('0000'));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 650,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'RAFAC Cadet Interview Tracker',
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  initDb();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Auth ─────────────────────────────────────────────────────────────────────

ipcMain.handle('auth:verify', (_, pin) => {
  const row = db.prepare("SELECT value FROM settings WHERE key='pin_hash'").get();
  return Boolean(row && row.value === hashPin(pin));
});

ipcMain.handle('auth:change', (_, { currentPin, newPin }) => {
  const row = db.prepare("SELECT value FROM settings WHERE key='pin_hash'").get();
  if (!row || row.value !== hashPin(currentPin)) {
    return { success: false, message: 'Current PIN is incorrect' };
  }
  db.prepare("UPDATE settings SET value=? WHERE key='pin_hash'").run(hashPin(newPin));
  return { success: true };
});

// ── Cadets ────────────────────────────────────────────────────────────────────

ipcMain.handle('cadets:search', (_, query) => {
  const like = `%${(query || '').trim()}%`;
  return db.prepare(`
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
      FROM   questions
      GROUP  BY interview_id
    ) ia ON ia.interview_id = i.id
    WHERE  c.name LIKE ? COLLATE NOCASE
    GROUP  BY c.id
    ORDER  BY c.name COLLATE NOCASE
  `).all(like);
});

ipcMain.handle('cadets:add', (_, { name, rank, classification }) => {
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO cadets(name, rank, classification) VALUES(?,?,?)'
  ).run(name.trim(), rank || '', classification || '');
  return db.prepare('SELECT * FROM cadets WHERE id=?').get(lastInsertRowid);
});

ipcMain.handle('cadets:get', (_, id) => {
  return db.prepare('SELECT * FROM cadets WHERE id=?').get(id);
});

ipcMain.handle('cadets:update', (_, { id, name, rank, classification, next_interview_date }) => {
  db.prepare('UPDATE cadets SET name=?, rank=?, classification=?, next_interview_date=? WHERE id=?')
    .run(name.trim(), rank || '', classification || '', next_interview_date || '', id);
  return { success: true };
});

ipcMain.handle('cadets:save-notes', (_, { id, notes }) => {
  db.prepare('UPDATE cadets SET notes=? WHERE id=?').run(notes, id);
  return { success: true };
});

ipcMain.handle('cadets:delete', (_, id) => {
  db.prepare('DELETE FROM cadets WHERE id=?').run(id);
  return { success: true };
});

// ── Interviews ────────────────────────────────────────────────────────────────

ipcMain.handle('interviews:list', (_, cadetId) => {
  return db.prepare(`
    SELECT i.id, i.date, i.interviewer, i.created_at,
           COUNT(q.id) AS question_count
    FROM   interviews i
    LEFT JOIN questions q ON q.interview_id = i.id
    WHERE  i.cadet_id = ?
    GROUP  BY i.id
    ORDER  BY i.date DESC
  `).all(cadetId);
});

ipcMain.handle('interviews:get', (_, id) => {
  const row = db.prepare(`
    SELECT i.*, c.name AS cadet_name
    FROM   interviews i
    JOIN   cadets c ON c.id = i.cadet_id
    WHERE  i.id = ?
  `).get(id);
  if (!row) return null;
  row.questions = db.prepare(
    'SELECT * FROM questions WHERE interview_id=? ORDER BY order_index'
  ).all(id);
  return row;
});

ipcMain.handle('interviews:add', (_, { cadetId, interviewer, date, questions }) => {
  const run = db.transaction(() => {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO interviews(cadet_id, interviewer, date) VALUES(?,?,?)'
    ).run(cadetId, interviewer.trim(), date);

    const stmt = db.prepare(
      'INSERT INTO questions(interview_id, question, answer, order_index) VALUES(?,?,?,?)'
    );
    questions.forEach((q, i) => {
      stmt.run(lastInsertRowid, q.question.trim(), (q.answer || '').trim(), i);
    });

    return lastInsertRowid;
  });

  return { id: Number(run()), success: true };
});

ipcMain.handle('interviews:update', (_, { id, interviewer, date, questions }) => {
  const run = db.transaction(() => {
    db.prepare('UPDATE interviews SET interviewer=?, date=? WHERE id=?')
      .run(interviewer.trim(), date, id);
    db.prepare('DELETE FROM questions WHERE interview_id=?').run(id);
    const stmt = db.prepare(
      'INSERT INTO questions(interview_id, question, answer, order_index) VALUES(?,?,?,?)'
    );
    questions.forEach((q, i) => {
      stmt.run(id, q.question.trim(), (q.answer || '').trim(), i);
    });
  });
  run();
  return { success: true };
});

ipcMain.handle('interviews:delete', (_, id) => {
  db.prepare('DELETE FROM interviews WHERE id=?').run(id);
  return { success: true };
});

// ── Print ─────────────────────────────────────────────────────────────────────

ipcMain.handle('print:dialog', () => {
  mainWindow.webContents.print(
    { silent: false, printBackground: false },
    (success, errorType) => {
      if (!success) console.error('Print error:', errorType);
    }
  );
  return { success: true };
});

// ── Stats ─────────────────────────────────────────────────────────────────────

ipcMain.handle('stats:get', () => {
  const total     = db.prepare('SELECT COUNT(*) AS n FROM cadets').get().n;
  const monthStr  = new Date().toISOString().slice(0, 7);
  const thisMonth = db.prepare(
    "SELECT COUNT(*) AS n FROM interviews WHERE date LIKE ?"
  ).get(`${monthStr}%`).n;
  const todayStr  = new Date().toISOString().slice(0, 10);

  const unansweredBase = `
    FROM interviews i
    LEFT JOIN (
      SELECT interview_id, COUNT(CASE WHEN answer != '' THEN 1 END) AS answered
      FROM questions GROUP BY interview_id
    ) ia ON ia.interview_id = i.id
    WHERE COALESCE(ia.answered, 0) = 0
  `;
  const upcoming = db.prepare(`
    SELECT COUNT(*) AS n ${unansweredBase}
      AND i.date >= ? AND i.date <= date(?, '+30 days')
  `).get(todayStr, todayStr).n;
  const overdue = db.prepare(`
    SELECT COUNT(*) AS n ${unansweredBase}
      AND i.date < ?
  `).get(todayStr).n;

  return { total, thisMonth, upcoming, overdue };
});

// ── Templates ─────────────────────────────────────────────────────────────────

ipcMain.handle('templates:list', () => {
  return db.prepare(
    'SELECT * FROM templates ORDER BY is_default DESC, name COLLATE NOCASE'
  ).all();
});

ipcMain.handle('templates:get', (_, id) => {
  const tmpl = db.prepare('SELECT * FROM templates WHERE id=?').get(id);
  if (!tmpl) return null;
  tmpl.questions = db.prepare(
    'SELECT * FROM template_questions WHERE template_id=? ORDER BY order_index'
  ).all(id);
  return tmpl;
});

ipcMain.handle('templates:save', (_, { id: inId, name, questions }) => {
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
  return { success: true, id: Number(run()) };
});

ipcMain.handle('templates:delete', (_, id) => {
  db.prepare('DELETE FROM templates WHERE id=?').run(id);
  return { success: true };
});

// ── Promotions ────────────────────────────────────────────────────────────────

ipcMain.handle('promotions:list', (_, cadetId) => {
  return db.prepare(
    'SELECT * FROM promotion_history WHERE cadet_id=? ORDER BY date DESC, created_at DESC'
  ).all(cadetId);
});

ipcMain.handle('promotions:add', (_, { cadetId, fromRank, toRank, fromClassification, toClassification, date, notes }) => {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO promotion_history
      (cadet_id, from_rank, to_rank, from_classification, to_classification, date, notes)
    VALUES (?,?,?,?,?,?,?)
  `).run(cadetId, fromRank || '', toRank || '', fromClassification || '', toClassification || '', date, notes || '');
  // Update cadet's current rank/classification
  const updates = []; const params = [];
  if (toRank)             { updates.push('rank=?');           params.push(toRank); }
  if (toClassification)   { updates.push('classification=?'); params.push(toClassification); }
  if (updates.length) {
    params.push(cadetId);
    db.prepare(`UPDATE cadets SET ${updates.join(',')} WHERE id=?`).run(...params);
  }
  return { success: true, id: Number(lastInsertRowid) };
});

ipcMain.handle('promotions:delete', (_, id) => {
  db.prepare('DELETE FROM promotion_history WHERE id=?').run(id);
  return { success: true };
});

// ── Backup / Restore ──────────────────────────────────────────────────────────

ipcMain.handle('backup:save', async () => {
  const dbPath = path.join(app.getPath('userData'), 'cadet-interviews.db');
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Backup',
    defaultPath: `cadet-interviews-backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
  });
  if (!filePath) return { success: false };
  fs.copyFileSync(dbPath, filePath);
  return { success: true };
});

ipcMain.handle('backup:restore', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore Backup',
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    properties: ['openFile'],
  });
  if (!filePaths || !filePaths.length) return { success: false };
  const dbPath = path.join(app.getPath('userData'), 'cadet-interviews.db');
  db.close();
  fs.copyFileSync(filePaths[0], dbPath);
  app.relaunch();
  app.exit();
  return { success: true };
});
