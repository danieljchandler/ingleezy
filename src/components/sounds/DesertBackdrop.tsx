/**
 * DesertBackdrop - Subtle desert scene rendered as fixed layers behind the
 * Alphabet Journey trail. Sky + sun + mountains stay static while clouds
 * and dunes drift slowly for a gentle parallax effect.
 */
export function DesertBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
      {/* Static base: sky, sun, mountains */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 400 800"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
        style={{ opacity: 0.85 }}
      >
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#EDF0F9" />
            <stop offset="55%" stopColor="#DDE3F4" />
            <stop offset="100%" stopColor="#C3CCE9" />
          </linearGradient>
          <radialGradient id="sun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#E8B36A" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#E8B36A" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="400" height="800" fill="url(#sky)" />
        <circle cx="320" cy="90" r="140" fill="url(#sun)" />
        <circle cx="320" cy="90" r="28" fill="#D98A3D" opacity="0.55" />
        <path
          d="M0,210 L60,170 L110,200 L170,160 L230,205 L290,175 L360,210 L400,195 L400,260 L0,260 Z"
          fill="#8A97C9"
          opacity="0.35"
        />
      </svg>

      {/* Drifting clouds (slow) */}
      <svg
        className="absolute inset-0 w-full h-full animate-drift-slower"
        viewBox="0 0 400 800"
        preserveAspectRatio="xMidYMid slice"
        style={{ opacity: 0.55 }}
      >
        <g fill="#FFFFFF" opacity="0.55">
          <ellipse cx="80" cy="120" rx="34" ry="8" />
          <ellipse cx="105" cy="115" rx="22" ry="7" />
          <ellipse cx="230" cy="80" rx="28" ry="6" />
          <ellipse cx="250" cy="85" rx="18" ry="5" />
        </g>
      </svg>

      {/* Mid dune + oasis (slow drift) */}
      <svg
        className="absolute inset-0 w-full h-full animate-drift-slow"
        viewBox="0 0 400 800"
        preserveAspectRatio="xMidYMid slice"
        style={{ opacity: 0.85 }}
      >
        <defs>
          <linearGradient id="dune1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#AAB5DE" />
            <stop offset="100%" stopColor="#7184C6" />
          </linearGradient>
          <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6FB394" />
            <stop offset="100%" stopColor="#3F9C6D" />
          </linearGradient>
        </defs>

        <path
          d="M0,300 Q120,240 220,290 T400,280 L400,360 L0,360 Z"
          fill="url(#dune1)"
          opacity="0.65"
        />

        <g transform="translate(40,470)" opacity="0.75">
          <ellipse cx="40" cy="40" rx="55" ry="14" fill="url(#water)" />
          <ellipse cx="40" cy="38" rx="40" ry="6" fill="#A9D8C0" opacity="0.5" />
          <path d="M20,40 Q18,10 22,-30" stroke="#1B2534" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M55,40 Q60,5 56,-40" stroke="#1B2534" strokeWidth="3" fill="none" strokeLinecap="round" />
          <g transform="translate(22,-30)">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
              <path key={a} d="M0,0 Q14,-4 26,2" stroke="#35835B" strokeWidth="2.5" fill="none" strokeLinecap="round" transform={`rotate(${a})`} />
            ))}
          </g>
          <g transform="translate(56,-40)">
            {[20, 65, 110, 155, 200, 245, 290, 335].map((a) => (
              <path key={a} d="M0,0 Q16,-3 30,3" stroke="#3F9C6D" strokeWidth="2.5" fill="none" strokeLinecap="round" transform={`rotate(${a})`} />
            ))}
          </g>
        </g>
      </svg>

      {/* Near dune + right oasis (drifts opposite direction) */}
      <svg
        className="absolute inset-0 w-full h-full animate-drift-slower"
        viewBox="0 0 400 800"
        preserveAspectRatio="xMidYMid slice"
        style={{ opacity: 0.9 }}
      >
        <defs>
          <linearGradient id="dune2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9AA6D4" />
            <stop offset="100%" stopColor="#7B89BE" />
          </linearGradient>
          <linearGradient id="water2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6FB394" />
            <stop offset="100%" stopColor="#3F9C6D" />
          </linearGradient>
        </defs>

        <path
          d="M0,560 Q140,490 260,540 T400,520 L400,800 L0,800 Z"
          fill="url(#dune2)"
        />

        <g transform="translate(290,640)" opacity="0.8">
          <ellipse cx="30" cy="20" rx="38" ry="8" fill="url(#water2)" />
          <path d="M15,20 Q12,-5 18,-35" stroke="#1B2534" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <g transform="translate(18,-35)">
            {[10, 55, 100, 145, 190, 235, 280, 325].map((a) => (
              <path key={a} d="M0,0 Q12,-3 22,2" stroke="#35835B" strokeWidth="2" fill="none" strokeLinecap="round" transform={`rotate(${a})`} />
            ))}
          </g>
        </g>

        {/* Sand texture dots */}
        <g fill="#6C7AB2" opacity="0.18">
          {Array.from({ length: 60 }).map((_, i) => {
            const x = (i * 37) % 400;
            const y = 380 + ((i * 53) % 380);
            return <circle key={i} cx={x} cy={y} r={0.8} />;
          })}
        </g>
      </svg>
    </div>
  );
}
