import { Eye } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useDisplayPrefs } from "@/hooks/useDisplayPrefs";

const ROWS: Array<{
  key: "showArabic" | "showTashkil" | "showFormal" | "showEnglish";
  label: string;
  desc: string;
}> = [
  { key: "showArabic", label: "شرح بلهجتك", desc: "المعنى بلهجتك التي اخترتها" },
  { key: "showTashkil", label: "التشكيل", desc: "إظهار الحركات على الحروف العربية" },
  { key: "showFormal", label: "الفصحى", desc: "نسخة بالعربية الفصحى، عند توفرها" },
  { key: "showEnglish", label: "النص الإنجليزي", desc: "النص بالإنجليزية، عند توفره" },
];

/**
 * Global display preferences editor. Applies across all learning modules
 * (Reading Practice, Stories, Transcripts, etc.) wherever the renderer reads
 * from `useDisplayPrefs`.
 */
export function DisplayPrefsEditor() {
  const { prefs, update } = useDisplayPrefs();

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        <Eye className="h-4 w-4" />
        تفضيلات العرض
      </div>
      <p className="text-xs text-muted-foreground">
        اختر ما يظهر افتراضياً في التطبيق — الدروس والتفريغات والقصص والقراءة.
        أطفئ ما لا تحتاجه لتجهد ذاكرتك أكثر.
      </p>
      <div className="space-y-2">
        {ROWS.map((row) => (
          <div
            key={row.key}
            className="flex items-center justify-between p-3 rounded-xl bg-card border border-border"
          >
            <div className="min-w-0 pe-3">
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
