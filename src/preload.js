const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize:  () => ipcRenderer.send('win:minimize'),
  maximize:  () => ipcRenderer.send('win:maximize'),
  close:     () => ipcRenderer.send('win:close'),

  // Dialogs
  openAudio:   () => ipcRenderer.invoke('dialog:open-audio'),
  saveExport:  (name) => ipcRenderer.invoke('dialog:save-export', name),

  // File system
  writeFile:   (filePath, content) => ipcRenderer.invoke('fs:write', filePath, content),
  readAudio:   (filePath) => ipcRenderer.invoke('fs:read-audio', filePath),
});