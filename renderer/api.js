'use strict';

// Drop-in replacement for the Electron preload's window.api, using fetch() instead of IPC.
(function () {
  async function apiFetch(url, opts) {
    const r = await fetch(url, { credentials: 'same-origin', ...opts });
    if (r.status === 401) {
      document.dispatchEvent(new CustomEvent('api:unauthorized'));
      return null;
    }
    return r.json();
  }

  const post  = (url, body) => apiFetch(url, { method: 'POST',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const put   = (url, body) => apiFetch(url, { method: 'PUT',   headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const patch = (url, body) => apiFetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const del   = (url)       => apiFetch(url, { method: 'DELETE' });

  window.api = {
    auth: {
      verify: (pin)                   => post('/api/auth/verify', { pin }),
      change: (currentPin, newPin)    => post('/api/auth/change', { currentPin, newPin }),
    },
    cadets: {
      search:    (q)       => apiFetch(`/api/cadets?q=${encodeURIComponent(q || '')}`),
      add:       (data)    => post('/api/cadets', data),
      get:       (id)      => apiFetch(`/api/cadets/${id}`),
      update:    (id, data) => put(`/api/cadets/${id}`, data),
      saveNotes: (id, notes) => patch(`/api/cadets/${id}/notes`, { notes }),
      delete:    (id)      => del(`/api/cadets/${id}`),
    },
    interviews: {
      list:   (cadetId) => apiFetch(`/api/cadets/${cadetId}/interviews`),
      get:    (id)      => apiFetch(`/api/interviews/${id}`),
      add:    (data)    => post('/api/interviews', data),
      update: (data)    => put(`/api/interviews/${data.id}`, data),
      delete: (id)      => del(`/api/interviews/${id}`),
    },
    stats: {
      get: () => apiFetch('/api/stats'),
    },
    templates: {
      list:   ()     => apiFetch('/api/templates'),
      get:    (id)   => apiFetch(`/api/templates/${id}`),
      save:   (data) => post('/api/templates', data),
      delete: (id)   => del(`/api/templates/${id}`),
    },
    promotions: {
      list:   (cadetId) => apiFetch(`/api/cadets/${cadetId}/promotions`),
      add:    (data)    => post('/api/promotions', data),
      delete: (id)      => del(`/api/promotions/${id}`),
    },
    backup: {
      save: () => {
        const date = new Date().toISOString().slice(0, 10);
        const a = document.createElement('a');
        a.href = '/api/backup/download';
        a.download = `cadet-interviews-backup-${date}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return Promise.resolve({ success: true });
      },
      restore: () => new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async () => {
          if (!input.files.length) { resolve({ success: false }); return; }
          const text = await input.files[0].text();
          let data;
          try { data = JSON.parse(text); } catch {
            alert('Invalid backup file — could not parse JSON.');
            resolve({ success: false });
            return;
          }
          const result = await post('/api/backup/restore', data);
          if (result && result.success) {
            setTimeout(() => window.location.reload(), 500);
          } else if (result) {
            alert(`Restore failed: ${result.message}`);
          }
          resolve(result || { success: false });
        };
        input.click();
      }),
    },
  };

  // If session expires mid-use, show the lock screen
  document.addEventListener('api:unauthorized', () => {
    const appEl  = document.getElementById('app');
    const lockEl = document.getElementById('lock-screen');
    if (appEl)  appEl.classList.add('hidden');
    if (lockEl) lockEl.classList.remove('hidden');
  });
})();
