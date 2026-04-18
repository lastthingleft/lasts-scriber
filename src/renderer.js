/* renderer.js */

// ── State ─────────────────────────────────────────────────────────────────────
let ws           = null;
let lyrics       = [];        // [{ id, time, text }]
let songDuration = 0;
let songPath     = null;
let rate         = 1.0;
let zoomLevel    = 1;         // pixels-per-second zoom factor

const MIN_RATE  = 0.25;
const MAX_RATE  = 3.00;
const RATE_STEP = 0.25;
const MIN_ZOOM  = 1;
const MAX_ZOOM  = 300;

// ── Helpers ───────────────────────────────────────────────────────────────────
const $   = id => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 9);

function fmt(s, precise = false) {
  if (!s || isNaN(s) || s < 0) s = 0;
  const m  = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  if (precise) return `${p2(m)}:${p2(ss)}:${String(ms).padStart(3,'0')}`;
  return `${m}:${p2(ss)}`;
}

function p2(n) { return String(n).padStart(2,'0'); }
function now() { return ws ? ws.getCurrentTime() : 0; }

// Format seconds as SRT timestamp: HH:MM:SS,mmm
function fmtSRT(s) {
  if (!s || isNaN(s) || s < 0) s = 0;
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  return `${p2(h)}:${p2(m)}:${p2(ss)},${String(ms).padStart(3,'0')}`;
}

// Format seconds as LRC timestamp: mm:ss.xx
function fmtLRC(s) {
  if (!s || isNaN(s) || s < 0) s = 0;
  const m  = Math.floor(s / 60);
  const sc = (s % 60).toFixed(2);
  return `${p2(m)}:${String(sc).padStart(5,'0')}`;
}

// ── DOM ───────────────────────────────────────────────────────────────────────
const waveWrap   = $('wave-wrap');
const waveEmpty  = $('wave-empty');
const tCur       = $('t-cur');
const tTot       = $('t-tot');
const metaTitle  = $('r-title');
const metaDur    = $('r-dur');
const tsVal      = $('ts-val');
const lyricsList = $('lyrics-list');
const lyricsHint = $('lyrics-hint');
const lyricCount = $('lyric-count');
const speedVal   = $('speed-val');
const speedFill  = $('speed-fill');
const exportMenu = $('export-menu');

// ── Window controls ───────────────────────────────────────────────────────────
$('tl-min').addEventListener('click',   () => window.api.minimize());
$('tl-max').addEventListener('click',   () => window.api.maximize());
$('tl-close').addEventListener('click', () => window.api.close());

// ── Load song ─────────────────────────────────────────────────────────────────
$('btn-load').addEventListener('click', async () => {
  const fp = await window.api.openAudio();
  if (!fp) return;

  songPath = fp;
  const name = fp.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  $('song-label').textContent = fp.split(/[\\/]/).pop();
  metaTitle.textContent = name;
  lyrics = [];
  renderLyrics();

  const audio = await window.api.readAudio(fp);
  if (!audio) { toast('could not read file', 'error'); return; }

  const bytes = Uint8Array.from(atob(audio.base64), c => c.charCodeAt(0));
  const blob  = new Blob([bytes], { type: audio.mime });
  const url   = URL.createObjectURL(blob);
  initWS(url, name);
});

// ── WaveSurfer ────────────────────────────────────────────────────────────────
function initWS(url) {
  if (ws) { ws.destroy(); ws = null; }
  waveEmpty.style.display = 'none';
  zoomLevel = 1;

  ws = WaveSurfer.create({
    container:     '#waveform',
    waveColor:     'rgba(58, 100, 160, 0.45)',
    progressColor: 'rgba(80, 130, 200, 0.85)',
    cursorColor:   'rgba(100, 150, 220, 0.7)',
    cursorWidth:   1,
    barWidth:      2,
    barGap:        1,
    barRadius:     2,
    height:        'auto',
    normalize:     true,
    interact:      true,
  });

  ws.load(url);

  ws.on('ready', () => {
    songDuration = ws.getDuration();
    tTot.textContent    = fmt(songDuration);
    metaDur.textContent = fmt(songDuration);
    ws.setPlaybackRate(rate);
    updateTS(0);
    waveWrap.classList.add('has-audio');
  });

  ws.on('audioprocess', updateTS);
  ws.on('seek',   p  => updateTS(p * songDuration));
  ws.on('play',   () => setPS(true));
  ws.on('pause',  () => setPS(false));
  ws.on('finish', () => setPS(false));
}

