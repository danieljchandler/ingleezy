import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import CoverageHeatmap from "@/components/admin/CoverageHeatmap";

interface ConceptRow {
  id: string;
  kind: string;
  key: string;
  display_arabic: string | null;
  display_english: string | null;
  dialect: string;
  cefr_level: string | null;
  first_introduced_at: string;
}

interface LinkRow {
  concept_id: string;
  content_type: string;
  role: string;
  created_at: string;
}

export default function AdminCoverage() {
  const [dialect, setDialect] = useState<string>("Gulf");
  const [kind, setKind] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data: concepts = [], isLoading } = useQuery({
    queryKey: ["coverage-concepts", dialect, kind],
    queryFn: async () => {
      let q = supabase
        .from("curriculum_concepts" as never)
        .select("*")
        .eq("dialect", dialect)
        .order("first_introduced_at", { ascending: false })
        .limit(500);
      if (kind !== "all") q = q.eq("kind", kind);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ConceptRow[];
    },
  });

  const ids = concepts.map(c => c.id);
  const { data: links = [] } = useQuery({
    queryKey: ["coverage-links", ids.slice(0, 50).join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_concept_links" as never)
        .select("concept_id, content_type, role, created_at")
        .in("concept_id", ids);
      if (error) throw error;
      return (data ?? []) as unknown as LinkRow[];
    },
  });

  const linksByConcept = new Map<string, LinkRow[]>();
  links.forEach(l => {
    const arr = linksByConcept.get(l.concept_id) ?? [];
    arr.push(l);
    linksByConcept.set(l.concept_id, arr);
  });

  const filtered = concepts.filter(c => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      c.key.includes(s) ||
      (c.display_arabic ?? "").includes(search) ||
      (c.display_english ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="container max-w-6xl py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Curriculum Coverage</h1>
        <p className="text-sm text-muted-foreground">
          Every concept the AI has introduced into the curriculum, used to prevent duplicates and plan reinforcement.
        </p>
      </div>

      <CoverageHeatmap />

      <div className="flex flex-wrap gap-2">
        <Select value={dialect} onValueChange={setDialect}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Gulf">Gulf</SelectItem>
            <SelectItem value="Egyptian">Egyptian</SelectItem>
            <SelectItem value="Yemeni">Yemeni</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="vocab">Vocab</SelectItem>
            <SelectItem value="grammar">Grammar</SelectItem>
            <SelectItem value="theme">Theme</SelectItem>
            <SelectItem value="scenario">Scenario</SelectItem>
            <SelectItem value="phrase">Phrase</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <div className="ml-auto text-sm text-muted-foreground self-center">
          {filtered.length} concepts
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          No concepts logged yet for {dialect}. They'll appear automatically as you approve generated content.
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => {
            const usage = linksByConcept.get(c.id) ?? [];
            const lastSeen = usage[0]?.created_at ?? c.first_introduced_at;
            return (
              <Card key={c.id} className="p-3 flex items-center gap-3">
                <Badge variant="secondary" className="capitalize">{c.kind}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate" dir="rtl">
                    {c.display_arabic || c.key}
                  </div>
                  {c.display_english && (
                    <div className="text-xs text-muted-foreground truncate">{c.display_english}</div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground hidden sm:block">
                  {c.cefr_level ?? "—"}
                </div>
                <div className="text-xs text-muted-foreground hidden md:block">
                  Used {usage.length}× · last {new Date(lastSeen).toLocaleDateString()}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
