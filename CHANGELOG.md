# Changelog

## 1.0.0 — 2026-09-26

First public release.

- **Studio**: Simple / Custom / Cover / Repaint / Stems modes with every ACE-Step 1.5 parameter, style presets, lyric section tags and AI helpers (write with AI, enhance, surprise me).
- **Queue**: multi-job queue with song count and per-pass batch size, reordering, cancel, retry-from-where-it-stopped, duplicate, pause; persisted across restarts; parks itself when the engine goes down.
- **Live progress**: engine stages mapped to friendly labels, smoothed progress between ACE-Step milestones, ETA.
- **Library**: generative cover art, search, favorites, waveform player with seeking, Save as…, reveal in folder, reuse settings, cover/repaint shortcuts, JSON sidecars.
- **Engine control**: start / stop / restart / update, attach to an already-running server, live GPU telemetry and filtered log.
- **Stability check**: 16 checks incl. a real stress test with VRAM peak and leak detection, verdict + score + copyable report.
- **One-click installer**: uv, ACE-Step (git or zip), Python 3.12 + PyTorch CUDA 12.8, ~10 GB of models, config and GPU self-test, with per-step progress; repair mode; auto-detects existing installs.
- **Models**: download extra DiT / LM checkpoints with progress, choose defaults.
- **Claude MCP**: 12 tools, runs on the AceDeck executable (no Node.js needed), auto-launches the app, one-click Claude Desktop setup.
- **Automation API**: token-protected local HTTP API + `scripts/ctl.mjs`.
- **i18n**: English and Russian with correct plural forms.
- Simple mode respects the chosen duration/BPM/key (composes via `/v1/create_sample`, then renders).
