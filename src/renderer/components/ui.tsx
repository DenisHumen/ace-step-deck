import { clsx } from 'clsx'
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Check, ChevronDown, Copy, Loader2, Minus, Plus } from 'lucide-react'
import { hash } from '../lib/format'

// ─── Buttons ─────────────────────────────────────────────────────────────────
type Variant = 'primary' | 'glass' | 'ghost' | 'danger' | 'soft'

export function Button({
  variant = 'glass',
  size = 'md',
  icon,
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'no-drag relative inline-flex items-center justify-center gap-2 rounded-full font-display font-medium whitespace-nowrap transition-all duration-150 select-none',
        'disabled:opacity-45 active:scale-[0.98]',
        size === 'sm' && 'h-8 px-3.5 text-[12.5px]',
        size === 'md' && 'h-10 px-5 text-[13.5px]',
        size === 'lg' && 'h-12 px-7 text-[15px]',
        variant === 'primary' && 'brand-gradient text-white glow-magenta hover:brightness-110',
        variant === 'glass' && 'glass text-fg hover:bg-white/10',
        variant === 'soft' && 'bg-white/[0.06] text-fg hover:bg-white/[0.1] border border-white/[0.06]',
        variant === 'ghost' && 'text-muted hover:text-fg hover:bg-white/[0.06]',
        variant === 'danger' && 'bg-rose/15 text-rose border border-rose/25 hover:bg-rose/25',
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function IconButton({
  children,
  className,
  active,
  tone,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; tone?: 'danger' }) {
  return (
    <button
      {...rest}
      className={clsx(
        'no-drag inline-flex size-9 items-center justify-center rounded-full transition-colors disabled:opacity-35',
        active ? 'bg-white/12 text-fg' : 'text-muted hover:text-fg hover:bg-white/[0.08]',
        tone === 'danger' && 'hover:!text-rose hover:!bg-rose/10',
        className,
      )}
    >
      {children}
    </button>
  )
}

// ─── Layout ──────────────────────────────────────────────────────────────────
export function Card({ className, children, padded = true }: { className?: string; children: ReactNode; padded?: boolean }) {
  return <div className={clsx('glass rounded-[22px]', padded && 'p-5', className)}>{children}</div>
}

export function CardTitle({ icon, children, right }: { icon?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      {icon && <span className="flex size-7 items-center justify-center rounded-full bg-white/[0.07] text-orchid">{icon}</span>}
      <h3 className="font-display text-[15px] font-semibold tracking-tight">{children}</h3>
      <div className="ml-auto">{right}</div>
    </div>
  )
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-7 flex items-end gap-6">
      <div className="min-w-0">
        <h1 className="font-display text-[30px] leading-tight font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[14px] text-muted">{subtitle}</p>}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2.5">{right}</div>
    </div>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="label">{label}</span>
      </div>
      {children}
      {hint && <p className="mt-1.5 text-[12px] leading-snug text-dim">{hint}</p>}
    </label>
  )
}

