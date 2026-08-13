import saduBannerImg from "@/assets/sadu-banner.webp";

/**
 * SaduBanner - Geometric diamond strip banner
 *
 * Traditional Sadu-inspired woven pattern strip for page headers.
 * Uses the actual Sadu border PNG image, tiled horizontally.
 */

export function SaduBanner() {
  return (
    <div className="w-full" aria-hidden="true">
      {/* Main Sadu pattern strip - PNG, tiled horizontally at natural size */}
      <div
        style={{
          width: '100%',
          height: 40,
          backgroundImage: `url(${saduBannerImg})`,
          backgroundRepeat: 'repeat-x',
          backgroundSize: 'auto 100%',
          backgroundPosition: 'center top',
        }}
      />
    </div>
  );
}
