import { cn } from "@/lib/utils";

interface SRSStageBarProps {
  stages: {
    new: number;
    learning: number;
    familiar: number;
    practiced: number;
    strong: number;
    mastered: number;
  };
  total: number;
  className?: string;
}

const STAGE_META: Array<{ key: keyof SRSStageBarProps["stages"]; label: string; color: string }> = [
  { key: "new", label: "New", color: "bg-muted-foreground/30" },
  { key: "learning", label: "Learning", color: "bg-blue-500" },
  { key: "familiar", label: "Familiar", color: "bg-cyan-500" },
  { key: "practiced", label: "Practiced", color: "bg-emerald-500" },
  { key: "strong", label: "Strong", color: "bg-lime-500" },
  { key: "mastered", label: "Mastered", color: "bg-yellow-500" },
];

export const SRSStageBar = ({ stages, total, className }: SRSStageBarProps) => {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex h-3 rounded-full overflow-hidden bg-muted">
        {total > 0 ? (
          STAGE_META.map((stage) => {
            const count = stages[stage.key];
            const width = (count / total) * 100;
            if (count <= 0) return null;

            return (
              <div
                key={stage.key}
                className={cn("h-full", stage.color)}
                style={{ width: `${Math.max(width, 1)}%` }}
                title={`${stage.label}: ${count}`}
              />
            );
          })
        ) : (
          <div className="h-full w-full bg-muted-foreground/20" />
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {STAGE_META.map((stage) => (
          <div key={stage.key} className="flex items-center gap-2 text-xs">
            <span className={cn("h-2.5 w-2.5 rounded-full", stage.color)} />
            <span className="text-muted-foreground">
              {stage.label}
            </span>
            <span className="ml-auto font-medium text-foreground">{stages[stage.key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
