import { cn } from "@/lib/utils";

interface Props {
  /** 0–1 audio level */
  level: number;
  className?: string;
}

/** Thin horizontal level bar fed by useShadowRecorder().level */
export function LevelMeter({ level, className }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, level)) * 100);
  return (
    <div className={cn("h-1.5 w-full rounded-full bg-muted overflow-hidden", className)}>
      <div
        className="h-full bg-primary transition-[width] duration-75 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
