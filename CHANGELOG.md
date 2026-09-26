# Changelog

## 1.0.2 — 2026-09-26

- **Simple mode keeps your genre.** ACE-Step's DiT only understands English captions and its LM retold long Russian descriptions as lo-fi hip-hop / pop with rap. AceDeck now:
  - translates genres, instruments, moods, vocals and tempo from the description into a short English caption (≈250 Russian music terms, Latin names kept verbatim) and shows it live under the prompt (*Engine hears*);
  - never lets the LM rewrite the caption before rendering (`use_cot_caption` is off by default, saved forms are migrated);
  - renders with **Exact style** (new toggle, on by default): the music model follows the caption and the LM only writes lyrics — LM *thinking* was the main source of style drift in A/B tests (3/3 on-genre without it vs. 1–2/3 with it);
  - takes the tempo from the words (“медленный” → 70 BPM, explicit “84 bpm”), and makes instrumental-only genres (ambient, dark jazz, film score…) instrumental unless you mention vocals;
  - applies the same to *Write with AI*, Russian captions in Custom mode, the automation API and the MCP tools.
- **Updates inside the app.** Settings → *Updates* checks GitHub Releases (automatically on start and every 6 h), shows release notes, downloads with progress and restarts into the new version; a badge appears in the sidebar. The installer build uses electron-updater (silent per-user install, differential download); the portable build downloads the new portable `.exe` next to itself, relaunches it and moves the old one to the Recycle Bin.
- **Desktop shortcut.** The installer always (re)creates the desktop icon, the portable build creates one on first run, and Settings has a *Create desktop shortcut* button.
- Releases now ship `latest.yml` and the `.blockmap` the updater needs.

## 1.0.1 — 2026-09-26

Fixes found by a new end-to-end test suite (`tests/e2e.mjs`) run against the real engine.

- **Cover / Repaint / Stems now work**: ACE-Step rejects absolute file paths, so AceDeck uploads the source and reference audio as `multipart/form-data` (all parameters travel typed in `param_obj`). Applies to the UI, the automation API and the MCP `transform_audio` tool.
- **Per-job model choice is honoured**: the engine starts with `ACESTEP_ON_DEMAND_MODEL_LOAD=true` and loads models at startup (the only path that lets ACE-Step swap DiT models later). Picking SFT/Base/XL in *Create* — and every stem task, which needs Base — no longer silently falls back to turbo.
- **Real durations** for cover/repaint/stem tracks (the engine reports `N/A`): read from the audio file; existing library entries are repaired on start.
- Engine start waits up to 20 min (first start may download a model) and shows *Loading models…* while the server loads them.
- Library type filters and card badges are localized; Russian plural in "N of M songs".
- Claude Desktop config merge extracted into a tested pure function (keeps other servers, refuses to overwrite invalid JSON, writes a `.bak`).
- Unit tests: 14; new E2E scenarios: AI helpers, cover, repaint, model download progress, extract/lego/complete stems, per-job model switching, queue reordering.

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
