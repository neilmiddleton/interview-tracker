'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  view:    'dashboard',
  cadetId: null,
  interviewId: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function el(id) { return document.getElementById(id); }
function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Sample Questions ──────────────────────────────────────────────────────────
const SAMPLE_QUESTIONS = {
  'Motivation & Background': [
    'Why did you join the Air Cadets?',
    'What does being an Air Cadet mean to you?',
    'What attracted you to the Royal Air Force Air Cadets?',
    'Why do you want to achieve this rank or classification?',
  ],
  'Achievements & Activities': [
    'What achievements are you most proud of during your time as a cadet?',
    'What courses or qualifications have you completed?',
    'Tell me about a camp or activity that stood out to you.',
    'What flying or gliding experience have you had?',
    'Have you participated in Duke of Edinburgh? What did you learn?',
    'What sports or physical training have you taken part in as a cadet?',
  ],
  'Leadership & Teamwork': [
    'Describe a time when you showed leadership.',
    'How have you supported other cadets in the squadron?',
    'Tell me about a time you worked as part of a team.',
    'How have you helped newer cadets settle in?',
    'Describe a situation where you had to make a difficult decision.',
    'How do you handle disagreements within your team?',
  ],
  'Future Goals': [
    'Where do you see yourself in the Air Cadets in the next 12 months?',
    'What are your goals for the coming year?',
    'Are you considering a career in the RAF or armed forces?',
    'What skills do you want to develop further?',
    'What would you like to achieve before you leave cadets?',
  ],
  'Knowledge & Values': [
    'What do you know about the RAF and its current operations?',
    'What are the core values of the RAF?',
    'What does the RAFAC ethos mean to you?',
    'How do you demonstrate respect and integrity in your role?',
    'What does your current classification mean to you?',
  ],
  'Character & Resilience': [
    'What are your strengths and areas for improvement?',
    'Tell me something about yourself that isn\'t on your record.',
    'How do you handle pressure or stressful situations?',
    'What challenges have you faced and how did you overcome them?',
    'How do you prepare for assessments or events?',
  ],
};

const SAMPLE_QUESTIONS_HTML = Object.entries(SAMPLE_QUESTIONS)
  .map(([group, qs]) => `
    <optgroup label="${esc(group)}">
      ${qs.map(q => `<option value="${esc(q)}">${esc(q)}</option>`).join('')}
    </optgroup>`)
  .join('');

// ── Rank / Classification Options ─────────────────────────────────────────────
const RANKS = ['', 'Cdt', 'Cpl', 'Sgt', 'FS', 'CWO'];
const CLASSIFICATIONS = ['', '2nd Class', 'First Class', 'Leading', 'Senior', 'Master'];

const RANK_CSS  = { 'Cdt': 'rank-cdt', 'Cpl': 'rank-cpl', 'Sgt': 'rank-sgt', 'FS': 'rank-fs', 'CWO': 'rank-cwo' };
const CLASS_CSS = { '2nd Class': 'class-c2', 'First Class': 'class-c1', 'Leading': 'class-cl', 'Senior': 'class-cs', 'Master': 'class-cm' };

function rankBadge(rank, lg = false) {
  if (!rank) return '<span class="td-empty">—</span>';
  return `<span class="rank-badge ${RANK_CSS[rank] || ''}${lg ? ' rank-badge-lg' : ''}">${esc(rank)}</span>`;
}
function classBadge(cls) {
  if (!cls) return '<span class="td-empty">—</span>';
  return `<span class="class-badge ${CLASS_CSS[cls] || ''}">${esc(cls)}</span>`;
}

function nextInterviewCell(dateStr) {
  if (!dateStr) return '<span class="td-empty">—</span>';
  const now = new Date(); now.setHours(0,0,0,0);
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const days = Math.round((date - now) / 86400000);
  if (days < 0)   return { text: fmt(dateStr), cls: 'td-overdue' };
  if (days <= 30) return { text: fmt(dateStr), cls: 'td-due-soon' };
  return { text: fmt(dateStr), cls: '' };
}

// Returns the earliest of manually-set next_interview_date and any future-scheduled interview date
function effectiveNextDate(c) {
  const manual    = c.next_interview_date  || '';
  const scheduled = c.next_scheduled_date  || '';
  if (!manual && !scheduled) return '';
  if (!manual)    return scheduled;
  if (!scheduled) return manual;
  return manual <= scheduled ? manual : scheduled;
}

function rankOptions(selected) {
  return RANKS.map(r => `<option value="${r}"${r === selected ? ' selected' : ''}>${r || '— Select rank —'}</option>`).join('');
}
function classOptions(selected) {
  return CLASSIFICATIONS.map(c => `<option value="${c}"${c === selected ? ' selected' : ''}>${c || '— Select classification —'}</option>`).join('');
}

