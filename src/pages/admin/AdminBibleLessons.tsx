import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, Plus, Pencil, Trash2, BookMarked } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";
import { useAuth } from "@/hooks/useAuth";
import { ALL_BOOKS } from "@/data/bibleBooks";
import { toast } from "sonner";

type BibleLesson = {
  id: string;
  title: string;
  description: string | null;
  book_usfm: string;
  book_name: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  dialect: string;
  dialect_verses: string[];
  formal_verses: string[];
  english_verses: string[];
  cultural_note: string | null;
  display_order: number;
  published: boolean;
  created_at: string;
};

const emptyForm = {
  id: null as string | null,
  title: "",
  description: "",
  book_usfm: ALL_BOOKS[0]?.usfm ?? "GEN",
  chapter: 1,
  verse_start: 1,
  verse_end: 1,
  dialect_text: "",
  formal_text: "",
  english_text: "",
  cultural_note: "",
  display_order: 0,
  published: false,
};

const splitVerses = (s: string) =>
  s
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const joinVerses = (arr: string[] | undefined | null) =>
  Array.isArray(arr) ? arr.join("\n") : "";

const AdminBibleLessons = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const [lessons, setLessons] = useState<BibleLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const fetchLessons = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("bible_lessons")
      .select("*")
      .eq("dialect", activeDialect)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load lessons", { description: error.message });
    } else {
      setLessons((data ?? []) as BibleLesson[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLessons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDialect]);

  const bookOptions = useMemo(
    () => ALL_BOOKS.map((b) => ({ value: b.usfm, label: `${b.name} (${b.nameArabic})` })),
    [],
  );

  const startNew = () => {
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const startEdit = (lesson: BibleLesson) => {
    setForm({
      id: lesson.id,
      title: lesson.title,
      description: lesson.description ?? "",
      book_usfm: lesson.book_usfm,
      chapter: lesson.chapter,
      verse_start: lesson.verse_start,
      verse_end: lesson.verse_end,
      dialect_text: joinVerses(lesson.dialect_verses),
      formal_text: joinVerses(lesson.formal_verses),
      english_text: joinVerses(lesson.english_verses),
      cultural_note: lesson.cultural_note ?? "",
      display_order: lesson.display_order,
      published: lesson.published,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!user) return;
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    const dialectVerses = splitVerses(form.dialect_text);
    if (dialectVerses.length === 0) {
      toast.error("Add at least one verse in dialect Arabic (one verse per line).");
      return;
    }
    const book = ALL_BOOKS.find((b) => b.usfm === form.book_usfm);
    if (!book) {
      toast.error("Pick a Bible book.");
      return;
    }

    setSaving(true);
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      book_usfm: book.usfm,
      book_name: book.name,
      chapter: Math.max(1, Math.floor(Number(form.chapter) || 1)),
      verse_start: Math.max(1, Math.floor(Number(form.verse_start) || 1)),
      verse_end: Math.max(1, Math.floor(Number(form.verse_end) || 1)),
      dialect: activeDialect,
      dialect_verses: dialectVerses,
      formal_verses: splitVerses(form.formal_text),
      english_verses: splitVerses(form.english_text),
      cultural_note: form.cultural_note.trim() || null,
      display_order: Math.floor(Number(form.display_order) || 0),
      published: form.published,
      created_by: user.id,
    };

    const { error } = form.id
      ? await supabase.from("bible_lessons").update(payload).eq("id", form.id)
      : await supabase.from("bible_lessons").insert(payload);

    setSaving(false);
    if (error) {
      toast.error("Save failed", { description: error.message });
      return;
    }
    toast.success(form.id ? "Lesson updated" : "Lesson created");
    setShowForm(false);
    setForm(emptyForm);
    fetchLessons();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this lesson? This cannot be undone.")) return;
    const { error } = await supabase.from("bible_lessons").delete().eq("id", id);
    if (error) {
      toast.error("Delete failed", { description: error.message });
      return;
    }
    toast.success("Lesson deleted");
    fetchLessons();
  };

  const togglePublished = async (lesson: BibleLesson) => {
    const { error } = await supabase
      .from("bible_lessons")
      .update({ published: !lesson.published })
      .eq("id", lesson.id);
    if (error) {
      toast.error("Update failed", { description: error.message });
      return;
    }
    fetchLessons();
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BookMarked className="h-6 w-6 text-primary" />
              Bible Lessons
            </h1>
            <p className="text-sm text-muted-foreground">
              Hand-curated Bible passages in {activeDialect} Arabic.
            </p>
          </div>
          {!showForm && (
            <Button onClick={startNew}>
              <Plus className="h-4 w-4 mr-2" />
              New Lesson
            </Button>
          )}
        </div>

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle>{form.id ? "Edit Lesson" : "New Lesson"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>Title</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. The Beatitudes"
                />
              </div>
              <div className="grid gap-2">
                <Label>Description (optional)</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Short blurb shown in the lesson list"
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="col-span-2 grid gap-2">
                  <Label>Book</Label>
                  <Select
                    value={form.book_usfm}
                    onValueChange={(v) => setForm({ ...form, book_usfm: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {bookOptions.map((b) => (
                        <SelectItem key={b.value} value={b.value}>
                          {b.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Chapter</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.chapter}
                    onChange={(e) =>
                      setForm({ ...form, chapter: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Verses</Label>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      value={form.verse_start}
                      onChange={(e) =>
                        setForm({ ...form, verse_start: Number(e.target.value) })
                      }
                    />
                    <span className="text-muted-foreground">–</span>
                    <Input
                      type="number"
                      min={1}
                      value={form.verse_end}
                      onChange={(e) =>
                        setForm({ ...form, verse_end: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>
                  Dialect Arabic ({activeDialect}) — one verse per line{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  dir="rtl"
                  rows={6}
                  className="font-arabic text-lg leading-loose"
                  value={form.dialect_text}
                  onChange={(e) => setForm({ ...form, dialect_text: e.target.value })}
                  placeholder="ضع كل آية في سطر منفصل"
                />
              </div>

              <div className="grid gap-2">
                <Label>Formal Arabic (optional) — one verse per line</Label>
                <Textarea
                  dir="rtl"
                  rows={4}
                  className="font-arabic text-base leading-loose"
                  value={form.formal_text}
                  onChange={(e) => setForm({ ...form, formal_text: e.target.value })}
                />
              </div>

              <div className="grid gap-2">
                <Label>English (optional) — one verse per line</Label>
                <Textarea
                  rows={4}
                  value={form.english_text}
                  onChange={(e) => setForm({ ...form, english_text: e.target.value })}
                />
              </div>

              <div className="grid gap-2">
                <Label>Cultural / context note (optional)</Label>
                <Textarea
                  rows={2}
                  value={form.cultural_note}
                  onChange={(e) => setForm({ ...form, cultural_note: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-between gap-4 flex-wrap pt-2">
                <div className="flex items-center gap-3">
                  <Label>Display order</Label>
                  <Input
                    type="number"
                    className="w-24"
                    value={form.display_order}
                    onChange={(e) =>
                      setForm({ ...form, display_order: Number(e.target.value) })
                    }
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch
                    checked={form.published}
                    onCheckedChange={(v) => setForm({ ...form, published: v })}
                  />
                  <span className="text-sm">Published (visible to users)</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setForm(emptyForm);
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {form.id ? "Save changes" : "Create lesson"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : lessons.length === 0 ? (
          <p className="text-muted-foreground text-center py-12">
            No lessons yet for {activeDialect}. Create one to get started.
          </p>
        ) : (
          <div className="space-y-3">
            {lessons.map((lesson) => (
              <Card key={lesson.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground">{lesson.title}</h3>
                        <Badge variant={lesson.published ? "default" : "secondary"}>
                          {lesson.published ? "Published" : "Draft"}
                        </Badge>
                        <Badge variant="outline">{lesson.dialect}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {lesson.book_name} {lesson.chapter}:{lesson.verse_start}
                        {lesson.verse_end !== lesson.verse_start
                          ? `–${lesson.verse_end}`
                          : ""}{" "}
                        · {lesson.dialect_verses?.length ?? 0} verses
                      </p>
                      {lesson.description && (
                        <p className="text-sm text-muted-foreground mt-2">
                          {lesson.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <label className="flex items-center gap-1 text-xs cursor-pointer">
                        <Switch
                          checked={lesson.published}
                          onCheckedChange={() => togglePublished(lesson)}
                        />
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => startEdit(lesson)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(lesson.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminBibleLessons;