function updateTS(t) {
  tCur.textContent = fmt(t);
  tsVal.textContent = fmt(t, true);
  highlightActive(t);
}

function setPS(playing) {
  $('ico-play').style.display  = playing ? 'none'  : 'block';
  $('ico-pause').style.display = playing ? 'block' : 'none';
  $('btn-play').classList.toggle('is-playing', playing);
}

// ── Ctrl+Scroll Zoom ──────────────────────────────────────────────────────────
waveWrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!ws || !songDuration) return;

  if (e.ctrlKey) {
    const factor  = e.deltaY > 0 ? 1 / 1.35 : 1.35;
    zoomLevel     = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel * factor));
    ws.zoom(zoomLevel);
    return;
  }

  if (zoomLevel > 1) {
    // Zoomed in: pan the waveform view, don't move the playhead.
    const wrapper = ws.getWrapper?.();
    if (wrapper) {
      const sensitivity = e.shiftKey ? 0.3 : 1;
      wrapper.scrollLeft += e.deltaY * sensitivity;
    }
    return;
  }

  // Unzoomed: scroll moves the playhead through the song.
  const secsPerPixel = 1 / Math.max(1, zoomLevel);
  const sensitivity  = e.shiftKey ? 0.1 : 0.4;
  const step         = Math.abs(e.deltaY) * secsPerPixel * sensitivity;
  const dir          = e.deltaY > 0 ? 1 : -1;
  ws.seekTo(Math.max(0, Math.min(1, (now() + dir * step) / songDuration)));
}, { passive: false });

// ── Draggable scrub on waveform ───────────────────────────────────────────────
let scrubDragging = false;
let scrubMoved    = false;
let scrubOriginX  = 0;

waveWrap.addEventListener('mousedown', (e) => {
  if (!ws || !songDuration) return;
  scrubDragging = true;
  scrubMoved    = false;
  scrubOriginX  = e.clientX;
});

document.addEventListener('mousemove', (e) => {
  if (!scrubDragging || !ws || !songDuration) return;
  if (!scrubMoved && Math.abs(e.clientX - scrubOriginX) < 4) return;
  scrubMoved = true;
  waveWrap.classList.add('dragging');
  doScrub(e);
});

document.addEventListener('mouseup', () => {
  if (!scrubDragging) return;
  scrubDragging = false;
  scrubMoved    = false;
  waveWrap.classList.remove('dragging');
});

function doScrub(e) {
  const inner          = $('waveform-inner');
  const rect           = inner.getBoundingClientRect();
  const containerWidth = rect.width;
  const visFrac        = Math.max(0, Math.min(1, (e.clientX - rect.left) / containerWidth));

  if (zoomLevel <= 1) {
    ws.seekTo(visFrac);
    return;
  }

  // ws.getWrapper() is WaveSurfer v7's public scrollable container.
  // Its scrollLeft + cursor position within the visible area gives us
  // the exact pixel in the full zoomed canvas, which we normalise to 0-1.
  const wrapper    = ws.getWrapper?.();
  const scrollLeft = wrapper ? wrapper.scrollLeft : 0;
  const totalWidth = wrapper ? wrapper.scrollWidth : containerWidth * zoomLevel;

  const pixelPos = scrollLeft + visFrac * containerWidth;
  ws.seekTo(Math.max(0, Math.min(1, pixelPos / totalWidth)));
}

// ── Transport ─────────────────────────────────────────────────────────────────
$('btn-play').addEventListener('click', () => ws && ws.playPause());

$('btn-prev').addEventListener('click', () => {
  if (!ws || !lyrics.length) return;
  const prev = [...lyrics].reverse().find(l => l.time < now() - 0.2);
  ws.seekTo((prev ? prev.time : 0) / songDuration);
});

$('btn-next').addEventListener('click', () => {
  if (!ws || !lyrics.length) return;
  const next = lyrics.find(l => l.time > now() + 0.1);
  if (next) ws.seekTo(next.time / songDuration);
});

// ── Speed ─────────────────────────────────────────────────────────────────────
function setRate(r) {
  rate = Math.round(Math.max(MIN_RATE, Math.min(MAX_RATE, r)) / 0.25) * 0.25;
  speedVal.textContent = `${rate.toFixed(2)}×`;
  speedFill.style.width = `${((rate - MIN_RATE) / (MAX_RATE - MIN_RATE)) * 100}%`;
  if (ws) ws.setPlaybackRate(rate);
}

