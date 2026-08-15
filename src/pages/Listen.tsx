import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Sparkles, Mic, Headphones, Users, BookOpen, Play, Library, Plus } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDialect } from "@/contexts/DialectContext";
import { getTopicCategories } from "@/data/listenTopics";
import {
  useListenEpisodes,
  useGenerateListenEpisode,
  type ListenFormat,
  type ListenLength,
  type ListenAudioMode,
} from "@/hooks/useListen";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

const FORMAT_META: Record<ListenFormat, { label: string; icon: any; blurb: string }> = {
  podcast: { label: "بودكاست", icon: Headphones, blurb: "حوار بين مقدّمين" },
  ted: { label: "محاضرة تِد", icon: Mic, blurb: "متحدث واحد وفكرة واحدة" },
  interview: { label: "مقابلة", icon: Users, blurb: "مقدّم وضيف خبير" },
  story: { label: "قصة", icon: BookOpen, blurb: "سرد فيه حوار" },
};

const LENGTH_META: Record<ListenLength, { label: string; sub: string }> = {
  short: { label: "قصيرة", sub: "١–٢ دقيقة" },
  medium: { label: "متوسطة", sub: "٣–٥ دقائق" },
  long: { label: "طويلة", sub: "٦–١٠ دقائق" },
};

const Listen = () => {
  useDocumentTitle("استمع — إنجليزي");
  const navigate = useNavigate();
  const { activeDialect } = useDialect();
  const { data: episodes, isLoading } = useListenEpisodes();
  const generate = useGenerateListenEpisode();

  const [format, setFormat] = useState<ListenFormat>("podcast");
  const [length, setLength] = useState<ListenLength>("medium");
  const [audioMode, setAudioMode] = useState<ListenAudioMode>("on_demand");
  const [topic, setTopic] = useState("");
  const topicCategories = getTopicCategories(activeDialect);
  const [activeCategory, setActiveCategory] = useState(topicCategories[0].id);

  const handleGenerate = async (t?: string, category?: string | null) => {
    const finalTopic = (t ?? topic).trim();
    if (!finalTopic) {
      toast.error("اختر موضوع أو اكتبه أول");
      return;
    }
    try {
      const ep = await generate.mutateAsync({
        format,
        topic: finalTopic,
        topicCategory: category ?? null,
        length,
        audioMode,
      });
      toast.success("الحلقة جاهزة");
      navigate(`/listen/${ep.id}`);
    } catch (e: any) {
      toast.error(e?.message ?? "فشل التوليد");
    }
  };

  const currentCategory = topicCategories.find((c) => c.id === activeCategory) ?? topicCategories[0];

  return (
    <AppShell>
      <div className="space-y-6 pb-20">
        <header className="space-y-2">
          <HomeButton />
          <h1 className="text-3xl font-bold tracking-tight text-foreground">استمع</h1>
          <p className="text-sm text-muted-foreground">
            بودكاست ومحاضرات ومقابلات وقصص إنجليزية مولّدة، بشرح بلهجة {activeDialect}.
          </p>
        </header>

        <Tabs defaultValue="library">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="library"><Library className="h-4 w-4 me-2" />المكتبة</TabsTrigger>
            <TabsTrigger value="create"><Plus className="h-4 w-4 me-2" />أنشئ</TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="space-y-3 pt-4">
            {isLoading && (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            )}
            {!isLoading && (!episodes || episodes.length === 0) && (
              <Card className="p-6 text-center space-y-2">
                <p className="text-sm text-muted-foreground">ما فيه حلقات بعد لـ{activeDialect}.</p>
                <p className="text-xs text-muted-foreground">كن أول واحد — افتح تبويب «أنشئ».</p>
              </Card>
            )}
            <div className="space-y-2">
              {episodes?.map((ep) => {
                const Icon = FORMAT_META[ep.format].icon;
                return (
                  <Link key={ep.id} to={`/listen/${ep.id}`} className="block">
                    <Card className="p-4 hover:bg-accent/50 transition flex gap-3 items-start">
                      <div className="p-2 rounded-md bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold leading-tight truncate" dir="rtl">{ep.title}</h3>
                        {ep.summary && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{ep.summary}</p>
                        )}
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          <Badge variant="secondary" className="text-[10px]">{FORMAT_META[ep.format].label}</Badge>
                          <Badge variant="outline" className="text-[10px]">{LENGTH_META[ep.length_bucket].label}</Badge>
                          {ep.full_audio_url && (
                            <Badge variant="outline" className="text-[10px]"><Play className="h-3 w-3 me-0.5" />صوت</Badge>
                          )}
                          {ep.audio_status === "pending" && (
                            <Badge variant="outline" className="text-[10px]"><Loader2 className="h-3 w-3 me-0.5 animate-spin" />نسجّل</Badge>
                          )}
                          {ep.play_count > 0 && (
                            <span className="text-[10px] text-muted-foreground self-center">▶ {ep.play_count}</span>
                          )}
                        </div>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="create" className="space-y-5 pt-4">
            <div>
              <h3 className="text-sm font-semibold mb-2">الصيغة</h3>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(FORMAT_META) as ListenFormat[]).map((f) => {
                  const Icon = FORMAT_META[f].icon;
                  const active = format === f;
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFormat(f)}
                      className={`p-3 rounded-lg border text-left transition ${
                        active ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40"
                      }`}
                    >
                      <Icon className="h-4 w-4 mb-1 text-primary" />
                      <div className="font-medium text-sm">{FORMAT_META[f].label}</div>
                      <div className="text-[11px] text-muted-foreground">{FORMAT_META[f].blurb}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2">الطول</h3>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(LENGTH_META) as ListenLength[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLength(l)}
                    className={`p-2 rounded-md border text-center transition ${
                      length === l ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40"
                    }`}
                  >
                    <div className="text-sm font-medium">{LENGTH_META[l].label}</div>
                    <div className="text-[10px] text-muted-foreground">{LENGTH_META[l].sub}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2">الصوت</h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAudioMode("on_demand")}
                  className={`p-3 rounded-md border text-left transition ${
                    audioMode === "on_demand" ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40"
                  }`}
                >
                  <div className="text-sm font-medium">اضغط لتسمع</div>
                  <div className="text-[11px] text-muted-foreground">سريع. شغّل أي سطر وقت ما تبي.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setAudioMode("full")}
                  className={`p-3 rounded-md border text-left transition ${
                    audioMode === "full" ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40"
                  }`}
                >
                  <div className="text-sm font-medium">سرد كامل</div>
                  <div className="text-[11px] text-muted-foreground">مسرودة من البداية للنهاية. تاخذ دقيقة.</div>
                </button>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2">الموضوع</h3>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="اكتب أي موضوع، أو اختر اقتراحاً تحت…"
                className="mb-3"
              />
              <div className="flex flex-wrap gap-1.5 mb-3">
                {topicCategories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveCategory(c.id)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition ${
                      activeCategory === c.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent/40"
                    }`}
                  >
                    <span className="me-1">{c.emoji}</span>{c.labelAr}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                {currentCategory.topics.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTopic(t)}
                    className={`block w-full text-left text-sm px-3 py-2 rounded-md border transition ${
                      topic === t ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <Button
              size="lg"
              className="w-full"
              disabled={generate.isPending || !topic.trim()}
              onClick={() => handleGenerate(undefined, currentCategory.id)}
            >
              {generate.isPending ? (
                <><Loader2 className="h-4 w-4 me-2 animate-spin" />نكتب حلقتك…</>
              ) : (
                <><Sparkles className="h-4 w-4 me-2" />ولّد الحلقة</>
              )}
            </Button>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
};

export default Listen;
