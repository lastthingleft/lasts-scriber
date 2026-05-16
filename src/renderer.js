/* ══════════════════════════════════════════════════════════════════════════════
   SCRIBER  ·  renderer.js
   Apple HIG–Inspired Lyric Stamping App
   ══════════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let ws           = null;
let lyrics       = [];        // [{ id, time, text }]
let songDuration = 0;
let songPath     = null;
let rate         = 1.0;
let zoomLevel    = 1;

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

function p2(n) { return String(n).padStart(2, '0'); }
function now() { return ws ? ws.getCurrentTime() : 0; }

function fmtSRT(s) {
  if (!s || isNaN(s) || s < 0) s = 0;
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  return `${p2(h)}:${p2(m)}:${p2(ss)},${String(ms).padStart(3,'0')}`;
}

function fmtLRC(s) {
  if (!s || isNaN(s) || s < 0) s = 0;
  const m  = Math.floor(s / 60);
  const sc = (s % 60).toFixed(2);
  return `${p2(m)}:${String(sc).padStart(5,'0')}`;
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
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

// ── Theme Toggle ──────────────────────────────────────────────────────────────
let isDark = true;

function applyTheme(dark) {
  isDark = dark;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  $('ico-sun').style.display  = dark  ? 'none'  : 'block';
  $('ico-moon').style.display = dark  ? 'block' : 'none';

// Update WaveSurfer colors to match theme
  if (ws) {
    if (dark) {
      ws.setOptions({
        waveColor:     'rgba(255, 255, 255, 0.20)',
        progressColor: 'rgba(255, 255, 255, 0.85)',
        cursorColor:   'rgba(255, 255, 255, 0.50)',
      });
    } else {
      ws.setOptions({
        waveColor:     'rgba(0, 0, 0, 0.15)',
        progressColor: 'rgba(0, 0, 0, 0.75)',
        cursorColor:   'rgba(0, 0, 0, 0.45)',
      });
    }
  }
}

$('btn-theme').addEventListener('click', () => {
  applyTheme(!isDark);
  // Animate icon
  const svg = $('btn-theme').querySelector('svg:not([style*="none"])');
  if (svg) {
    svg.style.transform = 'rotate(0deg) scale(0.7)';
    svg.style.transition = 'transform 200ms cubic-bezier(0.34,1.56,0.64,1)';
    requestAnimationFrame(() => {
      svg.style.transform = 'rotate(360deg) scale(1)';
    });
  }
});

// ── Window controls ───────────────────────────────────────────────────────────
$('tl-min').addEventListener('click',   () => window.api?.minimize());
$('tl-max').addEventListener('click',   () => window.api?.maximize());
$('tl-close').addEventListener('click', () => window.api?.close());

// ── Load Song ─────────────────────────────────────────────────────────────────
$('btn-load').addEventListener('click', async () => {
  const fp = await window.api?.openAudio();
  if (!fp) return;

  songPath = fp;
  const name = fp.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  $('song-label').textContent = fp.split(/[\\/]/).pop();
  metaTitle.textContent = name;
  lyrics = [];
  renderLyrics();

  const audio = await window.api?.readAudio(fp);
  if (!audio) { toast('Could not read file', 'error'); return; }

  const bytes = Uint8Array.from(atob(audio.base64), c => c.charCodeAt(0));
  const blob  = new Blob([bytes], { type: audio.mime });
  const url   = URL.createObjectURL(blob);
  initWS(url, name);
});

// ── WaveSurfer ────────────────────────────────────────────────────────────────
function wsColors() {
  return isDark
    ? {
        waveColor:     'rgba(255, 255, 255, 0.20)',
        progressColor: 'rgba(255, 255, 255, 0.85)',
        cursorColor:   'rgba(255, 255, 255, 0.50)',
      }
    : {
        waveColor:     'rgba(0, 0, 0, 0.15)',
        progressColor: 'rgba(0, 0, 0, 0.75)',
        cursorColor:   'rgba(0, 0, 0, 0.45)',
      };
}

function initWS(url) {
  if (ws) { ws.destroy(); ws = null; }
  zoomLevel = 1;

  ws = WaveSurfer.create({
    container:     '#waveform',
    ...wsColors(),
    cursorWidth:   1.5,
    barWidth:      2,
    barGap:        1.5,
    barRadius:     3,
    height:        'auto',
    normalize:     true,
    interact:      true,
  });

  ws.load(url);

  ws.on('ready', () => {
    songDuration = ws.getDuration();

    // Animate in the waveform area
    waveWrap.classList.add('has-audio');

    tTot.textContent    = fmt(songDuration);
    metaDur.textContent = fmt(songDuration);
    ws.setPlaybackRate(rate);
    updateTS(0);
  });

  ws.on('audioprocess', updateTS);
  ws.on('seek',   p  => updateTS(p * songDuration));
  ws.on('play',   () => setPS(true));
  ws.on('pause',  () => setPS(false));
  ws.on('finish', () => setPS(false));
}

function updateTS(t) {
  tCur.textContent  = fmt(t);
  tsVal.textContent = fmt(t, true);
  highlightActive(t);
}

function setPS(playing) {
  $('ico-play').style.display  = playing ? 'none'  : 'block';
  $('ico-pause').style.display = playing ? 'block' : 'none';
  $('btn-play').classList.toggle('is-playing', playing);

  // Animate play button icon swap
  const btn = $('btn-play');
  btn.style.transform = 'scale(0.88)';
  btn.style.transition = 'transform 140ms cubic-bezier(0.34,1.56,0.64,1)';
  requestAnimationFrame(() => {
    btn.style.transform = 'scale(1)';
  });
}

// ── Ctrl+Scroll Zoom ──────────────────────────────────────────────────────────
waveWrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!ws || !songDuration) return;

  if (e.ctrlKey || e.metaKey) {
    const factor = e.deltaY > 0 ? 1 / 1.35 : 1.35;
    zoomLevel    = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel * factor));
    ws.zoom(zoomLevel);
    return;
  }

  if (zoomLevel > 1) {
    const wrapper = ws.getWrapper?.();
    if (wrapper) {
      const sensitivity = e.shiftKey ? 0.3 : 1;
      wrapper.scrollLeft += e.deltaY * sensitivity;
    }
    return;
  }

  const secsPerPixel = 1 / Math.max(1, zoomLevel);
  const sensitivity  = e.shiftKey ? 0.1 : 0.4;
  const step         = Math.abs(e.deltaY) * secsPerPixel * sensitivity;
  const dir          = e.deltaY > 0 ? 1 : -1;
  ws.seekTo(Math.max(0, Math.min(1, (now() + dir * step) / songDuration)));
}, { passive: false });

// ── Drag-scrub on waveform ────────────────────────────────────────────────────
let scrubDragging    = false;
let scrubMoved       = false;
let scrubOriginX     = 0;
let scrubLastClientX = 0;
let scrubRAF         = null;

const EDGE_ZONE  = 60;
const EDGE_SPEED = 12;

waveWrap.addEventListener('mousedown', (e) => {
  if (!ws || !songDuration) return;
  scrubDragging    = true;
  scrubMoved       = false;
  scrubOriginX     = e.clientX;
  scrubLastClientX = e.clientX;
});

document.addEventListener('mousemove', (e) => {
  if (!scrubDragging || !ws || !songDuration) return;
  scrubLastClientX = e.clientX;

  if (!scrubMoved && Math.abs(e.clientX - scrubOriginX) < 4) return;

  if (!scrubMoved) {
    scrubMoved = true;
    waveWrap.classList.add('dragging');
    scrubRAF = requestAnimationFrame(scrubLoop);
  }
});

document.addEventListener('mouseup', () => {
  if (!scrubDragging) return;
  scrubDragging = false;
  scrubMoved    = false;
  waveWrap.classList.remove('dragging');
  if (scrubRAF !== null) {
    cancelAnimationFrame(scrubRAF);
    scrubRAF = null;
  }
});

function scrubLoop() {
  if (!scrubDragging || !scrubMoved || !ws || !songDuration) {
    scrubRAF = null;
    return;
  }

  const wrapper = ws.getWrapper?.();

  if (zoomLevel <= 1 || !wrapper) {
    const inner = $('waveform-inner');
    const rect  = inner.getBoundingClientRect();
    const frac  = Math.max(0, Math.min(1, (scrubLastClientX - rect.left) / rect.width));
    ws.seekTo(frac);
  } else {
    const wrapRect    = wrapper.getBoundingClientRect();
    const viewWidth   = wrapRect.width;
    const totalWidth  = wrapper.scrollWidth;
    const mouseInView = scrubLastClientX - wrapRect.left;

    let scrollDelta = 0;
    if (mouseInView < EDGE_ZONE) {
      scrollDelta = -Math.round(((EDGE_ZONE - mouseInView) / EDGE_ZONE) * EDGE_SPEED);
    } else if (mouseInView > viewWidth - EDGE_ZONE) {
      scrollDelta = Math.round(((mouseInView - (viewWidth - EDGE_ZONE)) / EDGE_ZONE) * EDGE_SPEED);
    }

    if (scrollDelta !== 0) {
      wrapper.scrollLeft = Math.max(0, Math.min(totalWidth - viewWidth,
                                                wrapper.scrollLeft + scrollDelta));
    }

    const canvasPixel = Math.max(0, Math.min(totalWidth, wrapper.scrollLeft + mouseInView));
    ws.seekTo(canvasPixel / totalWidth);
  }

  scrubRAF = requestAnimationFrame(scrubLoop);
}

// ── Transport ─────────────────────────────────────────────────────────────────
$('btn-play').addEventListener('click', () => ws && ws.playPause());

$('btn-prev').addEventListener('click', () => {
  if (!ws || !lyrics.length) return;
  const prev = [...lyrics].reverse().find(l => l.time < now() - 0.2);
  ws.seekTo((prev ? prev.time : 0) / songDuration);
  animateBtn('btn-prev');
});

$('btn-next').addEventListener('click', () => {
  if (!ws || !lyrics.length) return;
  const next = lyrics.find(l => l.time > now() + 0.1);
  if (next) ws.seekTo(next.time / songDuration);
  animateBtn('btn-next');
});

function animateBtn(id) {
  const el = $(id);
  el.style.transform = 'scale(0.82)';
  el.style.transition = 'transform 120ms cubic-bezier(0.34,1.56,0.64,1)';
  requestAnimationFrame(() => { el.style.transform = 'scale(1)'; });
}

// ── Speed ─────────────────────────────────────────────────────────────────────
function setRate(r) {
  rate = Math.round(Math.max(MIN_RATE, Math.min(MAX_RATE, r)) / 0.25) * 0.25;
  speedVal.textContent = `${rate.toFixed(2)}×`;
  speedFill.style.width = `${((rate - MIN_RATE) / (MAX_RATE - MIN_RATE)) * 100}%`;
  if (ws) ws.setPlaybackRate(rate);
}

$('btn-faster').addEventListener('click', () => { setRate(rate + RATE_STEP); animateBtn('btn-faster'); });
$('btn-slower').addEventListener('click', () => { setRate(rate - RATE_STEP); animateBtn('btn-slower'); });
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
  const count = lyrics.length;

  if (!count) {
    lyricCount.textContent = '—';
    lyricCount.style.opacity = '0.5';
  } else {
    lyricCount.textContent = `${count}`;
    lyricCount.style.opacity = '1';
  }

  lyricsList.innerHTML = '';

  if (!count) {
    lyricsList.appendChild(lyricsHint);
    return;
  }

  lyrics.forEach((l, idx) => {
    const chip = document.createElement('div');
    chip.className  = 'lyric-chip';
    chip.dataset.id = l.id;
    chip.style.animationDelay = `${Math.min(idx * 18, 100)}ms`;

    chip.innerHTML = `
      <span class="chip-ts">${fmt(l.time, true)}</span>
      <span class="chip-text${!l.text ? ' empty' : ''}" tabindex="0">${
        l.text || 'Double-click to type…'
      }</span>
      <button class="chip-del" title="Delete" data-id="${l.id}" tabindex="-1">
        <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="2" y1="2" x2="12" y2="12"/>
          <line x1="12" y1="2" x2="2" y2="12"/>
        </svg>
      </button>`;

    const textEl = chip.querySelector('.chip-text');

    chip.addEventListener('click', (e) => {
      if (e.target.closest('.chip-del')) return;
      if (chip.dataset.editing === 'true') return;
      if (ws && songDuration) {
        ws.seekTo(l.time / songDuration);
        // Pulse the chip
        chip.style.transform = 'scale(0.975)';
        setTimeout(() => { chip.style.transform = ''; }, 120);
      }
    });

    textEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startEdit(textEl, l.id);
    });

    chip.querySelector('.chip-del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteLyric(chip, l.id);
    });

    lyricsList.appendChild(chip);
  });
}

function deleteLyric(chip, id) {
  // Animate out
  chip.style.transition = 'opacity 160ms ease, transform 160ms cubic-bezier(0.4,0,1,1), max-height 200ms ease, margin 200ms ease, padding 200ms ease';
  chip.style.opacity    = '0';
  chip.style.transform  = 'translateX(10px) scale(0.97)';
  chip.style.maxHeight  = chip.offsetHeight + 'px';
  chip.style.overflow   = 'hidden';

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      chip.style.maxHeight = '0';
      chip.style.marginTop = '0';
      chip.style.marginBottom = '0';
      chip.style.paddingTop = '0';
      chip.style.paddingBottom = '0';
    });
  });

  setTimeout(() => {
    lyrics = lyrics.filter(x => x.id !== id);
    renderLyrics();
  }, 220);
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

  // Select all text
  const range = document.createRange();
  const sel   = window.getSelection();
  range.selectNodeContents(textEl);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);

  // Highlight editing state
  chip.style.background = 'var(--blue-soft)';

  function commit() {
    const newText = textEl.textContent.trim();
    l.text = newText;
    textEl.contentEditable = 'false';
    chip.dataset.editing = 'false';
    chip.style.background = '';

    if (!newText) {
      textEl.textContent = 'Double-click to type…';
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

// Track last active index to avoid redundant DOM updates
let lastActiveIndex = -1;

function highlightActive(t) {
  const chips = lyricsList.querySelectorAll('.lyric-chip');
  let ai = -1;
  for (let i = lyrics.length - 1; i >= 0; i--) {
    if (t >= lyrics[i].time) { ai = i; break; }
  }

  if (ai === lastActiveIndex) return; // No change
  lastActiveIndex = ai;

  chips.forEach((c, i) => {
    const isActive = i === ai;
    if (isActive && !c.classList.contains('active')) {
      c.classList.add('active');
      c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (!isActive) {
      c.classList.remove('active');
    }
  });
}

function stampLyric() {
  if (!ws) return;
  addLyric(now(), '');
  // Haptic-style flash on lyric count badge
  const badge = lyricCount;
  badge.style.transform = 'scale(1.3)';
  badge.style.transition = 'transform 200ms cubic-bezier(0.34,1.56,0.64,1)';
  setTimeout(() => { badge.style.transform = 'scale(1)'; }, 200);
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

// ── Export Builders ───────────────────────────────────────────────────────────
function buildSRT() {
  const base = songPath ? songPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : 'lyrics';
  return lyrics.map((l, i) => {
    const start  = fmtSRT(l.time);
    const endSec = lyrics[i + 1] ? lyrics[i + 1].time - 0.05 : l.time + 3;
    const end    = fmtSRT(Math.max(l.time + 0.1, endSec));
    return `${i + 1}\n${start} --> ${end}\n${l.text || ' '}\n`;
  }).join('\n');
}

function buildLRC() {
  const base = songPath ? songPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : 'lyrics';
  return `[ti:${base}]\n[by:Scriber]\n\n` +
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
Style: Default,-apple-system,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,10,10,30,1

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

function buildFormat(f) {
  switch (f) {
    case 'srt':  return buildSRT();
    case 'lrc':  return buildLRC();
    case 'ass':  return buildASS();
    case 'txt':  return buildTXT();
    case 'json': return buildJSON();
    default:     return buildSRT();
  }
}

// ── Export Dropdown ───────────────────────────────────────────────────────────
let menuOpen = false;

function openMenu() {
  exportMenu.hidden = false;
  menuOpen = true;
}

function closeMenu() {
  // Animate out
  exportMenu.style.transition = 'opacity 120ms ease, transform 120ms cubic-bezier(0.4,0,1,1)';
  exportMenu.style.opacity = '0';
  exportMenu.style.transform = 'scale(0.92) translateY(-6px)';
  setTimeout(() => {
    exportMenu.hidden = true;
    exportMenu.style.opacity = '';
    exportMenu.style.transform = '';
    exportMenu.style.transition = '';
    menuOpen = false;
  }, 120);
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

exportMenu.addEventListener('click', async (e) => {
  const item = e.target.closest('.export-item');
  if (!item) return;

  const action = item.dataset.action;
  const f      = item.dataset.fmt;

  closeMenu();

  if (!lyrics.length) { toast('No lyrics to export', 'error'); return; }

  if (action === 'copy') {
    const content = buildFormat(f);
    try {
      await navigator.clipboard.writeText(content);
      toast(`Copied as .${f.toUpperCase()}`, 'success');
    } catch {
      toast('Copy failed', 'error');
    }
    return;
  }

  const base = songPath ? songPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : 'lyrics';
  const fp   = await window.api?.saveExport(`${base}.${f}`);
  if (!fp) return;

  const content = buildFormat(fp.split('.').pop().toLowerCase());
  const ok = await window.api?.writeFile(fp, content);
  toast(ok ? `Saved → ${fp.split(/[\\/]/).pop()}` : 'Export failed', ok ? 'success' : 'error');
});

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = '') {
  // Remove existing toasts
  document.querySelectorAll('.toast').forEach(t => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 260);
  });

  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  document.body.appendChild(el);

  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 320);
  }, 2800);
}

// ── Keyboard Shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (document.activeElement?.contentEditable === 'true') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      ws && ws.playPause();
      break;
    case 'q':
    case 'Q':
      e.preventDefault();
      stampLyric();
      break;
    case 't':
    case 'T':
      e.preventDefault();
      timeNextEmpty();
      break;
    case 'e':
    case 'E':
      e.preventDefault();
      menuOpen ? closeMenu() : openMenu();
      break;
    case '+':
    case '=':
      e.preventDefault();
      setRate(rate + RATE_STEP);
      break;
    case '-':
    case '_':
      e.preventDefault();
      setRate(rate - RATE_STEP);
      break;
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
// Apply initial dark theme
applyTheme(true);