$('btn-faster').addEventListener('click', () => setRate(rate + RATE_STEP));
$('btn-slower').addEventListener('click', () => setRate(rate - RATE_STEP));
setRate(1.0);

// ── Lyrics ────────────────────────────────────────────────────────────────────
function addLyric(time, text = '') {
  const lyric = { id: uid(), time, text };
  lyrics.push(lyric);
  lyrics.sort((a, b) => a.time - b.time);
  renderLyrics();
  requestAnimationFrame(() => {
    const chip = lyricsList.querySelector(`[data-id="${lyric.id}"] .chip-text`);
    if (chip) startEdit(chip, lyric.id);
  });
  return lyric;
}

function renderLyrics() {
  lyricCount.textContent = lyrics.length ? `${lyrics.length}` : '—';
  lyricsList.innerHTML = '';

  if (!lyrics.length) {
    lyricsList.appendChild(lyricsHint);
    return;
  }

  lyrics.forEach(l => {
    const chip = document.createElement('div');
    chip.className  = 'lyric-chip';
    chip.dataset.id = l.id;
    chip.innerHTML  = `
      <span class="chip-ts">${fmt(l.time, true)}</span>
      <span class="chip-text${!l.text ? ' empty' : ''}" tabindex="0">${l.text || 'double-click to type…'}</span>
      <button class="chip-del" title="Delete" data-id="${l.id}">×</button>`;

    const textEl = chip.querySelector('.chip-text');

    chip.addEventListener('click', (e) => {
      if (e.target.classList.contains('chip-del')) return;
      if (chip.dataset.editing === 'true') return;
      if (ws && songDuration) ws.seekTo(l.time / songDuration);
    });

    textEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startEdit(textEl, l.id);
    });

    chip.querySelector('.chip-del').addEventListener('click', (e) => {
      e.stopPropagation();
      chip.style.transition = 'opacity 0.15s, transform 0.15s';
      chip.style.opacity = '0';
      chip.style.transform = 'translateX(6px) scale(0.98)';
      setTimeout(() => {
        lyrics = lyrics.filter(x => x.id !== l.id);
        renderLyrics();
      }, 150);
    });

    lyricsList.appendChild(chip);
  });
}

function startEdit(textEl, id) {
  const l = lyrics.find(x => x.id === id);
  if (!l) return;

  const chip = textEl.closest('.lyric-chip');
  chip.dataset.editing = 'true';

  textEl.classList.remove('empty');
  textEl.contentEditable = 'true';
  textEl.textContent = l.text;
  textEl.focus();

  const range = document.createRange();
  const sel   = window.getSelection();
  range.selectNodeContents(textEl);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);

  function commit() {
    const newText = textEl.textContent.trim();
    l.text = newText;
    textEl.contentEditable = 'false';
    chip.dataset.editing = 'false';
    if (!newText) {
      textEl.textContent = 'double-click to type…';
      textEl.classList.add('empty');
    } else {
      textEl.classList.remove('empty');
    }
  }

  textEl.addEventListener('blur', commit, { once: true });
  textEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textEl.blur(); }
    if (e.key === 'Escape') { textEl.textContent = l.text; textEl.blur(); }
  });
}

