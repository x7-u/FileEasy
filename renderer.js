/* ── Constants ─────────────────────────────────────────────────────────── */
const VIDEO_EXTENSIONS = new Set([
  'mp4', 'avi', 'mov', 'mkv', 'webm', 'wmv', 'flv', 'm4v',
  '3gp', 'ts', 'mts', 'm2ts', 'vob', 'ogv', 'rm', 'rmvb',
  'divx', 'xvid', 'mpg', 'mpeg', 'f4v', 'asf',
]);

/* ── State ─────────────────────────────────────────────────────────────── */
let files = [];         // { id, filePath, name, size, status, progress, outputPath, compressedSize }
let isRunning = false;
let selectedCrf    = 28;
let selectedPreset = 'medium';
let selectedCq          = 26;
let selectedNvencPreset = 'p4';
let useGpu     = false;
let nvencAvailable = false;

/* ── DOM refs ──────────────────────────────────────────────────────────── */
const dropZone    = document.getElementById('dropZone');
const fileInput   = document.getElementById('fileInput');
const browseBtn   = document.getElementById('browseBtn');
const compressBtn = document.getElementById('compressBtn');
const clearBtn    = document.getElementById('clearBtn');
const fileList    = document.getElementById('fileList');
const summaryBar  = document.getElementById('summaryBar');
const summaryText = document.getElementById('summaryText');
const qualityBtns = document.querySelectorAll('.quality-btn');
const gpuSwitch   = document.getElementById('gpuSwitch');
const gpuChip     = document.getElementById('gpuChip');

/* ── Helpers ───────────────────────────────────────────────────────────── */
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function isVideoFile(file) {
  // Check MIME type first
  if (file.type && file.type.startsWith('video/')) return true;
  // Fall back to extension check
  const ext = (file.name || '').split('.').pop().toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

/* ── Quality buttons ───────────────────────────────────────────────────── */
qualityBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (isRunning) return;
    qualityBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    selectedCrf         = parseInt(btn.dataset.crf);
    selectedPreset      = btn.dataset.preset;
    selectedCq          = parseInt(btn.dataset.cq);
    selectedNvencPreset = btn.dataset.nvencPreset;
  });
});

/* ── GPU toggle ────────────────────────────────────────────────────────── */
gpuSwitch.addEventListener('click', () => {
  if (!nvencAvailable || isRunning) return;
  useGpu = !useGpu;
  gpuSwitch.setAttribute('aria-checked', String(useGpu));
  gpuSwitch.classList.toggle('on', useGpu);
  gpuChip.textContent   = useGpu ? 'NVENC' : 'Available';
  gpuChip.className     = 'gpu-chip ' + (useGpu ? 'active' : 'ready');
});

/* ── NVENC auto-detect on startup ──────────────────────────────────────── */
(async () => {
  try {
    nvencAvailable = await window.api.detectNvenc();
  } catch {
    nvencAvailable = false;
  }

  if (nvencAvailable) {
    gpuChip.textContent = 'Available';
    gpuChip.className   = 'gpu-chip ready';
    gpuSwitch.disabled  = false;
    gpuSwitch.title     = 'Click to enable NVIDIA NVENC GPU encoding';
  } else {
    gpuChip.textContent = 'Not found';
    gpuChip.className   = 'gpu-chip unavailable';
    gpuSwitch.title     =
      'No FFmpeg with NVENC found.\n' +
      'Install FFmpeg: winget install Gyan.FFmpeg\n' +
      'or: choco install ffmpeg\n' +
      'Then restart the app.';
  }
})();

/* ── NVENC fallback notification ───────────────────────────────────────── */
window.api.onNvencFallback(() => {
  showToast('GPU encoding failed — retrying with CPU');
});

/* ── Drag & Drop ───────────────────────────────────────────────────────── */
['dragenter', 'dragover'].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
  });
});

['dragleave', 'drop'].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
  });
});

dropZone.addEventListener('drop', (e) => {
  const droppedFiles = Array.from(e.dataTransfer.files);
  addFiles(droppedFiles);
});

/* ── Browse button ─────────────────────────────────────────────────────── */
browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  addFiles(Array.from(fileInput.files));
  fileInput.value = '';
});

/* ── Add files to queue ────────────────────────────────────────────────── */
function addFiles(rawFiles) {
  const newFiles = rawFiles.filter(isVideoFile);

  if (newFiles.length < rawFiles.length) {
    const skipped = rawFiles.length - newFiles.length;
    showToast(`${skipped} file(s) skipped — not a video format`);
  }

  for (const f of newFiles) {
    // Skip duplicates by path
    const fPath = f.path || f.name;
    if (files.some((existing) => existing.filePath === fPath)) continue;

    files.push({
      id: uid(),
      filePath: fPath,
      name: f.name,
      size: f.size,
      status: 'pending',  // pending | compressing | done | error | cancelled
      progress: 0,
      outputPath: null,
      compressedSize: null,
      errorMsg: null,
    });
  }

  render();
  updateButtons();
}

/* ── Remove file ───────────────────────────────────────────────────────── */
function removeFile(id) {
  const entry = files.find((f) => f.id === id);
  if (entry && entry.status === 'compressing') {
    window.api.cancelCompression(id);
  }
  files = files.filter((f) => f.id !== id);
  render();
  updateButtons();
}

