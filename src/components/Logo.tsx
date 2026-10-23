/** Brand mark: two cards joined by an arrow, one click target circled. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo">
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <rect x="8" y="20" width="18" height="24" rx="3" fill="#fff" />
      <rect x="38" y="20" width="18" height="24" rx="3" fill="#fff" />
      <path d="M28 32h6" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M32.5 28.5 36 32l-3.5 3.5"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <ellipse cx="47" cy="35" rx="6" ry="4.5" fill="none" stroke="#e03131" strokeWidth="2.5" />
    </svg>
  )
}
