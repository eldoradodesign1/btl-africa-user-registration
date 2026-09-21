type BrandLogoProps = { compact?: boolean };

export default function BrandLogo({ compact = false }: BrandLogoProps) {
  return <svg className={`btl-logo ${compact ? "is-compact" : ""}`} viewBox="0 0 154 42" role="img" aria-label="BTL Africa" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="btl-wordmark" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#e9ffff" />
        <stop offset=".48" stopColor="#6be0f5" />
        <stop offset="1" stopColor="#147ed0" />
      </linearGradient>
    </defs>
    <text x="1" y="27" fill="url(#btl-wordmark)" fontFamily="Arial, Helvetica, sans-serif" fontSize="29" fontWeight="900" letterSpacing="-2.2">BTL</text>
    <path d="M3 33h65" stroke="#b7ef72" strokeWidth="2.5" strokeLinecap="round" />
    <text x="78" y="25" fill="#d9f4f6" fontFamily="Arial, Helvetica, sans-serif" fontSize="10" fontWeight="700" letterSpacing="1.6">AFRICA</text>
    <circle cx="145" cy="11" r="3" fill="#ff795c" />
  </svg>;
}
