import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown, RotateCcw, LayoutDashboard } from "lucide-react";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { HOME_SECTIONS } from "@/lib/homeLayout";
import { cn } from "@/lib/utils";

export const HomeLayoutEditor = () => {
  const { state, toggleSection, moveSection, reset } = useHomeLayout();

  const orderedSections = state.order
    .map((id) => HOME_SECTIONS.find((s) => s.id === id))
    .filter((s): s is (typeof HOME_SECTIONS)[number] => Boolean(s));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          <LayoutDashboard className="h-4 w-4" />
          Home Layout
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={reset}
          className="text-xs text-muted-foreground"
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          Reset
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Toggle features on or off and reorder them on your home page.
      </p>

      <div className="space-y-2">
        {orderedSections.map((section, index) => {
          const visible = !state.hidden.includes(section.id);
          const isFirst = index === 0;
          const isLast = index === orderedSections.length - 1;

          return (
            <div
              key={section.id}
              className={cn(
                "flex items-center gap-2 p-3 rounded-xl border bg-card transition-colors",
                visible ? "border-border" : "border-border/40 opacity-60",
              )}
            >
              <div className="flex flex-col">
                <button
                  onClick={() => moveSection(section.id, -1)}
                  disabled={isFirst}
                  className={cn(
                    "h-5 w-5 flex items-center justify-center rounded text-muted-foreground",
                    "hover:bg-muted hover:text-foreground transition-colors",
                    "disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
                  )}
                  aria-label={`Move ${section.label} up`}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => moveSection(section.id, 1)}
                  disabled={isLast}
                  className={cn(
                    "h-5 w-5 flex items-center justify-center rounded text-muted-foreground",
                    "hover:bg-muted hover:text-foreground transition-colors",
                    "disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
                  )}
                  aria-label={`Move ${section.label} down`}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground text-sm truncate">
                  {section.label}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {section.description}
                  {section.alwaysOn && " · Always shown"}
                </p>
              </div>

              <Switch
                checked={visible}
                disabled={section.alwaysOn}
                onCheckedChange={() => toggleSection(section.id)}
                aria-label={`Toggle ${section.label}`}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
};
