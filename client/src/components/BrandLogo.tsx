type BrandLogoProps = { compact?: boolean };

export default function BrandLogo({ compact = false }: BrandLogoProps) {
  return <img className={`btl-logo ${compact ? "is-compact" : ""}`} src={`${import.meta.env.BASE_URL}btl-beyond-the-line-v2.webp`} alt="" aria-label="Beyond The Line — BTL Africa" width={52} height={45} decoding="async" fetchPriority="high" />;
}
