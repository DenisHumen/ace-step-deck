import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { Download, Heart, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useApp, attempt } from '../lib/store'
import { api, trackUrl } from '../lib/api'
import { fmtDuration } from '../lib/format'
import { useT } from '../i18n'
import { IconButton, TrackCover } from './ui'

export function PlayerBar() {
  const t = useT()
  const player = useApp((s) => s.player)
  const track = useApp((s) => s.tracks.find((x) => x.id === s.player.trackId))
  const tracks = useApp((s) => s.tracks)
  const setPlaying = useApp((s) => s.setPlaying)
  const play = useApp((s) => s.play)
  const waveRef = useRef<HTMLDivElement>(null)
  const ws = useRef<WaveSurfer | null>(null)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [volume, setVolume] = useState(0.9)
  const [muted, setMuted] = useState(false)

  const list = player.queueIds.length ? player.queueIds : tracks.map((x) => x.id)
  const idx = track ? list.indexOf(track.id) : -1
  const step = (d: number) => {
    const next = list[idx + d]
    if (next) play(next, list)
  }

  useEffect(() => {
    if (!waveRef.current || !track) return
    const w = WaveSurfer.create({
      container: waveRef.current,
      url: trackUrl(track.id),
      height: 34,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      cursorWidth: 0,
      waveColor: 'rgba(255,255,255,0.18)',
      progressColor: '#e04fd2',
      normalize: true,
    })
    ws.current = w
    setTime(0)
    w.setVolume(muted ? 0 : volume)
    // Ignore events from an instance that is being torn down (destroy() emits "pause").
    const live = () => ws.current === w
    // WaveSurfer emits play/pause while it fetches & decodes; only trust media events once ready.
    let isReady = false
    w.on('ready', () => {
      if (!live()) return
      isReady = true
      setDur(w.getDuration())
      if (useApp.getState().player.playing) w.play().catch(() => live() && setPlaying(false))
    })
    w.on('timeupdate', (tm) => live() && setTime(tm))
    w.on('play', () => live() && isReady && setPlaying(true))
    w.on('pause', () => live() && isReady && setPlaying(false))
    w.on('finish', () => {
      if (!live()) return
      setPlaying(false)
      const l = useApp.getState().player.queueIds
      const i = l.indexOf(track.id)
      if (i >= 0 && l[i + 1]) useApp.getState().play(l[i + 1], l)
    })
    return () => {
      ws.current = null
      w.unAll()
      w.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id])

  useEffect(() => {
    const w = ws.current
    if (!w) return
    if (player.playing && !w.isPlaying()) w.play().catch(() => setPlaying(false))
    if (!player.playing && w.isPlaying()) w.pause()
  }, [player.playing])

  useEffect(() => {
    ws.current?.setVolume(muted ? 0 : volume)
  }, [volume, muted])

  if (!track) return null
  return (
    <div className="absolute inset-x-6 bottom-5 z-20">
      <div className="glass-strong flex h-[78px] items-center gap-4 rounded-[24px] pr-4 pl-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]">
        <TrackCover id={track.id} className="size-[54px] shrink-0" rounded="rounded-[16px]" />
        <div className="w-[210px] min-w-0">
          <div className="truncate font-display text-[14px] font-semibold">{track.title}</div>
          <div className="truncate text-[12px] text-muted">
            {[track.bpm && `${track.bpm} BPM`, track.keyscale, track.genres].filter(Boolean).join(' · ') || track.caption}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <IconButton onClick={() => step(-1)} disabled={idx <= 0}>
            <SkipBack className="size-4" />
          </IconButton>
          <button
            onClick={() => setPlaying(!player.playing)}
            className="brand-gradient glow-magenta flex size-11 items-center justify-center rounded-full text-white transition-transform active:scale-95"
          >
            {player.playing ? <Pause className="size-5" fill="currentColor" /> : <Play className="ml-0.5 size-5" fill="currentColor" />}
          </button>
          <IconButton onClick={() => step(1)} disabled={idx < 0 || idx >= list.length - 1}>
            <SkipForward className="size-4" />
          </IconButton>
        </div>
        <span className="w-10 text-right font-mono text-[11.5px] text-muted tabular-nums">{fmtDuration(time)}</span>
        <div ref={waveRef} className="min-w-0 flex-1 cursor-pointer" />
        <span className="w-10 font-mono text-[11.5px] text-muted tabular-nums">{fmtDuration(dur || track.durationSec)}</span>
        <div className="flex items-center gap-1">
          <IconButton onClick={() => setMuted(!muted)}>{muted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</IconButton>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => {
              setVolume(Number(e.target.value))
              setMuted(false)
            }}
            className="range w-20"
            style={{ ['--fill' as any]: `${(muted ? 0 : volume) * 100}%` }}
          />
          <IconButton title={t('library.favorite')} onClick={() => attempt(() => api.trackUpdate(track.id, { favorite: !track.favorite }))}>
            <Heart className={clsx('size-4', track.favorite && 'fill-magenta text-magenta')} />
          </IconButton>
          <IconButton
            title={t('library.saveAs')}
            onClick={async () => {
              const p = await attempt(() => api.trackSaveAs(track.id))
              if (p) useApp.getState().toast(t('library.saved', { path: p }), 'ok')
            }}
          >
            <Download className="size-4" />
          </IconButton>
          <IconButton title={t('common.close')} onClick={() => useApp.setState({ player: { trackId: null, playing: false, queueIds: [] } })}>
            <X className="size-4" />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
