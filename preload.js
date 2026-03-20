const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  auth: {
    verify:  (pin)               => ipcRenderer.invoke('auth:verify', pin),
    change:  (currentPin, newPin) => ipcRenderer.invoke('auth:change', { currentPin, newPin }),
  },
  cadets: {
    search: (query) => ipcRenderer.invoke('cadets:search', query),
    add:    (data)  => ipcRenderer.invoke('cadets:add', data),
    get:    (id)    => ipcRenderer.invoke('cadets:get', id),
    update:     (id, data)  => ipcRenderer.invoke('cadets:update', { id, ...data }),
    saveNotes:  (id, notes) => ipcRenderer.invoke('cadets:save-notes', { id, notes }),
    delete: (id)    => ipcRenderer.invoke('cadets:delete', id),
  },
  interviews: {
    list:   (cadetId) => ipcRenderer.invoke('interviews:list', cadetId),
    get:    (id)      => ipcRenderer.invoke('interviews:get', id),
    add:    (data)    => ipcRenderer.invoke('interviews:add', data),
    update: (data)    => ipcRenderer.invoke('interviews:update', data),
    delete: (id)      => ipcRenderer.invoke('interviews:delete', id),
  },
  print: {
    dialog: () => ipcRenderer.invoke('print:dialog'),
  },
  stats: {
    get: () => ipcRenderer.invoke('stats:get'),
  },
  templates: {
    list:   ()       => ipcRenderer.invoke('templates:list'),
    get:    (id)     => ipcRenderer.invoke('templates:get', id),
    save:   (data)   => ipcRenderer.invoke('templates:save', data),
    delete: (id)     => ipcRenderer.invoke('templates:delete', id),
  },
  promotions: {
    list:   (cadetId) => ipcRenderer.invoke('promotions:list', cadetId),
    add:    (data)    => ipcRenderer.invoke('promotions:add', data),
    delete: (id)      => ipcRenderer.invoke('promotions:delete', id),
  },
  backup: {
    save:    () => ipcRenderer.invoke('backup:save'),
    restore: () => ipcRenderer.invoke('backup:restore'),
  },
});