let toastTimer;
function showToast(msg, type = '') {
  clearTimeout(toastTimer);
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  requestAnimationFrame(() => toast.classList.add('show'));
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

// ── Pin Screen ────────────────────────────────────────────────────────────────
let pinBuffer = '';

function initPinScreen() {
  document.querySelectorAll('.pin-btn[data-digit]').forEach(btn => {
    btn.addEventListener('click', () => pushDigit(btn.dataset.digit));
  });
  el('pin-clear').addEventListener('click', () => { pinBuffer = ''; renderDots(); });
  el('pin-back').addEventListener('click', () => {
    pinBuffer = pinBuffer.slice(0, -1);
    renderDots();
  });

  document.addEventListener('keydown', (e) => {
    if (!el('lock-screen').classList.contains('hidden')) {
      if (e.key >= '0' && e.key <= '9') pushDigit(e.key);
      if (e.key === 'Backspace') { pinBuffer = pinBuffer.slice(0, -1); renderDots(); }
      if (e.key === 'Escape') { pinBuffer = ''; renderDots(); }
    }
  });
}

function pushDigit(d) {
  if (pinBuffer.length >= 4) return;
  pinBuffer += d;
  renderDots();
  if (pinBuffer.length === 4) submitPin();
}

function renderDots() {
  el('pin-dots').querySelectorAll('span').forEach((s, i) => {
    s.classList.toggle('filled', i < pinBuffer.length);
  });
}

async function submitPin() {
  const ok = await window.api.auth.verify(pinBuffer);
  if (ok) {
    el('lock-screen').classList.add('hidden');
    el('app').classList.remove('hidden');
    pinBuffer = '';
    renderDots();
    el('pin-error').classList.add('hidden');
    renderView();
  } else {
    pinBuffer = '';
    renderDots();
    el('pin-error').classList.remove('hidden');
    el('lock-screen').classList.add('shake');
    setTimeout(() => el('lock-screen').classList.remove('shake'), 400);
  }
}

function lockApp() {
  el('app').classList.add('hidden');
  el('lock-screen').classList.remove('hidden');
  pinBuffer = '';
  renderDots();
  el('pin-error').classList.add('hidden');
}

// ── Routing ───────────────────────────────────────────────────────────────────
function go(view, params = {}) {
  Object.assign(state, { view, ...params });
  renderView();
}

function renderView() {
  switch (state.view) {
    case 'dashboard':      renderDashboard();     break;
    case 'cadet':          renderCadet();         break;
    case 'new-interview':  renderNewInterview();  break;
    case 'view-interview': renderViewInterview(); break;
    case 'templates':      renderTemplates();     break;
    case 'edit-template':  renderEditTemplate();  break;
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
const RANK_ORDER  = { 'Cdt': 1, 'Cpl': 2, 'Sgt': 3, 'FS': 4, 'CWO': 5 };
const CLASS_ORDER = { '2nd Class': 1, 'First Class': 2, 'Leading': 3, 'Senior': 4, 'Master': 5 };

let dashSort = { col: 'name', dir: 'asc' };
let dashCadets = [];

async function renderDashboard() {
  const main = el('main-content');
  const stats = await window.api.stats.get();

  main.innerHTML = `
    <div class="page-header">
      <h2>Air Cadets</h2>
      <button class="btn btn-primary" id="add-cadet-btn">+ Add Cadet</button>
    </div>
    <div class="stats-bar">
      <div class="stat-card">
        <span class="stat-value">${stats.total}</span>
        <span class="stat-label">Total Cadets</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">${stats.thisMonth}</span>
        <span class="stat-label">Interviews This Month</span>
      </div>
      <div class="stat-card stat-warn">
        <span class="stat-value">${stats.upcoming}</span>
        <span class="stat-label">Upcoming (30 days)</span>
      </div>
      <div class="stat-card stat-danger">
        <span class="stat-value">${stats.overdue}</span>
        <span class="stat-label">Overdue</span>
      </div>
    </div>
    <div class="search-wrap">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input type="text" class="search-input" id="cadet-search"
             placeholder="Search by name…" autocomplete="off" value="">
    </div>
    <div id="cadet-table-wrap"></div>
  `;

  const search = el('cadet-search');

  async function load(q) {
    dashCadets = await window.api.cadets.search(q);
    renderTable();
  }

  function sortedCadets() {
    const { col, dir } = dashSort;
    return [...dashCadets].sort((a, b) => {
      let av, bv;
      if (col === 'name') {
        av = (a.name || '').toLowerCase();
        bv = (b.name || '').toLowerCase();
      } else if (col === 'rank') {
        av = RANK_ORDER[a.rank] ?? 0;
        bv = RANK_ORDER[b.rank] ?? 0;
      } else if (col === 'classification') {
        av = CLASS_ORDER[a.classification] ?? 0;
        bv = CLASS_ORDER[b.classification] ?? 0;
      } else if (col === 'interviews') {
        av = a.interview_count;
        bv = b.interview_count;
      } else if (col === 'last_interview') {
        av = a.last_interview_date || '';
        bv = b.last_interview_date || '';
      } else if (col === 'next_interview') {
        av = effectiveNextDate(a);
        bv = effectiveNextDate(b);
      }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function sortIcon(col) {
    if (dashSort.col !== col) return `<span class="sort-icon inactive">&#x2195;</span>`;
    return dashSort.dir === 'asc'
      ? `<span class="sort-icon active">&#x2191;</span>`
      : `<span class="sort-icon active">&#x2193;</span>`;
  }

  function renderTable() {
    const wrap = el('cadet-table-wrap');
    const cadets = sortedCadets();

    if (!cadets.length) {
      const q = el('cadet-search').value.trim();
      wrap.innerHTML = `
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <p>${q ? `No cadets matching "${esc(q)}"` : 'No cadets yet'}</p>
          ${!q ? '<small>Click <strong>+ Add Cadet</strong> to get started</small>' : ''}
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="cadet-table">
        <thead>
          <tr>
            <th class="sortable" data-col="name">Name ${sortIcon('name')}</th>
            <th class="sortable" data-col="rank">Rank ${sortIcon('rank')}</th>
            <th class="sortable" data-col="classification">Classification ${sortIcon('classification')}</th>
            <th class="sortable th-right" data-col="interviews">Interviews ${sortIcon('interviews')}</th>
            <th class="sortable" data-col="last_interview">Last Interview ${sortIcon('last_interview')}</th>
            <th class="sortable" data-col="next_interview">Next Interview ${sortIcon('next_interview')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${cadets.map(c => {
            const ni = nextInterviewCell(effectiveNextDate(c));
            const niCell = typeof ni === 'object'
              ? `<td class="${ni.cls}">${ni.text}</td>`
              : `<td>${ni}</td>`;
            return `
            <tr class="cadet-row" data-id="${c.id}" tabindex="0">
              <td class="td-name">${esc(c.name)}</td>
              <td>${rankBadge(c.rank)}</td>
              <td>${classBadge(c.classification)}</td>
              <td class="td-right">${c.interview_count}</td>
              <td>${c.last_interview_date ? fmt(c.last_interview_date) : '<span class="td-empty">—</span>'}</td>
              ${niCell}
              <td class="td-action">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    wrap.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (dashSort.col === col) {
          dashSort.dir = dashSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          dashSort = { col, dir: 'asc' };
        }
        renderTable();
      });
    });

    wrap.querySelectorAll('.cadet-row').forEach(row => {
      const open = () => go('cadet', { cadetId: Number(row.dataset.id) });
      row.addEventListener('click', open);
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
    });
  }

  search.addEventListener('input', () => load(search.value.trim()));
  el('add-cadet-btn').addEventListener('click', showAddCadetModal);
  load('');
}

// ── Cadet Detail ──────────────────────────────────────────────────────────────
async function renderCadet() {
  const main = el('main-content');
  const cadet = await window.api.cadets.get(state.cadetId);
  if (!cadet) { go('dashboard'); return; }

  main.innerHTML = `
    <button class="back-link" id="back-btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      All Cadets
    </button>
    <div class="cadet-detail-header">
      <div>
        <div class="cadet-detail-name">
          ${cadet.rank ? rankBadge(cadet.rank, true) + ' ' : ''}${esc(cadet.name)}
        </div>
        ${cadet.classification ? `<div style="color:var(--text-muted);font-size:14px;margin-top:4px">${esc(cadet.classification)}</div>` : ''}
      </div>
      <div class="cadet-detail-actions">
        <button class="btn btn-ghost btn-sm" id="rename-btn">Edit Details</button>
        <button class="btn btn-ghost btn-sm" id="export-btn">Export Report</button>
        <button class="btn btn-secondary btn-sm" id="new-interview-btn">+ New Interview</button>
        <button class="btn btn-danger btn-sm" id="delete-cadet-btn">Delete Cadet</button>
      </div>
    </div>
    <div class="cadet-page-body">
      <div class="interview-list" id="interview-list"></div>
      <div class="cadet-sidebar">
        <div class="notes-section">
          <div class="notes-header">
            <h3>Notes</h3>
            <span class="notes-status" id="notes-status"></span>
          </div>
          <textarea id="cadet-notes" class="notes-textarea"
            placeholder="General notes about this cadet — welfare, progress, personal circumstances…"
            rows="6">${esc(cadet.notes || '')}</textarea>
        </div>
        <div class="promo-section">
          <div class="promo-header">
            <h3>Promotion History</h3>
            <button class="btn btn-ghost btn-sm" id="record-promo-btn">+ Record</button>
          </div>
          <div id="promo-list"><div class="loading-qa">Loading…</div></div>
        </div>
      </div>
    </div>
  `;

  el('back-btn').addEventListener('click', () => go('dashboard'));
  el('new-interview-btn').addEventListener('click', () => go('new-interview', { cadetId: cadet.id }));
  el('rename-btn').addEventListener('click', () => showEditCadetModal(cadet));
  el('delete-cadet-btn').addEventListener('click', () => showDeleteCadetModal(cadet));
  el('export-btn').addEventListener('click', () => printCadetReport(cadet));
  el('record-promo-btn').addEventListener('click', () => showPromotionModal(cadet));

  let notesTimer;
  el('cadet-notes').addEventListener('input', () => {
    el('notes-status').textContent = 'Unsaved…';
    el('notes-status').className = 'notes-status unsaved';
    clearTimeout(notesTimer);
    notesTimer = setTimeout(async () => {
      await window.api.cadets.saveNotes(cadet.id, el('cadet-notes').value);
      el('notes-status').textContent = 'Saved';
      el('notes-status').className = 'notes-status saved';
      setTimeout(() => {
        if (el('notes-status')) el('notes-status').textContent = '';
      }, 2000);
    }, 800);
  });

  await Promise.all([
    loadInterviewList(cadet.id),
    loadPromotionHistory(cadet.id),
  ]);
}

async function loadInterviewList(cadetId) {
  const list = el('interview-list');
  if (!list) return;
  const interviews = await window.api.interviews.list(cadetId);

  if (!interviews.length) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
        </svg>
        <p>No interviews recorded yet</p>
        <small>Click <strong>+ New Interview</strong> to add the first one</small>
      </div>`;
    return;
  }

  list.innerHTML = interviews.map(iv => `
    <div class="interview-row" data-id="${iv.id}">
      <div class="interview-row-header">
        <span class="interview-row-date">${fmt(iv.date)}</span>
        <span class="interview-row-meta">Interviewed by ${esc(iv.interviewer)} &middot; ${iv.question_count} question${iv.question_count !== 1 ? 's' : ''}</span>
        <div class="interview-row-actions">
          <button class="btn btn-ghost btn-sm view-btn" data-id="${iv.id}">View</button>
          <button class="btn btn-secondary btn-sm edit-interview-btn" data-id="${iv.id}" data-cadet="${iv.cadet_id || cadetId}">Edit</button>
          <button class="btn btn-danger btn-sm delete-interview-btn" data-id="${iv.id}">Delete</button>
        </div>
        <span class="interview-row-chevron">&#x25BE;</span>
      </div>
      <div class="interview-row-body" id="ib-${iv.id}">
        <div class="loading-qa">Loading…</div>
      </div>
    </div>`).join('');

  list.querySelectorAll('.interview-row-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const row = header.closest('.interview-row');
      const id = Number(row.dataset.id);
      const expanded = row.classList.toggle('expanded');
      if (expanded) loadQaPreview(id, row.querySelector('.interview-row-body'));
    });
  });

  list.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => go('view-interview', { interviewId: Number(btn.dataset.id) }));
  });

  list.querySelectorAll('.edit-interview-btn').forEach(btn => {
    btn.addEventListener('click', () => go('new-interview', { cadetId, editInterviewId: Number(btn.dataset.id) }));
  });

  list.querySelectorAll('.delete-interview-btn').forEach(btn => {
    btn.addEventListener('click', () => showDeleteInterviewModal(Number(btn.dataset.id), cadetId));
  });
}

async function loadQaPreview(interviewId, container) {
  if (container.querySelector('.qa-item')) return;
  const iv = await window.api.interviews.get(interviewId);
  if (!iv || !iv.questions.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No questions recorded.</p>';
    return;
  }
  container.innerHTML = iv.questions.map(q => `
    <div class="qa-item">
      <div class="qa-question">${esc(q.question)}</div>
      <div class="qa-answer${q.answer ? '' : ' empty'}">${q.answer ? esc(q.answer) : 'No answer recorded'}</div>
    </div>`).join('');
}

// ── New / Edit Interview ──────────────────────────────────────────────────────
async function renderNewInterview() {
  const main = el('main-content');
  const isEdit = Boolean(state.editInterviewId);
  const cadet  = await window.api.cadets.get(state.cadetId);
  if (!cadet) { go('dashboard'); return; }

  let existing = null;
  if (isEdit) {
    existing = await window.api.interviews.get(state.editInterviewId);
    if (!existing) { go('cadet', { cadetId: state.cadetId }); return; }
  }

  const ivDate        = isEdit ? existing.date        : today();
  const ivInterviewer = isEdit ? existing.interviewer : 'Sgt S Hinton';
  const pageTitle     = isEdit ? `Edit Interview — ${esc(cadet.name)}` : `New Interview — ${esc(cadet.name)}`;
  const saveLabel     = isEdit ? 'Update Interview' : 'Save Interview';

  let sidePanel = '';
  if (!isEdit) {
    const prevInterviews = await window.api.interviews.list(state.cadetId);
    const prevContent = prevInterviews.length
      ? prevInterviews.map(iv => `
          <div class="prev-interview-card" data-id="${iv.id}">
            <div class="prev-card-header">
              <div>
                <div class="prev-card-date">${fmt(iv.date)}</div>
                <div class="prev-card-interviewer">${esc(iv.interviewer)}</div>
              </div>
              <span class="prev-card-chevron">&#x25BE;</span>
            </div>
            <div class="prev-card-body" id="pcb-${iv.id}"><div class="loading-qa">Loading…</div></div>
          </div>`).join('')
      : '<p style="color:rgba(255,255,255,0.6);font-size:13px;padding:8px 0">No previous interviews on record.</p>';
    sidePanel = `
      <aside class="prev-interviews-panel">
        <div class="prev-panel-header">Previous Interviews</div>
        <div class="prev-panel-body">${prevContent}</div>
      </aside>`;
  }

  main.innerHTML = `
    <button class="back-link" id="back-btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      Back to ${esc(cadet.name)}
    </button>
    <div class="page-header"><h2>${pageTitle}</h2></div>
    <div class="new-interview-layout${isEdit ? ' edit-mode' : ''}">
      ${sidePanel}
      <div class="new-interview-form">
        <div class="form-row">
          <div class="form-group" id="fg-date">
            <label for="iv-date">Interview Date</label>
            <input type="date" id="iv-date" value="${ivDate}">
            <span class="field-error">Date is required</span>
          </div>
          <div class="form-group" id="fg-interviewer">
            <label for="iv-interviewer">Interviewer Name</label>
            <input type="text" id="iv-interviewer" value="${esc(ivInterviewer)}" autocomplete="off">
            <span class="field-error">Interviewer name is required</span>
          </div>
        </div>
        <div class="questions-section">
          <div class="questions-section-header">
            <h3>Questions &amp; Answers</h3>
            <div class="load-template-wrap" id="load-template-wrap">
              <select id="template-select" class="template-select">
                <option value="">Load a template…</option>
              </select>
            </div>
          </div>
          <div id="qa-list"></div>
          <button class="add-qa-btn" id="add-qa-btn">+ Add Question</button>
        </div>
        <div class="form-actions">
          <button class="btn btn-secondary" id="cancel-interview-btn">Cancel</button>
          <button class="btn btn-primary" id="save-interview-btn">${saveLabel}</button>
        </div>
      </div>
    </div>
  `;

  el('back-btn').addEventListener('click', () => go('cadet', { cadetId: cadet.id }));
  el('cancel-interview-btn').addEventListener('click', () => go('cadet', { cadetId: cadet.id }));
  el('add-qa-btn').addEventListener('click', () => addQaRow());
  el('save-interview-btn').addEventListener('click', saveInterview);

  (async () => {
    const templates = await window.api.templates.list();
    const sel = el('template-select');
    templates.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name + (t.is_default ? ' ★' : '');
      sel.appendChild(opt);
    });
    sel.addEventListener('change', async () => {
      if (!sel.value) return;
      const tmpl = await window.api.templates.get(Number(sel.value));
      sel.value = '';
      if (!tmpl || !tmpl.questions.length) return;
      el('qa-list').innerHTML = '';
      tmpl.questions.forEach(q => addQaRow(q.question, ''));
      showToast(`Loaded template: ${tmpl.name}`, 'success');
    });
  })();

  document.querySelectorAll('.prev-interview-card').forEach(card => {
    card.querySelector('.prev-card-header').addEventListener('click', async () => {
      const expanded = card.classList.toggle('expanded');
      if (expanded) {
        const body = card.querySelector('.prev-card-body');
        if (!body.querySelector('.qa-item')) {
          const iv = await window.api.interviews.get(Number(card.dataset.id));
          body.innerHTML = iv && iv.questions.length
            ? iv.questions.map(q => `
                <div class="qa-item">
                  <div class="qa-question">${esc(q.question)}</div>
                  <div class="qa-answer${q.answer ? '' : ' empty'}">${q.answer ? esc(q.answer) : 'No answer'}</div>
                </div>`).join('')
            : '<p style="font-size:12px;color:var(--text-muted)">No questions recorded.</p>';
        }
      }
    });
  });

  if (isEdit && existing.questions.length) {
    existing.questions.forEach(q => addQaRow(q.question, q.answer));
  } else {
    addQaRow();
  }
}

let qaCount = 0;
function addQaRow(prefillQuestion = '', prefillAnswer = '') {
  qaCount++;
  const div = document.createElement('div');
  div.className = 'qa-form-item';
  div.innerHTML = `
    <div class="form-group" style="margin-bottom:6px">
      <select class="sample-select">
        <option value="">&#x1F4CB; Choose a sample question, or type your own below…</option>
        ${SAMPLE_QUESTIONS_HTML}
      </select>
    </div>
    <div class="form-group" style="margin-bottom:8px">
      <textarea rows="2" placeholder="Question…" class="qa-question-input">${esc(prefillQuestion)}</textarea>
    </div>
    <div class="form-group">
      <textarea rows="3" placeholder="Answer (leave blank to fill in during interview)…" class="qa-answer-input">${esc(prefillAnswer)}</textarea>
    </div>
    <button class="btn-icon-only remove-qa" title="Remove question">&#x2715;</button>
  `;
  div.querySelector('.sample-select').addEventListener('change', (e) => {
    if (e.target.value) {
      div.querySelector('.qa-question-input').value = e.target.value;
      e.target.value = '';
      div.querySelector('.qa-question-input').focus();
    }
  });
  div.querySelector('.remove-qa').addEventListener('click', () => div.remove());
  el('qa-list').appendChild(div);
}

function renumberQas() { /* no-op: questions are unnumbered */ }

async function saveInterview() {
  let valid = true;

  const dateEl = el('iv-date');
  const fgDate = el('fg-date');
  if (!dateEl.value) { fgDate.classList.add('has-error'); valid = false; }
  else fgDate.classList.remove('has-error');

  const interviewerEl = el('iv-interviewer');
  const fgInt = el('fg-interviewer');
  if (!interviewerEl.value.trim()) { fgInt.classList.add('has-error'); valid = false; }
  else fgInt.classList.remove('has-error');

  if (!valid) return;

  const questions = Array.from(document.querySelectorAll('.qa-form-item')).map(item => ({
    question: item.querySelector('.qa-question-input').value,
    answer:   item.querySelector('.qa-answer-input').value,
  })).filter(q => q.question.trim());

  const btn = el('save-interview-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  let result;
  if (state.editInterviewId) {
    result = await window.api.interviews.update({
      id:          state.editInterviewId,
      interviewer: interviewerEl.value.trim(),
      date:        dateEl.value,
      questions,
    });
    btn.disabled = false;
    btn.textContent = 'Update Interview';
    if (result.success) {
      showToast('Interview updated', 'success');
      go('view-interview', { interviewId: state.editInterviewId });
    }
  } else {
    result = await window.api.interviews.add({
      cadetId:     state.cadetId,
      interviewer: interviewerEl.value.trim(),
      date:        dateEl.value,
      questions,
    });
    btn.disabled = false;
    btn.textContent = 'Save Interview';
    if (result.success) {
      showToast('Interview saved', 'success');
      go('view-interview', { interviewId: result.id });
    }
  }
}

// ── View Interview ────────────────────────────────────────────────────────────
async function renderViewInterview() {
  const main = el('main-content');
  const iv = await window.api.interviews.get(state.interviewId);
  if (!iv) { go('dashboard'); return; }

  main.innerHTML = `
    <button class="back-link" id="back-btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      Back to ${esc(iv.cadet_name)}
    </button>
    <div class="page-header">
      <div>
        <h2>${esc(iv.cadet_name)}</h2>
        <p style="color:var(--text-muted);font-size:14px;margin-top:4px">
          ${fmt(iv.date)} &middot; Interviewed by ${esc(iv.interviewer)}
        </p>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary" id="edit-btn">Edit</button>
        <button class="btn btn-primary" id="print-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 6 2 18 2 18 9"/>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
          Print / Save PDF
        </button>
      </div>
    </div>

    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:24px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;background:#f0f4f9;border:1px solid #c0c8d8;border-radius:4px;padding:14px 18px;margin-bottom:24px;font-size:14px">
        <div><strong style="color:var(--raf-blue)">Cadet:</strong> ${esc(iv.cadet_name)}</div>
        <div><strong style="color:var(--raf-blue)">Date:</strong> ${fmt(iv.date)}</div>
        <div><strong style="color:var(--raf-blue)">Interviewer:</strong> ${esc(iv.interviewer)}</div>
        <div><strong style="color:var(--raf-blue)">Questions:</strong> ${iv.questions.length}</div>
      </div>
      ${iv.questions.map((q, i) => `
        <div class="qa-item" style="margin-bottom:20px;padding-bottom:20px;${i < iv.questions.length - 1 ? 'border-bottom:1px solid var(--border)' : ''}">
          <div class="qa-question" style="font-size:15px">${esc(q.question)}</div>
          <div class="qa-answer${q.answer ? '' : ' empty'}" style="margin-top:6px;font-size:14px">
            ${q.answer ? esc(q.answer) : 'No answer recorded'}
          </div>
        </div>`).join('')}
    </div>
  `;

  el('back-btn').addEventListener('click', () => go('cadet', { cadetId: iv.cadet_id }));
  el('edit-btn').addEventListener('click', () => go('new-interview', { cadetId: iv.cadet_id, editInterviewId: iv.id }));
  el('print-btn').addEventListener('click', () => printInterview(iv));
}

function printInterview(iv) {
  const printArea = el('print-area');
  printArea.innerHTML = `
    <div class="print-header">
      <div class="print-rafac-badge"></div>
      <div class="print-org">
        <span class="print-org-name">RAFAC</span>
        <span class="print-org-sub">Royal Air Force Air Cadets</span>
      </div>
      <div class="print-title">Cadet Interview Record</div>
    </div>
    <div class="print-meta">
      <div class="print-meta-row"><span class="print-meta-label">Cadet:</span><span>${esc(iv.cadet_name)}</span></div>
      <div class="print-meta-row"><span class="print-meta-label">Date:</span><span>${fmt(iv.date)}</span></div>
      <div class="print-meta-row"><span class="print-meta-label">Interviewer:</span><span>${esc(iv.interviewer)}</span></div>
      <div class="print-meta-row"><span class="print-meta-label">Questions:</span><span>${iv.questions.length}</span></div>
    </div>
    <div class="print-questions">
      ${iv.questions.map(q => `
        <div class="print-qa">
          <div class="print-question">${esc(q.question)}</div>
          <div class="print-answer${q.answer ? '' : ' empty'}">${q.answer ? esc(q.answer) : 'No answer recorded'}</div>
        </div>`).join('')}
    </div>
    <div class="print-footer">
      <span>RAFAC — Cadet Interview Record</span>
      <span>Printed: ${fmt(today())}</span>
    </div>
  `;
  window.print();
}

// ── Print Cadet Report ────────────────────────────────────────────────────────
async function printCadetReport(cadet) {
  const interviews = await window.api.interviews.list(cadet.id);
  const fullInterviews = await Promise.all(
    interviews.map(iv => window.api.interviews.get(iv.id))
  );

  el('print-area').innerHTML = `
    <div class="print-header">
      <div class="print-rafac-badge"></div>
      <div class="print-org">
        <span class="print-org-name">RAFAC</span>
        <span class="print-org-sub">Royal Air Force Air Cadets</span>
      </div>
      <div class="print-title">Cadet Record — ${esc(cadet.name)}</div>
    </div>
    <div class="print-meta">
      <div class="print-meta-row"><span class="print-meta-label">Cadet:</span><span>${esc(cadet.name)}</span></div>
      <div class="print-meta-row"><span class="print-meta-label">Rank:</span><span>${esc(cadet.rank || '—')}</span></div>
      <div class="print-meta-row"><span class="print-meta-label">Classification:</span><span>${esc(cadet.classification || '—')}</span></div>
      <div class="print-meta-row"><span class="print-meta-label">Interviews:</span><span>${interviews.length}</span></div>
    </div>
    ${cadet.notes ? `<div class="print-notes"><strong>Notes:</strong> ${esc(cadet.notes)}</div>` : ''}
    <div class="print-questions">
      ${fullInterviews.map(iv => `
        <div class="print-interview-block">
          <div class="print-interview-heading">${fmt(iv.date)} — Interviewed by ${esc(iv.interviewer)}</div>
          ${iv.questions.map(q => `
            <div class="print-qa">
              <div class="print-question">${esc(q.question)}</div>
              <div class="print-answer${q.answer ? '' : ' empty'}">${q.answer ? esc(q.answer) : 'No answer recorded'}</div>
            </div>`).join('')}
        </div>`).join('')}
    </div>
    <div class="print-footer">
      <span>RAFAC — Cadet Record: ${esc(cadet.name)}</span>
      <span>Printed: ${fmt(today())}</span>
    </div>
  `;
  window.print();
}

// ── Promotion History ─────────────────────────────────────────────────────────
async function loadPromotionHistory(cadetId) {
  const list = el('promo-list');
  if (!list) return;
  const promos = await window.api.promotions.list(cadetId);

  if (!promos.length) {
    list.innerHTML = '<p class="promo-empty">No promotions recorded yet.</p>';
    return;
  }

  list.innerHTML = promos.map(p => {
    const rankChange  = p.from_rank  !== p.to_rank  && (p.from_rank  || p.to_rank);
    const classChange = p.from_classification !== p.to_classification && (p.from_classification || p.to_classification);
    return `
      <div class="promo-entry">
        <div class="promo-entry-date">${fmt(p.date)}</div>
        <div class="promo-entry-detail">
          ${rankChange  ? `<div>${esc(p.from_rank  || '—')} → <strong>${esc(p.to_rank  || '—')}</strong></div>` : ''}
          ${classChange ? `<div>${esc(p.from_classification || '—')} → <strong>${esc(p.to_classification || '—')}</strong></div>` : ''}
          ${p.notes ? `<div class="promo-entry-notes">${esc(p.notes)}</div>` : ''}
        </div>
        <button class="btn-icon-only promo-delete-btn" data-id="${p.id}" title="Delete">&#x2715;</button>
      </div>`;
  }).join('');

  list.querySelectorAll('.promo-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await window.api.promotions.delete(Number(btn.dataset.id));
      await loadPromotionHistory(cadetId);
    });
  });
}

// ── Templates ─────────────────────────────────────────────────────────────────
async function renderTemplates() {
  const main = el('main-content');
  const templates = await window.api.templates.list();

  main.innerHTML = `
    <button class="back-link" id="back-btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      All Cadets
    </button>
    <div class="page-header">
      <h2>Interview Templates</h2>
      <button class="btn btn-primary" id="new-template-btn">+ New Template</button>
    </div>
    <div class="template-list">
      ${templates.length ? templates.map(t => `
        <div class="template-row">
          <div class="template-row-name">
            ${esc(t.name)}
            ${t.is_default ? '<span class="template-default-badge">Default</span>' : ''}
          </div>
          <div class="template-row-actions">
            <button class="btn btn-ghost btn-sm tpl-edit-btn" data-id="${t.id}">Edit</button>
            ${!t.is_default ? `<button class="btn btn-danger btn-sm tpl-delete-btn" data-id="${t.id}">Delete</button>` : ''}
          </div>
        </div>`).join('') : '<p style="color:var(--text-muted);padding:24px">No templates yet.</p>'}
    </div>
  `;

  el('back-btn').addEventListener('click', () => go('dashboard'));
  el('new-template-btn').addEventListener('click', () => go('edit-template', { editTemplateId: null }));

  main.querySelectorAll('.tpl-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => go('edit-template', { editTemplateId: Number(btn.dataset.id) }));
  });
  main.querySelectorAll('.tpl-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this template?')) return;
      await window.api.templates.delete(Number(btn.dataset.id));
      renderTemplates();
    });
  });
}

async function renderEditTemplate() {
  const main = el('main-content');
  const isNew = !state.editTemplateId;
  let tmpl = null;
  if (!isNew) {
    tmpl = await window.api.templates.get(state.editTemplateId);
    if (!tmpl) { go('templates'); return; }
  }

  main.innerHTML = `
    <button class="back-link" id="back-btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      Back to Templates
    </button>
    <div class="page-header"><h2>${isNew ? 'New Template' : `Edit: ${esc(tmpl.name)}`}</h2></div>
    <div class="new-interview-form" style="max-width:640px">
      <div class="form-group" id="fg-tpl-name" style="margin-bottom:20px">
        <label for="tpl-name">Template Name</label>
        <input type="text" id="tpl-name" value="${isNew ? '' : esc(tmpl.name)}" placeholder="e.g. Promotion Consideration" maxlength="100" autocomplete="off">
        <span class="field-error">Name is required</span>
      </div>
      <div class="questions-section">
        <h3>Questions</h3>
        <div id="tpl-qa-list"></div>
        <button class="add-qa-btn" id="tpl-add-btn">+ Add Question</button>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" id="tpl-cancel-btn">Cancel</button>
        <button class="btn btn-primary" id="tpl-save-btn">${isNew ? 'Create Template' : 'Save Template'}</button>
      </div>
    </div>
  `;

  el('back-btn').addEventListener('click', () => go('templates'));
  el('tpl-cancel-btn').addEventListener('click', () => go('templates'));

  function addTplRow(question = '') {
    const div = document.createElement('div');
    div.className = 'qa-form-item';
    div.innerHTML = `
      <div class="form-group" style="margin-bottom:6px">
        <select class="sample-select">
          <option value="">&#x1F4CB; Choose a sample question, or type your own below…</option>
          ${SAMPLE_QUESTIONS_HTML}
        </select>
      </div>
      <div class="form-group">
        <textarea rows="2" placeholder="Question…" class="tpl-question-input">${esc(question)}</textarea>
      </div>
      <button class="btn-icon-only remove-qa" title="Remove">&#x2715;</button>
    `;
    div.querySelector('.sample-select').addEventListener('change', (e) => {
      if (e.target.value) {
        div.querySelector('.tpl-question-input').value = e.target.value;
        e.target.value = '';
        div.querySelector('.tpl-question-input').focus();
      }
    });
    div.querySelector('.remove-qa').addEventListener('click', () => div.remove());
    el('tpl-qa-list').appendChild(div);
  }

  if (tmpl && tmpl.questions.length) {
    tmpl.questions.forEach(q => addTplRow(q.question));
  } else {
    addTplRow();
  }

  el('tpl-add-btn').addEventListener('click', () => addTplRow());

  el('tpl-save-btn').addEventListener('click', async () => {
    const nameEl = el('tpl-name');
    const fg = el('fg-tpl-name');
    if (!nameEl.value.trim()) { fg.classList.add('has-error'); return; }
    fg.classList.remove('has-error');

    const questions = Array.from(document.querySelectorAll('.tpl-question-input'))
      .map(ta => ta.value.trim())
      .filter(Boolean);

    const btn = el('tpl-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';

    const result = await window.api.templates.save({
      id:        isNew ? null : state.editTemplateId,
      name:      nameEl.value.trim(),
      questions,
    });

    if (result.success) {
      showToast(isNew ? 'Template created' : 'Template saved', 'success');
      go('templates');
    } else {
      btn.disabled = false;
      btn.textContent = isNew ? 'Create Template' : 'Save Template';
    }
  });
}

// ── Modals ────────────────────────────────────────────────────────────────────
function showModal(html, onClose) {
  el('modal-box').innerHTML = html;
  el('modal-overlay').classList.remove('hidden');
  el('modal-backdrop').onclick = () => closeModal(onClose);
  const first = el('modal-box').querySelector('input');
  if (first) setTimeout(() => first.focus(), 50);
}

function closeModal(onClose) {
  el('modal-overlay').classList.add('hidden');
  if (onClose) onClose();
}

function showAddCadetModal() {
  showModal(`
    <h3>Add New Cadet</h3>
    <div class="form-group" id="fg-name" style="margin-bottom:12px">
      <label for="cadet-name-input">Full Name</label>
      <input type="text" id="cadet-name-input" placeholder="e.g. J Smith" autocomplete="off" maxlength="100">
      <span class="field-error">Name is required</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:4px">
      <div class="form-group">
        <label for="cadet-rank-input">Rank</label>
        <select id="cadet-rank-input">${rankOptions('')}</select>
      </div>
      <div class="form-group">
        <label for="cadet-class-input">Classification</label>
        <select id="cadet-class-input">${classOptions('')}</select>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Add Cadet</button>
    </div>
  `);

  el('modal-cancel').addEventListener('click', () => closeModal());
  el('modal-save').addEventListener('click', async () => {
    const nameEl = el('cadet-name-input');
    const fg = el('fg-name');
    if (!nameEl.value.trim()) { fg.classList.add('has-error'); return; }
    fg.classList.remove('has-error');
    const cadet = await window.api.cadets.add({
      name:           nameEl.value,
      rank:           el('cadet-rank-input').value,
      classification: el('cadet-class-input').value,
    });
    closeModal(() => {
      showToast(`${cadet.name} added`, 'success');
      go('cadet', { cadetId: cadet.id });
    });
  });

  el('cadet-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') el('modal-save').click();
  });
}

function showEditCadetModal(cadet) {
  showModal(`
    <h3>Edit Cadet Details</h3>
    <div class="form-group" id="fg-rename" style="margin-bottom:12px">
      <label for="rename-input">Full Name</label>
      <input type="text" id="rename-input" value="${esc(cadet.name)}" maxlength="100" autocomplete="off">
      <span class="field-error">Name is required</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="form-group">
        <label for="edit-rank-input">Rank</label>
        <select id="edit-rank-input">${rankOptions(cadet.rank || '')}</select>
      </div>
      <div class="form-group">
        <label for="edit-class-input">Classification</label>
        <select id="edit-class-input">${classOptions(cadet.classification || '')}</select>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:4px">
      <label for="edit-next-interview">Next Interview Date</label>
      <input type="date" id="edit-next-interview" value="${esc(cadet.next_interview_date || '')}">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Save</button>
    </div>
  `);

  el('modal-cancel').addEventListener('click', () => closeModal());
  el('modal-save').addEventListener('click', async () => {
    const input = el('rename-input');
    const fg = el('fg-rename');
    if (!input.value.trim()) { fg.classList.add('has-error'); return; }
    fg.classList.remove('has-error');
    await window.api.cadets.update(cadet.id, {
      name:                input.value,
      rank:                el('edit-rank-input').value,
      classification:      el('edit-class-input').value,
      next_interview_date: el('edit-next-interview').value,
    });
    closeModal(() => {
      showToast('Cadet updated', 'success');
      renderCadet();
    });
  });

  el('rename-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') el('modal-save').click();
  });
}

function showDeleteCadetModal(cadet) {
  showModal(`
    <h3>Delete Cadet</h3>
    <p style="color:var(--text-muted);margin-bottom:8px">
      Are you sure you want to delete <strong>${esc(cadet.name)}</strong>?
    </p>
    <p style="color:var(--error);font-size:13px">
      This will permanently delete all interviews for this cadet and cannot be undone.
    </p>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-danger" id="modal-delete">Delete Cadet</button>
    </div>
  `);

  el('modal-cancel').addEventListener('click', () => closeModal());
  el('modal-delete').addEventListener('click', async () => {
    await window.api.cadets.delete(cadet.id);
    closeModal(() => {
      showToast(`${cadet.name} deleted`);
      go('dashboard');
    });
  });
}

function showDeleteInterviewModal(interviewId, cadetId) {
  showModal(`
    <h3>Delete Interview</h3>
    <p style="color:var(--text-muted);margin-bottom:8px">
      Are you sure you want to delete this interview record?
    </p>
    <p style="color:var(--error);font-size:13px">This cannot be undone.</p>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-danger" id="modal-delete">Delete Interview</button>
    </div>
  `);

  el('modal-cancel').addEventListener('click', () => closeModal());
  el('modal-delete').addEventListener('click', async () => {
    await window.api.interviews.delete(interviewId);
    closeModal(async () => {
      showToast('Interview deleted');
      await loadInterviewList(cadetId);
    });
  });
}

function showPromotionModal(cadet) {
  showModal(`
    <h3>Record Promotion</h3>
    <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">
      Current: ${cadet.rank ? `<strong>${esc(cadet.rank)}</strong>` : '(no rank)'} /
      ${cadet.classification ? `<strong>${esc(cadet.classification)}</strong>` : '(no classification)'}
    </p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
      <div class="form-group">
        <label>New Rank</label>
        <select id="promo-rank">${rankOptions(cadet.rank || '')}</select>
      </div>
      <div class="form-group">
        <label>New Classification</label>
        <select id="promo-class">${classOptions(cadet.classification || '')}</select>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label for="promo-date">Date</label>
      <input type="date" id="promo-date" value="${today()}">
    </div>
    <div class="form-group" style="margin-bottom:4px">
      <label for="promo-notes">Notes (optional)</label>
      <textarea id="promo-notes" rows="2" placeholder="e.g. Promoted at summer camp"></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Record</button>
    </div>
  `);

  el('modal-cancel').addEventListener('click', () => closeModal());
  el('modal-save').addEventListener('click', async () => {
    const date = el('promo-date').value;
    if (!date) { showToast('Date is required', ''); return; }
    const toRank = el('promo-rank').value;
    const toCls  = el('promo-class').value;
    if (!toRank && !toCls) { showToast('Select at least one change', ''); return; }

    await window.api.promotions.add({
      cadetId:            cadet.id,
      fromRank:           cadet.rank || '',
      toRank,
      fromClassification: cadet.classification || '',
      toClassification:   toCls,
      date,
      notes: el('promo-notes').value.trim(),
    });
    closeModal(() => {
      showToast('Promotion recorded', 'success');
      go('cadet', { cadetId: cadet.id });
    });
  });
}

function showSettingsModal() {
  showModal(`
    <h3>Settings</h3>
    <div class="settings-section">
      <div class="settings-section-title">Change PIN</div>
      <div class="form-group" style="margin-bottom:10px">
        <label for="cur-pin">Current PIN</label>
        <input type="password" id="cur-pin" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="••••">
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label for="new-pin">New PIN</label>
        <input type="password" id="new-pin" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="••••">
      </div>
      <div class="form-group">
        <label for="confirm-pin">Confirm New PIN</label>
        <input type="password" id="confirm-pin" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="••••">
      </div>
      <p class="modal-error" id="pin-change-err"></p>
      <div style="margin-top:12px">
        <button class="btn btn-primary btn-sm" id="modal-save-pin">Change PIN</button>
      </div>
    </div>
    <div class="settings-section" style="margin-top:20px">
      <div class="settings-section-title">Backup &amp; Restore</div>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
        Save a copy of all data, or restore from a previous backup.
      </p>
      <div style="display:flex;gap:10px">
        <button class="btn btn-secondary btn-sm" id="backup-save-btn">Save Backup…</button>
        <button class="btn btn-secondary btn-sm" id="backup-restore-btn">Restore Backup…</button>
      </div>
    </div>
    <div class="modal-actions" style="margin-top:20px">
      <button class="btn btn-secondary" id="modal-cancel">Close</button>
    </div>
  `);

  el('modal-cancel').addEventListener('click', () => closeModal());

  el('modal-save-pin').addEventListener('click', async () => {
    const cur = el('cur-pin').value;
    const nw  = el('new-pin').value;
    const cf  = el('confirm-pin').value;
    const err = el('pin-change-err');

    if (!cur || !nw || !cf)    { err.textContent = 'All fields are required.'; return; }
    if (!/^\d{4}$/.test(nw))   { err.textContent = 'PIN must be exactly 4 digits.'; return; }
    if (nw !== cf)              { err.textContent = 'New PINs do not match.'; return; }

    const result = await window.api.auth.change(cur, nw);
    if (!result.success) { err.textContent = result.message; return; }
    closeModal(() => showToast('PIN changed successfully', 'success'));
  });

  el('backup-save-btn').addEventListener('click', async () => {
    const result = await window.api.backup.save();
    if (result.success) showToast('Backup saved', 'success');
  });

  el('backup-restore-btn').addEventListener('click', async () => {
    if (!confirm('Restoring a backup will replace all current data and restart the app. Continue?')) return;
    await window.api.backup.restore();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initPinScreen();

  el('btn-lock').addEventListener('click', lockApp);
  el('btn-settings').addEventListener('click', showSettingsModal);
  el('btn-templates').addEventListener('click', () => go('templates'));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !el('modal-overlay').classList.contains('hidden')) {
      closeModal();
    }
  });
});
