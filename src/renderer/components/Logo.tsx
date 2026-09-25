export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-label="AceDeck">
      <defs>
        <linearGradient id="lg-bg" x1="6" y1="4" x2="60" y2="62" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF5BD2" />
          <stop offset="0.5" stopColor="#B24DF4" />
          <stop offset="1" stopColor="#5B5CFF" />
        </linearGradient>
        <radialGradient id="lg-hi" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(18 12) rotate(50) scale(40)">
          <stop stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#lg-bg)" />
      <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#lg-hi)" />
      {/* equalizer bars forming an "A" peak */}
      <g fill="#fff">
        <rect x="13" y="36" width="5.5" height="14" rx="2.75" opacity="0.75" />
        <rect x="21.5" y="26" width="5.5" height="24" rx="2.75" opacity="0.9" />
        <rect x="29.25" y="14" width="5.5" height="36" rx="2.75" />
        <rect x="37" y="26" width="5.5" height="24" rx="2.75" opacity="0.9" />
        <rect x="45.5" y="36" width="5.5" height="14" rx="2.75" opacity="0.75" />
      </g>
      <rect x="19" y="38" width="26" height="4" rx="2" fill="#2a0f4a" opacity="0.55" />
    </svg>
  )
}