function highlightActive(t) {
  const chips = lyricsList.querySelectorAll('.lyric-chip');
  let ai = -1;
  for (let i = lyrics.length - 1; i >= 0; i--) {
    if (t >= lyrics[i].time) { ai = i; break; }
  }
  chips.forEach((c, i) => {
    const wasActive = c.classList.contains('active');
    const isActive  = i === ai;
    c.classList.toggle('active', isActive);
    // Auto-scroll to active chip if it just became active
    if (isActive && !wasActive) {
      c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

function stampLyric() {
  if (!ws) return;
  addLyric(now(), '');
}

function timeNextEmpty() {
  if (!ws) return;
  const empty = lyrics.find(l => !l.text.trim());
  if (empty) {
    empty.time = now();
    lyrics.sort((a, b) => a.time - b.time);
    renderLyrics();
  } else {
    addLyric(now(), '');
  }
}

// ── Export format builders ────────────────────────────────────────────────────
function buildSRT() {
  const base = songPath ? songPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : 'lyrics';
  return lyrics.map((l, i) => {
    const start = fmtSRT(l.time);
    // End time = next lyric's start - 50ms, or +3s if last
    const endSec = (lyrics[i + 1] ? lyrics[i + 1].time - 0.05 : l.time + 3);
    const end = fmtSRT(Math.max(l.time + 0.1, endSec));
    return `${i + 1}\n${start} --> ${end}\n${l.text || ' '}\n`;
  }).join('\n');
}

function buildLRC() {
  const base = songPath ? songPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : 'lyrics';
  return `[ti:${base}]\n[by:last's scriber]\n\n` +
    lyrics.map(l => `[${fmtLRC(l.time)}]${l.text}`).join('\n');
}

function buildASS() {
  const base = songPath ? songPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : 'lyrics';
  const header = `[Script Info]
Title: ${base}
ScriptType: v4.00+
Collisions: Normal
PlayDepth: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Poppins,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,10,10,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  function fmtASS(s) {
    const h  = Math.floor(s / 3600);
    const m  = Math.floor((s % 3600) / 60);
    const ss = (s % 60).toFixed(2);
    return `${h}:${p2(m)}:${String(ss).padStart(5,'0')}`;
  }

  const events = lyrics.map((l, i) => {
    const start  = fmtASS(l.time);
    const endSec = lyrics[i + 1] ? lyrics[i + 1].time - 0.05 : l.time + 3;
    const end    = fmtASS(Math.max(l.time + 0.1, endSec));
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${l.text || ' '}`;
  }).join('\n');

  return `${header}\n${events}`;
}

function buildTXT() {
  return lyrics.map(l => `[${fmt(l.time, true)}] ${l.text}`).join('\n');
}

function buildJSON() {
  return JSON.stringify(
    lyrics.map(l => ({ time: l.time, timeStr: fmt(l.time, true), text: l.text })),
    null, 2
  );
}

function buildFormat(fmt_) {
  switch (fmt_) {
    case 'srt':  return buildSRT();
    case 'lrc':  return buildLRC();
    case 'ass':  return buildASS();
    case 'txt':  return buildTXT();
    case 'json': return buildJSON();
    default:     return buildSRT();
  }
}

// ── Export dropdown ───────────────────────────────────────────────────────────
let menuOpen = false;

function openMenu() {
  exportMenu.hidden = false;
  menuOpen = true;
}

function closeMenu() {
  exportMenu.hidden = true;
  menuOpen = false;
}

$('btn-export').addEventListener('click', (e) => {
  e.stopPropagation();
  menuOpen ? closeMenu() : openMenu();
});

document.addEventListener('click', (e) => {
  if (menuOpen && !$('export-wrap').contains(e.target)) closeMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menuOpen) closeMenu();
}, true);

// Handle menu item clicks
exportMenu.addEventListener('click', async (e) => {
  const item = e.target.closest('.export-item');
  if (!item) return;

  const action = item.dataset.action;
  const fmt_   = item.dataset.fmt;

  closeMenu();

  if (!lyrics.length) { toast('no lyrics to export', 'error'); return; }

  if (action === 'copy') {
    const content = buildFormat(fmt_);
    try {
      await navigator.clipboard.writeText(content);
      toast(`copied as .${fmt_.toUpperCase()}`, 'success');
    } catch {
      toast('copy failed', 'error');
    }
    return;
  }

  // Save file
  const base = songPath ? songPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : 'lyrics';
  const fp   = await window.api.saveExport(`${base}.${fmt_}`);
  if (!fp) return;

  const content = buildFormat(fp.split('.').pop().toLowerCase());
  const ok = await window.api.writeFile(fp, content);
  toast(ok ? `saved → ${fp.split(/[\\/]/).pop()}` : 'export failed', ok ? 'success' : 'error');
});

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = '') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 260); }, 2600);
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (document.activeElement && document.activeElement.contentEditable === 'true') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  switch (e.key) {
    case ' ':   e.preventDefault(); ws && ws.playPause(); break;
    case 'q': case 'Q': e.preventDefault(); stampLyric(); break;
    case 't': case 'T': e.preventDefault(); timeNextEmpty(); break;
    case 'e': case 'E': e.preventDefault(); menuOpen ? closeMenu() : openMenu(); break;
    case '+': case '=': e.preventDefault(); setRate(rate + RATE_STEP); break;
    case '-': case '_': e.preventDefault(); setRate(rate - RATE_STEP); break;
  }
});