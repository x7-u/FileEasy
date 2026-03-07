# FileEasy — Video Compressor

A simple drag-and-drop video compressor for Windows. Drop your videos in, get smaller videos out — no technical knowledge required.

## Features

- Drag and drop multiple video files at once
- Three quality presets: **High**, **Balanced**, **Max**
- Optional **NVIDIA GPU (NVENC)** acceleration — auto-detected
- Output saved to the same folder as the source, with `_cpd` added to the filename
- Supports MP4, AVI, MOV, MKV, WMV, FLV, WEBM, M4V, and more

## Download

Grab the latest `FileEasy-Setup.exe` from the [Releases](../../releases) page and run it — no extra software needed.

## For Developers

### Prerequisites

- [Node.js](https://nodejs.org) (v18 or later)

### Run from source

```bat
install.bat   # installs dependencies (first time only)
start.bat     # launches the app
```

### Build the installer

```bat
build.bat     # produces dist\FileEasy-Setup-1.0.0.exe
```

> The build script auto-requests admin privileges (required for symlink creation during packaging).

### GPU encoding

FileEasy uses the bundled `ffmpeg-static` binary for CPU encoding (no setup needed). For NVIDIA GPU encoding, install a full FFmpeg build:

```
winget install Gyan.FFmpeg
```

The app detects it automatically and enables the GPU toggle.

## Tech Stack

- [Electron](https://www.electronjs.org/)
- [FFmpeg](https://ffmpeg.org/) via [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)
- [electron-builder](https://www.electron.build/)
