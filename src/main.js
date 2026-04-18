const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    frame: false,
    backgroundColor: '#090e18',
    icon: path.resolve(__dirname, "../assets/favicon.ico"),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'index.html'));
  // devtools removed
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── Window controls ───────────────────────────────────────────────────────────
ipcMain.on('win:minimize', () => win.minimize());
ipcMain.on('win:maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.on('win:close',    () => win.close());

// ── Open audio file ───────────────────────────────────────────────────────────
ipcMain.handle('dialog:open-audio', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Load Song',
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ── Save export file ──────────────────────────────────────────────────────────
ipcMain.handle('dialog:save-export', async (_, defaultName) => {
  const result = await dialog.showSaveDialog(win, {
    title: 'Export Lyrics',
    defaultPath: defaultName || 'lyrics.srt',
    filters: [
      { name: 'SRT Subtitles', extensions: ['srt'] },
      { name: 'LRC Lyrics',    extensions: ['lrc'] },
      { name: 'ASS/SSA',       extensions: ['ass'] },
      { name: 'JSON',          extensions: ['json'] },
      { name: 'Plain Text',    extensions: ['txt'] },
    ],
  });
  return result.canceled ? null : result.filePath;
});

// ── Write file ────────────────────────────────────────────────────────────────
ipcMain.handle('fs:write', async (_, filePath, content) => {
  try { fs.writeFileSync(filePath, content, 'utf-8'); return true; }
  catch (e) { console.error(e); return false; }
});

// ── Read file as base64 (for WaveSurfer) ─────────────────────────────────────
ipcMain.handle('fs:read-audio', async (_, filePath) => {
  try {
    const buf  = fs.readFileSync(filePath);
    const ext  = path.extname(filePath).slice(1).toLowerCase();
    const mime = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac',
                   ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac' }[ext] || 'audio/mpeg';
    return { base64: buf.toString('base64'), mime, name: path.basename(filePath), ext };
  } catch (e) { console.error(e); return null; }
});