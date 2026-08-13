import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDialect } from "@/contexts/DialectContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, ArrowLeft, Plus, Pencil, Trash2, Save, X, Check } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AdminRequestSituationCard } from "@/components/admin/AdminRequestSituationCard";

const sb = supabase as any;

const AdminSetPhrases = () => {
  const navigate = useNavigate();
  const { activeDialect } = useDialect();
  const [seeding, setSeeding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>({});

  const { data: occasions } = useQuery({
    queryKey: ["admin-occasions", activeDialect],
    queryFn: async () => {
      const { data, error } = await sb.from("set_phrase_occasions").select("*").eq("dialect", activeDialect).order("display_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: phrases, refetch } = useQuery({
    queryKey: ["admin-phrases", activeDialect],
    queryFn: async () => {
      const { data, error } = await sb.from("set_phrases").select("*, set_phrase_occasions(name)").eq("dialect", activeDialect).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleSeedAll = async () => {
    setSeeding(true);
    try {
      const { data, error } = await supabase.functions.invoke("seed-set-phrases", {
        body: { dialect: activeDialect },
      });
      if (error) throw error;
      toast.success(`Seeded: ${data?.summary?.map((s: any) => `${s.occasion} (${s.inserted})`).join(", ")}`);
      refetch();
    } catch (e: any) {
      toast.error(e.message || "Seed failed");
    } finally {
      setSeeding(false);
    }
  };

  const togglePublish = async (id: string, current: string) => {
    const next = current === "published" ? "draft" : "published";
    await sb.from("set_phrases").update({ status: next }).eq("id", id);
    toast.success(next === "published" ? "Approved & published" : "Moved back to draft");
    refetch();
  };

  const deletePhrase = async (id: string) => {
    const { error } = await sb.from("set_phrases").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Phrase deleted");
    refetch();
  };

  const startEdit = (p: any) => {
    setEditingId(p.id);
    setDraft({
      phrase_arabic: p.phrase_arabic ?? "",
      phrase_transliteration: p.phrase_transliteration ?? "",
      phrase_english: p.phrase_english ?? "",
      reply_arabic: p.reply_arabic ?? "",
      reply_transliteration: p.reply_transliteration ?? "",
      reply_english: p.reply_english ?? "",
      scenario_english: p.scenario_english ?? "",
      cultural_note: p.cultural_note ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft({});
  };

  const saveEdit = async (id: string) => {
    const { error } = await sb.from("set_phrases").update(draft).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Saved");
    cancelEdit();
    refetch();
  };

  const addOccasion = async (slug: string, name: string) => {
    await sb.from("set_phrase_occasions").insert({ slug, name, dialect: activeDialect, status: "published" });
    refetch();
    toast.success(`Added ${name}`);
  };

  return (
    <div className="container mx-auto p-4 max-w-3xl">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin/dashboard")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold">Set Phrases ({activeDialect})</h1>
      </div>

      <Card className="p-4 mb-4 space-y-3">
        <h2 className="font-semibold">Occasions ({occasions?.length ?? 0})</h2>
        {!occasions?.length && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">No occasions yet. Quick-add starter set:</p>
            <Button
              size="sm"
              onClick={async () => {
                const starter = [
                  ["greetings", "Greetings"],
                  ["eid", "Eid"],
                  ["wedding", "Wedding"],
                  ["funeral", "Funeral & Condolences"],
                  ["new-baby", "New Baby"],
                  ["travel", "Travel & Safe Trip"],
                  ["hospitality", "Hospitality & Food"],
                  ["religious", "Religious"],
                  ["apologies", "Apologies"],
                  ["thanks", "Thanks"],
                  ["health", "Health & Sneeze"],
                  ["compliments", "Compliments"],
                ];
                for (const [slug, name] of starter) {
                  await sb.from("set_phrase_occasions").insert({ slug, name, dialect: activeDialect, status: "published" }).then(() => {});
                }
                refetch();
                toast.success("Starter occasions added");
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Add 12 starter occasions
            </Button>
          </div>
        )}
        {!!occasions?.length && (
          <div className="flex flex-wrap gap-1">
            {occasions.map((o: any) => (
              <Badge key={o.id} variant="outline">{o.name}</Badge>
            ))}
          </div>
        )}
        <Button onClick={handleSeedAll} disabled={seeding || !occasions?.length}>
          {seeding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Seed 10 phrases per occasion (AI, draft)
        </Button>
      </Card>

      <AdminRequestSituationCard
        occasions={(occasions ?? []).map((o: any) => ({ id: o.id, name: o.name }))}
        onSaved={() => refetch()}
      />

      <Card className="p-4">
        <h2 className="font-semibold mb-3">Phrases ({phrases?.length ?? 0})</h2>
        <div className="space-y-2">
          {phrases?.map((p: any) => (
            <div key={p.id} className="p-3 border rounded-lg space-y-2">
              {editingId === p.id ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-2">
                    <label className="text-xs font-semibold">Phrase (Arabic)</label>
                    <Input dir="rtl" value={draft.phrase_arabic} onChange={(e) => setDraft({ ...draft, phrase_arabic: e.target.value })} />
                    <label className="text-xs font-semibold">Phrase (Transliteration)</label>
                    <Input value={draft.phrase_transliteration} onChange={(e) => setDraft({ ...draft, phrase_transliteration: e.target.value })} />
                    <label className="text-xs font-semibold">Phrase (English)</label>
                    <Input value={draft.phrase_english} onChange={(e) => setDraft({ ...draft, phrase_english: e.target.value })} />
                    <label className="text-xs font-semibold">Reply (Arabic)</label>
                    <Input dir="rtl" value={draft.reply_arabic} onChange={(e) => setDraft({ ...draft, reply_arabic: e.target.value })} />
                    <label className="text-xs font-semibold">Reply (Transliteration)</label>
                    <Input value={draft.reply_transliteration} onChange={(e) => setDraft({ ...draft, reply_transliteration: e.target.value })} />
                    <label className="text-xs font-semibold">Reply (English)</label>
                    <Input value={draft.reply_english} onChange={(e) => setDraft({ ...draft, reply_english: e.target.value })} />
                    <label className="text-xs font-semibold">Scenario</label>
                    <Textarea rows={2} value={draft.scenario_english} onChange={(e) => setDraft({ ...draft, scenario_english: e.target.value })} />
                    <label className="text-xs font-semibold">Cultural Note</label>
                    <Textarea rows={2} value={draft.cultural_note} onChange={(e) => setDraft({ ...draft, cultural_note: e.target.value })} />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="ghost" onClick={cancelEdit}><X className="h-4 w-4 mr-1" />Cancel</Button>
                    <Button size="sm" onClick={() => saveEdit(p.id)}><Save className="h-4 w-4 mr-1" />Save</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate" dir="rtl">{p.phrase_arabic}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.phrase_english}</p>
                    {p.reply_arabic && (
                      <p className="text-xs text-muted-foreground truncate" dir="rtl">↳ {p.reply_arabic}</p>
                    )}
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {p.set_phrase_occasions?.name && <Badge variant="outline" className="text-xs">{p.set_phrase_occasions.name}</Badge>}
                      <Badge variant="secondary" className="text-xs">{p.difficulty}</Badge>
                      <Badge variant="secondary" className="text-xs">{p.formality}</Badge>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant={p.status === "published" ? "default" : "outline"}
                      className={
                        p.status === "published"
                          ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                          : "border-emerald-600 text-emerald-700 hover:bg-emerald-50"
                      }
                      onClick={() => togglePublish(p.id, p.status)}
                    >
                      {p.status === "published" ? (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Approved
                        </>
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Approve
                        </>
                      )}
                    </Button>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(p)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this phrase?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete "{p.phrase_arabic}" and any user review history for it.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deletePhrase(p.id)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!phrases?.length && <p className="text-sm text-muted-foreground text-center py-6">No phrases yet.</p>}
        </div>
      </Card>
    </div>
  );
};

export default AdminSetPhrases;
