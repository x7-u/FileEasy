const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let ffmpegPath;
try {
  ffmpegPath = require('ffmpeg-static');
  // electron-builder extracts asarUnpack files to app.asar.unpacked/,
  // but require() still returns the path inside app.asar (not executable).
  // Replace so the binary can actually be spawned in the packaged app.
  if (app.isPackaged) {
    ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
  }
} catch {
  ffmpegPath = 'ffmpeg';
}

// Binary confirmed to have h264_nvenc — set during detection
let nvencFfmpegPath = null;

// Track active ffmpeg processes so we can cancel them
const activeProcesses = new Map();

// ─── Helpers ───────────────────────────────────────────────────────────────

// Ask Windows 'where' for every ffmpeg on PATH (handles winget, choco, scoop, manual)
function findFfmpegOnPath() {
  return new Promise((resolve) => {
    const proc = spawn('where', ['ffmpeg'], { shell: true, windowsHide: true });
    let out = '';
    proc.stdout?.on('data', (d) => { out += d.toString(); });
    proc.on('close', () => {
      const found = out.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      resolve(found);
    });
    proc.on('error', () => resolve([]));
  });
}

// Returns true if the given binary lists h264_nvenc in its encoder table
function hasNvencEncoder(binary) {
  return new Promise((resolve) => {
    const proc = spawn(binary, ['-hide_banner', '-encoders'], { windowsHide: true });
    let out = '';
    proc.stdout?.on('data', (d) => { out += d.toString(); });
    proc.stderr?.on('data', (d) => { out += d.toString(); });
    proc.on('close', () => resolve(out.includes('h264_nvenc')));
    proc.on('error', () => resolve(false));
  });
}

// ─── Window ────────────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width: 860,
    height: 720,
    minWidth: 640,
    minHeight: 500,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  for (const proc of activeProcesses.values()) {
    try { proc.kill(); } catch {}
  }
  if (process.platform !== 'darwin') app.quit();
});

// ─── Detect NVENC ──────────────────────────────────────────────────────────
ipcMain.handle('detect-nvenc', async () => {
  // 1. Find every ffmpeg on PATH (catches winget, chocolatey, scoop, manual PATH adds)
  const pathBinaries = await findFfmpegOnPath();

  // 2. Hardcoded fallback locations for common Windows installs
  const hardcoded = [
    ffmpegPath,
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
    path.join(process.env.USERPROFILE  || '', 'scoop', 'apps', 'ffmpeg', 'current', 'bin', 'ffmpeg.exe'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(process.env.ProgramFiles || '', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ffmpeg', 'bin', 'ffmpeg.exe'),
  ];

  // PATH-found binaries take priority; deduplicate falsy/duplicates
  const candidates = [...pathBinaries, ...hardcoded]
    .filter((v, i, a) => v && a.indexOf(v) === i);

  for (const binary of candidates) {
    const ok = await hasNvencEncoder(binary);
    if (ok) {
      nvencFfmpegPath = binary;
      return true;
    }
  }

  nvencFfmpegPath = null;
  return false;
});

// ─── Compress a single video ───────────────────────────────────────────────
ipcMain.handle('compress-video', async (event, { id, filePath, crf, preset, useGpu, cq, nvencPreset }) => {
  const ext      = path.extname(filePath);
  const dir      = path.dirname(filePath);
  const basename = path.basename(filePath, ext);
  const outputPath = path.join(dir, `${basename}_cpd.mp4`);

  function runCompress(withGpu) {
    return new Promise((resolve, reject) => {
      const args = withGpu
        ? [
            '-i', filePath,
            '-c:v', 'h264_nvenc',
            '-preset', nvencPreset,
            '-rc', 'vbr',
            '-cq', String(cq),
            '-b:v', '0',
            '-maxrate', '8M',
            '-bufsize', '16M',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            '-y',
            outputPath,
          ]
        : [
            '-i', filePath,
            '-c:v', 'libx264',
            '-crf', String(crf),
            '-preset', preset,
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            '-y',
            outputPath,
          ];

      const binary = withGpu && nvencFfmpegPath ? nvencFfmpegPath : ffmpegPath;
      const proc = spawn(binary, args, { windowsHide: true });
      activeProcesses.set(id, proc);

      let duration = 0;
      let stderrBuf = '';

      proc.stderr.on('data', (chunk) => {
        const str = chunk.toString();
        stderrBuf += str;

        if (!duration) {
          const m = str.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
          if (m) {
            duration = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          }
        }

        const t = str.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
        if (t && duration > 0) {
          const current = parseInt(t[1]) * 3600 + parseInt(t[2]) * 60 + parseFloat(t[3]);
          const pct = Math.min(Math.round((current / duration) * 100), 99);
          event.sender.send('compression-progress', { id, progress: pct });
        }
      });

      proc.on('close', (code) => {
        activeProcesses.delete(id);
        if (code === 0) {
          const originalSize = fs.statSync(filePath).size;
          let compressedSize = 0;
          try { compressedSize = fs.statSync(outputPath).size; } catch {}
          resolve({ success: true, outputPath, originalSize, compressedSize });
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        activeProcesses.delete(id);
        reject(new Error(`Could not start FFmpeg: ${err.message}`));
      });
    });
  }

  // GPU mode: try NVENC first, auto-fall back to CPU on any failure
  if (useGpu) {
    try {
      return await runCompress(true);
    } catch {
      event.sender.send('nvenc-fallback', { id });
      return runCompress(false);
    }
  }

  return runCompress(false);
});

// ─── Cancel a compression ──────────────────────────────────────────────────
ipcMain.on('cancel-compression', (_event, { id }) => {
  const proc = activeProcesses.get(id);
  if (proc) {
    try { proc.kill(); } catch {}
    activeProcesses.delete(id);
  }
});

// ─── Reveal output file in Explorer / Finder ──────────────────────────────
ipcMain.on('reveal-file', (_event, { filePath }) => {
  shell.showItemInFolder(filePath);
});
