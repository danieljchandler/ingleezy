import { useUserXP, xpProgressInLevel } from "@/hooks/useGamification";
import { Progress } from "@/components/ui/progress";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface XPDisplayProps {
  compact?: boolean;
  className?: string;
}

export function XPDisplay({ compact = false, className }: XPDisplayProps) {
  const { data: userXP, isLoading } = useUserXP();

  if (isLoading || !userXP) return null;

  const progress = xpProgressInLevel(userXP.total_xp);

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10">
          <Sparkles className="h-3 w-3 text-primary" />
          <span className="text-xs font-semibold text-primary">{userXP.total_xp} XP</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30">
          <span className="text-xs font-bold text-amber-600 dark:text-amber-400">Lv.{userXP.level}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("bg-card rounded-xl p-4 border border-border", className)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
            <span className="text-lg font-bold text-primary-foreground">{userXP.level}</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Level {userXP.level}</p>
            <p className="text-xs text-muted-foreground">{userXP.total_xp} total XP</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Next level</p>
          <p className="text-sm font-semibold text-primary">{progress.current}/{progress.needed}</p>
        </div>
      </div>
      <Progress value={progress.percent} className="h-2" />
    </div>
  );
}
