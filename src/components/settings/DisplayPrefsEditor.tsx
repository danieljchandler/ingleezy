import { Eye } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useDisplayPrefs } from "@/hooks/useDisplayPrefs";

const ROWS: Array<{
  key: "showArabic" | "showTashkil" | "showFormal" | "showEnglish";
  label: string;
  desc: string;
}> = [
  { key: "showArabic", label: "Dialect Arabic", desc: "Main text in your chosen dialect" },
  { key: "showTashkil", label: "Tashkil (diacritics)", desc: "Show vowel marks on Arabic letters" },
  { key: "showFormal", label: "Formal Arabic (MSA)", desc: "Standard Arabic version, when available" },
  { key: "showEnglish", label: "English translation", desc: "English text, when available" },
];

/**
 * Global display preferences editor. Applies across all learning modules
 * (Bible Lessons, Reading Practice, Stories, Transcripts, etc.) wherever
 * the renderer reads from `useDisplayPrefs`.
 */
export function DisplayPrefsEditor() {
  const { prefs, update } = useDisplayPrefs();

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        <Eye className="h-4 w-4" />
        Display Preferences
      </div>
      <p className="text-xs text-muted-foreground">
        Choose what to show by default across the app — lessons, transcripts, stories, and reading.
        Turn things off to focus your memory.
      </p>
      <div className="space-y-2">
        {ROWS.map((row) => (
          <div
            key={row.key}
            className="flex items-center justify-between p-3 rounded-xl bg-card border border-border"
          >
            <div className="min-w-0 pr-3">
              <p className="font-medium text-foreground text-sm">{row.label}</p>
              <p className="text-xs text-muted-foreground">{row.desc}</p>
            </div>
            <Switch
              checked={prefs[row.key]}
              onCheckedChange={(v) => update({ [row.key]: v } as any)}
              disabled={row.key === "showTashkil" && !prefs.showArabic}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
