type BrandLogoProps = { compact?: boolean };

export default function BrandLogo({ compact = false }: BrandLogoProps) {
  return <img className={`btl-logo ${compact ? "is-compact" : ""}`} src="/btl-beyond-the-line.jpg" alt="Beyond The Line — BTL Africa" />;
}
