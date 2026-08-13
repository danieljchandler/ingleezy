import { cn } from "@/lib/utils";

/**
 * StopOrnament - Small decorative motif placed next to each caravan stop.
 * Cycles through 6 desert/majlis motifs by order_index so the trail feels
 * varied without becoming busy or childish. Pure SVG, no external deps.
 */
const MOTIFS = ["palm", "dune", "star", "lantern", "tent", "sun"] as const;
type Motif = (typeof MOTIFS)[number];

interface Props {
  index: number;
  side: "left" | "right";
  active: boolean;
}

export function StopOrnament({ index, side, active }: Props) {
  const motif: Motif = MOTIFS[index % MOTIFS.length];
  return (
    <div
      className={cn(
        "shrink-0 w-10 h-16 flex items-center justify-center transition-opacity",
        active ? "opacity-90" : "opacity-35",
      )}
      style={{ transform: side === "right" ? "scaleX(-1)" : undefined }}
      aria-hidden
    >
      <svg viewBox="0 0 40 64" width="40" height="64" xmlns="http://www.w3.org/2000/svg">
        {motif === "palm" && <Palm />}
        {motif === "dune" && <Dune />}
        {motif === "star" && <Star />}
        {motif === "lantern" && <Lantern />}
        {motif === "tent" && <Tent />}
        {motif === "sun" && <SunMotif />}
      </svg>
    </div>
  );
}

const PRIMARY = "#5C3A46"; // Desert Red
const GOLD = "#CFA44E";
const GREEN = "#4A7A40";
const SAND = "#B6915E";

function Palm() {
  return (
    <g>
      <path d="M20,60 Q18,40 22,18" stroke="#5C3A1E" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <g transform="translate(22,18)">
        {[0, 50, 100, 150, 200, 250, 300].map((a) => (
          <path
            key={a}
            d="M0,0 Q9,-3 17,2"
            stroke={GREEN}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            transform={`rotate(${a})`}
          />
        ))}
        <circle r="2" fill={GOLD} />
      </g>
    </g>
  );
}

function Dune() {
  return (
    <g>
      <path d="M2,52 Q14,38 22,46 T38,42 L38,58 L2,58 Z" fill={SAND} opacity="0.85" />
      <path d="M6,52 Q16,46 24,50" stroke={PRIMARY} strokeWidth="0.7" fill="none" opacity="0.5" />
    </g>
  );
}

function Star() {
  return (
    <g transform="translate(20,32)">
      <path
        d="M0,-14 L4,-4 L14,-4 L6,3 L9,13 L0,7 L-9,13 L-6,3 L-14,-4 L-4,-4 Z"
        fill="none"
        stroke={GOLD}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle r="2" fill={GOLD} />
    </g>
  );
}

function Lantern() {
  return (
    <g transform="translate(20,32)">
      <line x1="0" y1="-20" x2="0" y2="-14" stroke={PRIMARY} strokeWidth="1.4" />
      <path
        d="M-8,-14 L8,-14 L10,-2 L6,10 L-6,10 L-10,-2 Z"
        fill={PRIMARY}
        opacity="0.85"
      />
      <rect x="-5" y="-8" width="10" height="14" fill={GOLD} opacity="0.6" rx="1" />
      <line x1="-5" y1="-2" x2="5" y2="-2" stroke={PRIMARY} strokeWidth="0.6" />
      <line x1="-5" y1="3" x2="5" y2="3" stroke={PRIMARY} strokeWidth="0.6" />
      <circle cx="0" cy="12" r="1.6" fill={GOLD} />
    </g>
  );
}

function Tent() {
  return (
    <g>
      <path d="M6,52 L20,18 L34,52 Z" fill={PRIMARY} opacity="0.85" />
      <path d="M20,18 L20,52" stroke={GOLD} strokeWidth="1" />
      <path d="M14,52 L20,38 L26,52 Z" fill={SAND} />
      <circle cx="20" cy="14" r="1.8" fill={GOLD} />
    </g>
  );
}

function SunMotif() {
  return (
    <g transform="translate(20,32)">
      <circle r="6" fill={GOLD} opacity="0.85" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line
          key={a}
          x1="0"
          y1="-9"
          x2="0"
          y2="-13"
          stroke={GOLD}
          strokeWidth="1.4"
          strokeLinecap="round"
          transform={`rotate(${a})`}
        />
      ))}
    </g>
  );
}