// ─── Inputs ──────────────────────────────────────────────────────────────────
export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; hint?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="no-drag group flex w-full items-center gap-3 text-left disabled:opacity-40"
    >
      <span
        className={clsx(
          'relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full transition-colors',
          checked ? 'brand-gradient' : 'bg-white/[0.12]',
        )}
      >
        <span className={clsx('absolute size-[16px] rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[21px]' : 'translate-x-[3px]')} />
      </span>
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-[13.5px] text-fg">{label}</span>}
          {hint && <span className="block text-[12px] leading-snug text-dim">{hint}</span>}
        </span>
      )}
    </button>
  )
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  disabled,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  disabled?: boolean
}) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        className="range no-drag"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ['--fill' as any]: `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="w-14 shrink-0 text-right font-mono text-[12.5px] text-muted tabular-nums">{format ? format(value) : value}</span>
    </div>
  )
}

export function Select<T extends string>({ value, onChange, options, className, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string; disabled?: boolean }) {
  return (
    <select className={clsx('field no-drag', className)} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Stepper({ value, onChange, min = 1, max = 100 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="no-drag inline-flex h-10 items-center rounded-full border border-white/[0.08] bg-white/[0.04]">
      <button className="flex size-10 items-center justify-center text-muted hover:text-fg disabled:opacity-30" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus className="size-4" />
      </button>
      <input
        className="w-10 bg-transparent text-center font-display text-[15px] font-semibold tabular-nums outline-none"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ''))
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n || min)))
        }}
      />
      <button className="flex size-10 items-center justify-center text-muted hover:text-fg disabled:opacity-30" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus className="size-4" />
      </button>
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: ReactNode }[]; className?: string }) {
  return (
    <div className={clsx('no-drag inline-flex rounded-full border border-white/[0.07] bg-white/[0.035] p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'flex h-8 items-center gap-1.5 rounded-full px-4 font-display text-[13px] font-medium transition-all',
            value === o.value ? 'bg-white/[0.12] text-fg shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]' : 'text-muted hover:text-fg',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chip({ children, active, onClick, className, title }: { children: ReactNode; active?: boolean; onClick?: () => void; className?: string; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={clsx(
        'no-drag inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] transition-all',
        active ? 'border-orchid/50 bg-orchid/15 text-fg' : 'border-white/[0.08] bg-white/[0.04] text-muted hover:border-white/15 hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Collapsible({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button className="no-drag flex w-full items-center gap-2 py-1 text-left font-display text-[14px] font-medium text-muted hover:text-fg" onClick={() => setOpen(!open)}>
        <ChevronDown className={clsx('size-4 transition-transform', !open && '-rotate-90')} />
        {title}
      </button>
      {open && <div className="pt-4">{children}</div>}
    </div>
  )
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      size="sm"
      variant="soft"
      icon={done ? <Check className="size-3.5 text-mint" /> : <Copy className="size-3.5" />}
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {label}
    </Button>
  )
}

// ─── Progress ────────────────────────────────────────────────────────────────
export function ProgressBar({ value, indeterminate, className, tone = 'brand', thin }: { value: number | null; indeterminate?: boolean; className?: string; tone?: 'brand' | 'mint' | 'rose'; thin?: boolean }) {
  const ind = indeterminate || value === null
  return (
    <div className={clsx('relative overflow-hidden rounded-full bg-white/[0.07]', thin ? 'h-1.5' : 'h-2.5', className)}>
      <div
        className={clsx(
          'absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out',
          tone === 'brand' && 'brand-gradient',
          tone === 'mint' && 'bg-mint',
          tone === 'rose' && 'bg-rose',
          ind && 'w-1/3 animate-[shimmer_1.4s_linear_infinite]',
        )}
        style={ind ? { animation: 'indet 1.3s ease-in-out infinite' } : { width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%` }}
      />
      {!ind && (value ?? 0) > 0 && (value ?? 0) < 1 && <div className="shimmer absolute inset-0 opacity-40" />}
      <style>{'@keyframes indet{0%{left:-35%}100%{left:100%}}'}</style>
    </div>
  )
}

export function ProgressRing({ value, size = 120, stroke = 10, children, spin }: { value: number | null; size?: number; stroke?: number; children?: ReactNode; spin?: boolean }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = value === null ? 0.28 : Math.max(0, Math.min(1, value))
  const id = `ring-${size}-${stroke}`
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className={clsx('-rotate-90', (spin || value === null) && 'animate-spin-slow')}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f043c6" />
            <stop offset="55%" stopColor="#c04cf2" />
            <stop offset="100%" stopColor="#53d2ff" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: 'stroke-dashoffset 0.6s ease', filter: 'drop-shadow(0 0 8px rgba(240,67,198,0.45))' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

// ─── Decoration ──────────────────────────────────────────────────────────────
/** The glossy sphere from the reference hero, drawn in CSS. */
export function Orb({ size = 64, className }: { size?: number; className?: string }) {
  return (
    <div className={clsx('relative animate-float', className)} style={{ width: size, height: size }}>
      <div className="absolute inset-[-30%] rounded-full bg-[radial-gradient(circle,rgba(240,67,198,0.45),transparent_65%)] blur-xl" />
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'radial-gradient(circle at 30% 25%, #ffffff 0%, #ffd6f6 8%, transparent 22%), radial-gradient(circle at 70% 75%, #53d2ff 0%, transparent 45%), conic-gradient(from 210deg, #7c5cff, #f043c6, #ff9f6b, #c04cf2, #53d2ff, #7c5cff)',
          boxShadow: 'inset -8px -10px 24px rgba(20,0,40,0.65), inset 6px 6px 16px rgba(255,255,255,0.35), 0 12px 40px -10px rgba(240,67,198,0.7)',
        }}
      />
      <div className="absolute inset-[18%] rounded-full bg-[radial-gradient(circle_at_40%_35%,rgba(10,6,20,0.0),rgba(10,6,20,0.55)_70%)]" />
    </div>
  )
}

