import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStages } from "@/hooks/useStages";
import { useDialect } from "@/contexts/DialectContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const DIALECTS = ["Gulf", "Egyptian", "Yemeni"] as const;
type Dialect = (typeof DIALECTS)[number];

interface Cell {
  stageId: string;
  dialect: Dialect;
  lessons: number;
  words: number;
  sentences: number;
}

// Density tiers based on word count
function densityClass(words: number): string {
  if (words === 0) return "bg-destructive/10 border-destructive/30 text-destructive";
  if (words < 25) return "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300";
  if (words < 75) return "bg-primary/15 border-primary/30 text-foreground";
  if (words < 200) return "bg-primary/30 border-primary/50 text-foreground";
  return "bg-primary/50 border-primary text-primary-foreground";
}

export default function CoverageHeatmap() {
  const navigate = useNavigate();
  const { setDialect } = useDialect();
  const { data: stages = [], isLoading: stagesLoading } = useStages();

  const { data: counts, isLoading } = useQuery({
    queryKey: ["coverage-heatmap"],
    queryFn: async () => {
      const [lessonsRes, vocabRes, conceptsRes] = await Promise.all([
        supabase.from("lessons").select("id, stage_id, dialect_module"),
        supabase.from("vocabulary_words").select("lesson_id, dialect_module"),
        supabase
          .from("curriculum_concepts" as never)
          .select("dialect, stage_id, kind"),
      ]);
      if (lessonsRes.error) throw lessonsRes.error;
      if (vocabRes.error) throw vocabRes.error;

      const lessons = (lessonsRes.data ?? []) as Array<{
        id: string;
        stage_id: string | null;
        dialect_module: string | null;
      }>;
      const vocab = (vocabRes.data ?? []) as Array<{
        lesson_id: string | null;
        dialect_module: string | null;
      }>;
      const concepts = ((conceptsRes.data ?? []) as unknown) as Array<{
        dialect: string;
        stage_id: string | null;
        kind: string;
      }>;

      const lessonMap = new Map<string, { stage_id: string | null; dialect: string | null }>();
      lessons.forEach((l) =>
        lessonMap.set(l.id, { stage_id: l.stage_id, dialect: l.dialect_module }),
      );

      return { lessons, vocab, concepts, lessonMap };
    },
  });

  const grid: Cell[][] = useMemo(() => {
    if (!counts || !stages.length) return [];
    return stages.map((stage) =>
      DIALECTS.map((dialect) => {
        const lessons = counts.lessons.filter(
          (l) => l.stage_id === stage.id && l.dialect_module === dialect,
        ).length;
        const words = counts.vocab.filter((v) => {
          if (v.dialect_module !== dialect) return false;
          if (!v.lesson_id) return false;
          const l = counts.lessonMap.get(v.lesson_id);
          return l?.stage_id === stage.id;
        }).length;
        const sentences = counts.concepts.filter(
          (c) =>
            c.dialect === dialect &&
            c.stage_id === stage.id &&
            (c.kind === "phrase" || c.kind === "scenario"),
        ).length;
        return { stageId: stage.id, dialect, lessons, words, sentences };
      }),
    );
  }, [counts, stages]);

  const handleDraft = (dialect: Dialect, stageName: string) => {
    setDialect(dialect as never);
    navigate("/admin/curriculum-builder", {
      state: {
        seedPrompt: `Draft a lesson for the ${stageName} stage in ${dialect} Arabic. Focus on coverage gaps — pick a fresh, high-value topic the curriculum doesn't yet have.`,
      },
    });
  };

  if (stagesLoading || isLoading) {
    return (
      <Card className="p-4 space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">Coverage heatmap</h2>
          <p className="text-xs text-muted-foreground">
            Stage × dialect — colored by vocabulary depth. Click a thin cell to draft new content.
          </p>
        </div>
        <Legend />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 min-w-[520px]">
          <thead>
            <tr>
              <th className="text-left text-xs font-medium text-muted-foreground px-2 py-1 w-40">
                Stage
              </th>
              {DIALECTS.map((d) => (
                <th
                  key={d}
                  className="text-xs font-medium text-muted-foreground px-2 py-1"
                >
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stages.map((stage, i) => (
              <tr key={stage.id}>
                <td className="text-sm font-medium px-2 py-1 align-middle">
                  <div className="flex flex-col">
                    <span>
                      {stage.stage_number}. {stage.name}
                    </span>
                    {stage.cefr_level && (
                      <span className="text-[10px] text-muted-foreground uppercase">
                        {stage.cefr_level}
                      </span>
                    )}
                  </div>
                </td>
                {grid[i]?.map((cell) => (
                  <td key={cell.dialect} className="p-0 align-middle">
                    <button
                      onClick={() => handleDraft(cell.dialect, stage.name)}
                      className={cn(
                        "w-full h-full rounded-md border p-2 text-left transition hover:scale-[1.02] hover:shadow-sm group",
                        densityClass(cell.words),
                      )}
                      title={`${cell.words} words · ${cell.lessons} lessons · click to draft`}
                    >
                      <div className="text-lg font-bold leading-none">
                        {cell.words}
                      </div>
                      <div className="text-[10px] opacity-80 mt-1 flex items-center justify-between">
                        <span>{cell.lessons}L</span>
                        {cell.words < 25 && (
                          <Sparkles className="h-3 w-3 opacity-0 group-hover:opacity-100 transition" />
                        )}
                      </div>
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Each cell shows total <strong>vocabulary words</strong>, with lesson count below.
        Red/amber cells are coverage gaps.
      </p>
    </Card>
  );
}

function Legend() {
  const items = [
    { label: "Empty", cls: "bg-destructive/10 border-destructive/30" },
    { label: "Thin", cls: "bg-amber-500/15 border-amber-500/40" },
    { label: "OK", cls: "bg-primary/15 border-primary/30" },
    { label: "Strong", cls: "bg-primary/30 border-primary/50" },
    { label: "Deep", cls: "bg-primary/50 border-primary" },
  ];
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-1">
          <span className={cn("h-3 w-3 rounded-sm border", it.cls)} />
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}
