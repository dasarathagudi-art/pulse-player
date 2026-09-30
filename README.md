# Pulse

An original **VLC-inspired** media player: playlist, hotkeys, speed control, fullscreen, network URLs, and a dark orange-accent UI.

Repository: https://github.com/dasarathagudi-art/pulse-player

This is **not** VideoLAN VLC and does not copy VLC source. VLC is a separate open-source project.

## VLC is open source — yes

| | |
|---|---|
| Project | [VideoLAN VLC](https://www.videolan.org/vlc/) |
| License | GPL-2.0-or-later |
| Canonical repo | [https://github.com/videolan/vlc](https://github.com/videolan/vlc) |

VLC is a large C/C++ application around libVLC (demux, decode, output, filters, optical media, streaming). Forking that tree is how you get a second VLC. Pulse is a small player that *behaves* like the VLC window most people use day to day.

If you later want real “plays every broken MKV” coverage, the honest next step is embedding **libVLC** or **libmpv** behind this UI — not rewriting FFmpeg.

## What Pulse includes (v1)

**Web player** (`web/index.html`) — open in a browser

- Open files, drag-and-drop, network stream URL
- Playlist, next/prev, shuffle
- Play / pause / stop / seek / volume / mute
- Loop off → one → all
- Playback speed
- Fullscreen, picture-in-picture, snapshot
- Media info overlay
- Audio-only spectrum visualizer
- Keyboard shortcuts close to VLC habits

Browser formats only (typically MP4/H.264+AAC, WebM, MP3, WAV, Ogg; FLAC in Chromium). MKV/AVI often fail here on purpose — use the desktop player.

**Desktop player** (`python/player.py`) — pygame + PyAV

- Local files and folders
- Video blit + ffmpeg audio extract when `ffmpeg` is on PATH
- Seek, volume, mute, next/prev, speed, fullscreen, drag-and-drop
- Any container PyAV/FFmpeg can open

## Quick start — web

```bash
python3 -m http.server 8080 --directory web
# open http://localhost:8080
```

Or just open `web/index.html` in Chrome, Edge, or Firefox.

### Web shortcuts

| Key | Action |
|---|---|
| Space | Play / pause |
| S | Stop |
| F | Fullscreen |
| M | Mute |
| ← / → | Seek 5s (Shift: 10s) |
| ↑ / ↓ | Volume |
| N / P | Next / previous |
| L | Cycle loop |
| [ / ] | Slower / faster |
| I | Info |
| Ctrl+O / Ctrl+N | Open file / URL |

## Quick start — desktop

Needs Python 3.10+, FFmpeg on PATH for audio, then:

```bash
cd python
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python player.py video.mp4
python player.py ~/Videos/
```

| Key | Action |
|---|---|
| Space | Play / pause |
| S | Stop |
| ← / → | Seek ±10s |
| ↑ / ↓ | Volume |
| M | Mute |
| N / P | Next / previous |
| [ / ] | Speed |
| F | Fullscreen |
| Q / Esc | Quit |

## Layout

```
pulse-player/
├── README.md
├── LICENSE                 # MIT (Pulse). VLC remains GPL.
├── .gitignore
├── web/index.html          # self-contained UI + player
└── python/
    ├── requirements.txt
    └── player.py
```

## Roadmap

- libVLC or libmpv backend for format parity
- SRT/VTT subtitle overlay
- M3U playlist load/save
- Resume position
- Packaged desktop build (PyInstaller / Tauri)

## License

Pulse source in this repository is MIT. VideoLAN, VLC, and the cone logo are trademarks of the VideoLAN non-profit. Use them only under VideoLAN’s rules — Pulse does not ship those assets.