/* ── Render file list ──────────────────────────────────────────────────── */
function render() {
  if (files.length === 0) {
    fileList.innerHTML = '';
    dropZone.style.display = '';
    return;
  }

  dropZone.style.display = 'none';

  fileList.innerHTML = files
    .map((f) => {
      const savingsHtml = buildSavingsHtml(f);
      const progressHtml = buildProgressHtml(f);
      const actionsHtml = buildActionsHtml(f);
      const statusClass = `status-${f.status}`;

      return `
        <li class="file-item ${statusClass}" data-id="${f.id}">
          <div class="file-icon">${fileIcon(f.status)}</div>
          <div class="file-info">
            <span class="file-name" title="${escHtml(f.filePath)}">${escHtml(f.name)}</span>
            <span class="file-meta">${formatBytes(f.size)}${savingsHtml}</span>
            ${progressHtml}
            ${f.errorMsg ? `<span class="file-error">${escHtml(f.errorMsg)}</span>` : ''}
          </div>
          <div class="file-actions">${actionsHtml}</div>
        </li>`;
    })
    .join('');

  // Wire up action buttons inside the list
  fileList.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.closest('[data-id]').dataset.id;
      const action = el.dataset.action;
      if (action === 'remove') removeFile(id);
      if (action === 'reveal') {
        const entry = files.find((f) => f.id === id);
        if (entry?.outputPath) window.api.revealFile(entry.outputPath);
      }
    });
  });
}

function buildSavingsHtml(f) {
  if (f.status !== 'done' || !f.compressedSize) return '';
  const saved = f.size - f.compressedSize;
  const pct = Math.round((saved / f.size) * 100);
  return ` <span class="savings">&rarr; ${formatBytes(f.compressedSize)} <em>(${pct}% smaller)</em></span>`;
}

function buildProgressHtml(f) {
  if (f.status !== 'compressing') return '';
  return `
    <div class="progress-wrap" role="progressbar" aria-valuenow="${f.progress}" aria-valuemin="0" aria-valuemax="100">
      <div class="progress-bar" style="width:${f.progress}%"></div>
      <span class="progress-label">${f.progress}%</span>
    </div>`;
}

function buildActionsHtml(f) {
  const remove = `<button class="icon-btn danger" data-action="remove" title="Remove">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  </button>`;

  const reveal = f.status === 'done'
    ? `<button class="icon-btn" data-action="reveal" title="Show in folder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </button>`
    : '';

  return reveal + remove;
}

function fileIcon(status) {
  if (status === 'done')       return '<svg class="icon-done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
  if (status === 'error')      return '<svg class="icon-err"  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  if (status === 'compressing')return '<div class="spinner"></div>';
  return '<svg class="icon-vid" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 9l5 3-5 3V9z"/></svg>';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Update button states ──────────────────────────────────────────────── */
function updateButtons() {
  const pending = files.filter((f) => f.status === 'pending').length;
  const any     = files.length > 0;

  compressBtn.disabled = isRunning || pending === 0;
  clearBtn.disabled    = isRunning || !any;

  compressBtn.textContent = pending === 1
    ? 'Compress 1 Video'
    : `Compress ${pending} Videos`;
}

/* ── Progress listener ─────────────────────────────────────────────────── */
window.api.onProgress(({ id, progress }) => {
  const entry = files.find((f) => f.id === id);
  if (entry) {
    entry.progress = progress;
    // Optimistic partial re-render: just update progress bar
    const item = fileList.querySelector(`[data-id="${id}"]`);
    if (item) {
      const bar = item.querySelector('.progress-bar');
      const lbl = item.querySelector('.progress-label');
      if (bar) bar.style.width = `${progress}%`;
      if (lbl) lbl.textContent = `${progress}%`;
    }
  }
});

/* ── Compress All ──────────────────────────────────────────────────────── */
compressBtn.addEventListener('click', () => startCompression());

async function startCompression() {
  const queue = files.filter((f) => f.status === 'pending');
  if (queue.length === 0 || isRunning) return;

  isRunning = true;
  summaryBar.hidden = true;
  qualityBtns.forEach((b) => b.disabled = true);
  gpuSwitch.disabled = true;
  updateButtons();

  let doneCount = 0;
  let totalSaved = 0;

  for (const entry of queue) {
    entry.status = 'compressing';
    entry.progress = 0;
    render();

    try {
      const result = await window.api.compressVideo({
        id: entry.id,
        filePath: entry.filePath,
        crf: selectedCrf,
        preset: selectedPreset,
        useGpu,
        cq: selectedCq,
        nvencPreset: selectedNvencPreset,
      });

      entry.status = 'done';
      entry.progress = 100;
      entry.outputPath = result.outputPath;
      entry.compressedSize = result.compressedSize;
      doneCount++;
      totalSaved += Math.max(0, result.originalSize - result.compressedSize);
    } catch (err) {
      if (entry.status === 'compressing') {
        // Only mark as error if it wasn't cancelled
        entry.status = 'error';
        entry.errorMsg = err.message || 'Compression failed';
      }
    }

    render();
  }

  isRunning = false;
  qualityBtns.forEach((b) => b.disabled = false);
  gpuSwitch.disabled = !nvencAvailable;
  updateButtons();

  if (doneCount > 0) {
    summaryText.textContent =
      `${doneCount} video${doneCount > 1 ? 's' : ''} compressed — saved ${formatBytes(totalSaved)} total`;
    summaryBar.hidden = false;
  }
}

/* ── Clear ─────────────────────────────────────────────────────────────── */
clearBtn.addEventListener('click', () => {
  if (isRunning) return;
  files = [];
  summaryBar.hidden = true;
  render();
  updateButtons();
  dropZone.style.display = '';
});

/* ── Toast notification ────────────────────────────────────────────────── */
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
}
