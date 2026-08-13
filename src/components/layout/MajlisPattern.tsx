/**
 * MajlisPattern - Subtle geometric background patterns
 *
 * Brand guide motifs: diamond/chevron geometric patterns.
 * Very low opacity (3-6%), large partially-cropped shapes.
 * Colors: Desert Red, Warm Sand, Charcoal only.
 */
export function MajlisPattern() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      {/* Top-right: Large diamond lattice pattern */}
      <svg
        className="absolute -top-32 -right-24 w-[500px] h-[500px]"
        viewBox="0 0 200 200"
        fill="none"
        style={{ opacity: 0.04 }}
      >
        <pattern id="diamond-lattice" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
          <path
            d="M20 0L40 20L20 40L0 20Z"
            stroke="hsl(150 7% 21%)"
            strokeWidth="1"
            fill="none"
          />
          <circle cx="20" cy="20" r="3" fill="hsl(38 35% 50%)" />
        </pattern>
        <rect width="200" height="200" fill="url(#diamond-lattice)" />
      </svg>

      {/* Bottom-left: Nested diamond grid */}
      <svg
        className="absolute -bottom-40 -left-32 w-[600px] h-[600px]"
        viewBox="0 0 200 200"
        fill="none"
        style={{ opacity: 0.035 }}
      >
        <pattern id="nested-diamonds" x="0" y="0" width="50" height="50" patternUnits="userSpaceOnUse">
          <path
            d="M25 0L50 25L25 50L0 25Z"
            stroke="hsl(8 42% 40%)"
            strokeWidth="1"
            fill="none"
          />
          <path
            d="M25 10L40 25L25 40L10 25Z"
            stroke="hsl(8 42% 40%)"
            strokeWidth="0.5"
            fill="none"
          />
        </pattern>
        <rect width="200" height="200" fill="url(#nested-diamonds)" />
      </svg>

      {/* Top-left: Interlocking diamond squares */}
      <svg
        className="absolute -top-48 -left-20 w-[400px] h-[400px] rotate-12"
        viewBox="0 0 200 200"
        fill="none"
        style={{ opacity: 0.03 }}
      >
        <pattern id="interlocking-diamonds" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
          <rect x="10" y="10" width="40" height="40" stroke="hsl(38 30% 45%)" strokeWidth="1" fill="none" />
          <rect x="20" y="20" width="20" height="20" stroke="hsl(38 30% 45%)" strokeWidth="0.5" fill="none" transform="rotate(45 30 30)" />
        </pattern>
        <rect width="200" height="200" fill="url(#interlocking-diamonds)" />
      </svg>

      {/* Right side: Chevron stripe pattern */}
      <svg
        className="absolute top-1/3 -right-16 w-[300px] h-[500px]"
        viewBox="0 0 100 200"
        fill="none"
        style={{ opacity: 0.04 }}
      >
        <pattern id="chevron-stripes" x="0" y="0" width="30" height="20" patternUnits="userSpaceOnUse">
          <path
            d="M0 20L15 10L30 20"
            stroke="hsl(150 7% 21%)"
            strokeWidth="1"
            fill="none"
          />
          <path
            d="M0 15L15 5L30 15"
            stroke="hsl(8 45% 38%)"
            strokeWidth="0.5"
            fill="none"
          />
        </pattern>
        <rect width="100" height="200" fill="url(#chevron-stripes)" />
      </svg>

      {/* Bottom-right: Large arabesque curve */}
      <svg
        className="absolute -bottom-24 -right-32 w-[450px] h-[450px]"
        viewBox="0 0 200 200"
        fill="none"
        style={{ opacity: 0.045 }}
      >
        <path
          d="M0 200 Q 50 150, 100 150 T 200 100"
          stroke="hsl(8 42% 40%)"
          strokeWidth="2"
          fill="none"
        />
        <path
          d="M0 180 Q 60 130, 120 140 T 200 80"
          stroke="hsl(38 30% 50%)"
          strokeWidth="1.5"
          fill="none"
        />
        <path
          d="M20 200 Q 70 160, 130 160 T 200 120"
          stroke="hsl(150 7% 21%)"
          strokeWidth="1"
          fill="none"
        />
      </svg>

      {/* Center-left: 8-pointed star with brand colors */}
      <svg
        className="absolute top-1/2 -left-24 w-[350px] h-[350px] -translate-y-1/2"
        viewBox="0 0 200 200"
        fill="none"
        style={{ opacity: 0.035 }}
      >
        <g transform="translate(100, 100)">
          {/* 8-pointed star outline */}
          <polygon
            points="0,-60 17,-17 60,0 17,17 0,60 -17,17 -60,0 -17,-17"
            stroke="hsl(38 35% 50%)"
            strokeWidth="1"
            fill="none"
          />
          <polygon
            points="0,-40 11,-11 40,0 11,11 0,40 -11,11 -40,0 -11,-11"
            stroke="hsl(150 7% 21%)"
            strokeWidth="0.75"
            fill="none"
          />
          <circle r="15" stroke="hsl(8 42% 40%)" strokeWidth="0.5" fill="none" />
        </g>
      </svg>

      {/* Floating diamond accents */}
      <svg
        className="absolute top-24 left-1/4 w-16 h-16"
        viewBox="0 0 40 40"
        fill="none"
        style={{ opacity: 0.05 }}
      >
        <path d="M20 5L35 20L20 35L5 20Z" stroke="hsl(8 45% 38%)" strokeWidth="1" fill="none" />
      </svg>

      <svg
        className="absolute bottom-32 right-1/3 w-12 h-12"
        viewBox="0 0 40 40"
        fill="none"
        style={{ opacity: 0.04 }}
      >
        <path d="M20 8L32 20L20 32L8 20Z" stroke="hsl(8 42% 40%)" strokeWidth="0.75" fill="none" />
      </svg>
    </div>
  );
}
