const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  detectNvenc: () => ipcRenderer.invoke('detect-nvenc'),
  compressVideo: (options) => ipcRenderer.invoke('compress-video', options),
  cancelCompression: (id) => ipcRenderer.send('cancel-compression', { id }),
  revealFile: (filePath) => ipcRenderer.send('reveal-file', { filePath }),
  onProgress: (callback) =>
    ipcRenderer.on('compression-progress', (_event, data) => callback(data)),
  onNvencFallback: (callback) =>
    ipcRenderer.on('nvenc-fallback', (_event, data) => callback(data)),
  removeProgressListeners: () =>
    ipcRenderer.removeAllListeners('compression-progress'),
});
