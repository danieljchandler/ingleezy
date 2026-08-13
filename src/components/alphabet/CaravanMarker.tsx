/**
 * CaravanMarker - small camel SVG that bobs in place, used to indicate the
 * learner's current spot on the Alphabet Journey trail.
 */
export function CaravanMarker({ size = 36 }: { size?: number }) {
  return (
    <div
      className="animate-camel-bob inline-flex"
      style={{ width: size, height: size }}
      aria-label="You are here"
      title="You are here"
    >
      <svg viewBox="0 0 64 48" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
        {/* body */}
        <path
          d="M8,34 Q10,22 18,22 Q22,14 28,22 Q34,12 40,22 Q48,22 52,34 L48,34 L48,40 L44,40 L44,34 L20,34 L20,40 L16,40 L16,34 Z"
          fill="#B07B3F"
          stroke="#6F4A1E"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        {/* head + neck */}
        <path
          d="M50,28 Q56,24 56,16 Q56,12 53,12 Q50,12 50,16 L50,22 L46,26 Z"
          fill="#B07B3F"
          stroke="#6F4A1E"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        {/* eye */}
        <circle cx="53.5" cy="15.5" r="0.9" fill="#2A1A0A" />
        {/* tail */}
        <path d="M8,28 Q4,28 4,32" stroke="#6F4A1E" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        {/* ground shadow */}
        <ellipse cx="32" cy="44" rx="22" ry="2" fill="#000" opacity="0.12" />
      </svg>
    </div>
  );
}