export function WaveBars({ count = 24, active = true, className, seed = 'x' }: { count?: number; active?: boolean; className?: string; seed?: string }) {
  const h = hash(seed)
  return (
    <div className={clsx('flex h-full items-end gap-[3px]', className)}>
      {Array.from({ length: count }, (_, i) => {
        const base = 0.25 + (((h >> (i % 24)) & 7) / 7) * 0.75
        return (
          <span
            key={i}
            className={clsx('w-[3px] rounded-full bg-gradient-to-t from-magenta to-cyan', active && 'bar-anim')}
            style={{ height: `${base * 100}%`, animationDelay: `${(i * 97) % 900}ms`, opacity: 0.85 }}
          />
        )
      })}
    </div>
  )
}

const PALETTES = [
  ['#f043c6', '#7c5cff', '#53d2ff'],
  ['#ff7a59', '#f043c6', '#5b2bd9'],
  ['#53d2ff', '#7c5cff', '#1b0f3a'],
  ['#ffb35c', '#ff4f8b', '#6a2bd9'],
  ['#3fe5a9', '#2b8cff', '#5a2bd9'],
  ['#c04cf2', '#ff6fb5', '#ffd166'],
  ['#ff5c7c', '#8f4dff', '#1a1040'],
  ['#6be4ff', '#b06bff', '#ff78c8'],
]

/** Generative gradient cover art — vivid blurred blobs like the reference cards. */
export function TrackCover({ id, className, children, rounded = 'rounded-[18px]' }: { id: string; className?: string; children?: ReactNode; rounded?: string }) {
  const h = hash(id)
  const [a, b, c] = PALETTES[h % PALETTES.length]
  const x1 = 15 + (h % 50)
  const y1 = 10 + ((h >> 5) % 40)
  const x2 = 40 + ((h >> 9) % 50)
  const y2 = 45 + ((h >> 13) % 45)
  const rot = (h >> 3) % 360
  return (
    <div
      className={clsx('relative overflow-hidden', rounded, className)}
      style={{
        background: `radial-gradient(circle at ${x1}% ${y1}%, ${a} 0%, transparent 55%), radial-gradient(circle at ${x2}% ${y2}%, ${b} 0%, transparent 60%), linear-gradient(${rot}deg, ${c}, #120d1f)`,
      }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,0,0,0.55),transparent_60%)]" />
      <div
        className="absolute rounded-full opacity-80 mix-blend-screen blur-md"
        style={{ width: '46%', height: '46%', left: `${(h >> 7) % 50}%`, top: `${(h >> 11) % 45}%`, background: `radial-gradient(circle, ${c}, transparent 70%)` }}
      />
      {children}
    </div>
  )
}

export function StatusDot({ tone, pulse }: { tone: 'mint' | 'amber' | 'rose' | 'dim' | 'cyan' | 'magenta'; pulse?: boolean }) {
  const color = { mint: 'text-mint bg-mint', amber: 'text-amber bg-amber', rose: 'text-rose bg-rose', dim: 'text-dim bg-dim', cyan: 'text-cyan bg-cyan', magenta: 'text-magenta bg-magenta' }[tone]
  return <span className={clsx('relative inline-block size-2 shrink-0 rounded-full', color, pulse && 'pulse-ring')} />
}

export function Badge({ children, tone = 'dim' }: { children: ReactNode; tone?: 'mint' | 'amber' | 'rose' | 'dim' | 'violet' | 'cyan' }) {
  return (
    <span
      className={clsx(
        'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-medium',
        tone === 'mint' && 'bg-mint/12 text-mint',
        tone === 'amber' && 'bg-amber/12 text-amber',
        tone === 'rose' && 'bg-rose/12 text-rose',
        tone === 'violet' && 'bg-violet/15 text-[#b3a4ff]',
        tone === 'cyan' && 'bg-cyan/12 text-cyan',
        tone === 'dim' && 'bg-white/[0.07] text-muted',
      )}
    >
      {children}
    </span>
  )
}

export function EmptyState({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-5 flex size-16 items-center justify-center rounded-full bg-white/[0.05] text-orchid">{icon}</div>
      <h3 className="font-display text-[18px] font-semibold">{title}</h3>
      {hint && <p className="mt-1.5 max-w-sm text-muted">{hint}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
