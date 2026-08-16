import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import {
  useWeeklyLeaderboard,
  useAllTimeLeaderboard,
  useMyProfile,
  useUpdateProfile,
  useMyRank,
  useInstitutions,
  LeaderboardEntry,
} from "@/hooks/useLeaderboard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Trophy,
  Medal,
  Crown,
  Flame,
  Star,
  Settings,
  Loader2,
  User,
  Building2,
  BadgeCheck,
} from "lucide-react";

type Tab = "weekly" | "all-time";

const RankBadge = ({ rank }: { rank: number }) => {
  if (rank === 1) {
    return (
      <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center">
        <Crown className="h-4 w-4 text-yellow-500" />
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="w-8 h-8 rounded-full bg-slate-400/20 flex items-center justify-center">
        <Medal className="h-4 w-4 text-slate-400" />
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="w-8 h-8 rounded-full bg-amber-600/20 flex items-center justify-center">
        <Medal className="h-4 w-4 text-amber-600" />
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
      <span className="text-sm font-semibold text-muted-foreground">{rank}</span>
    </div>
  );
};

const LeaderboardRow = ({
  entry,
  isCurrentUser,
  tab,
}: {
  entry: LeaderboardEntry;
  isCurrentUser: boolean;
  /** Which board this row is in — it decides which XP the row is about. */
  tab: Tab;
}) => {
  const showInst = entry.show_institution && entry.institution_name;

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-xl transition-all",
        isCurrentUser
          ? "bg-primary/10 border-2 border-primary/30"
          : "bg-card border border-border"
      )}
    >
      <RankBadge rank={entry.rank} />

      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
        {entry.avatar_url ? (
          <img src={entry.avatar_url} alt={`صورة ${entry.display_name || "مجهول"}`} loading="lazy" width={40} height={40} className="w-full h-full object-cover" />
        ) : (
          <User className="h-5 w-5 text-muted-foreground" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-foreground truncate">
          {entry.display_name || "مجهول"}
          {isCurrentUser && (
            <span className="text-primary text-xs ms-1.5">(أنت)</span>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          <p className="text-xs text-muted-foreground">Level {entry.level}</p>
          {showInst && (
            <>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <span className="text-xs text-muted-foreground flex items-center gap-0.5 truncate">
                <Building2 className="h-3 w-3 shrink-0" />
                <span className="truncate">{entry.institution_name}</span>
                {entry.institution_verified && (
                  <BadgeCheck className="h-3 w-3 text-primary shrink-0" />
                )}
              </span>
            </>
          )}
        </div>
      </div>

      {/* The number the board is sorted by, and the label that says which one
          it is. Both used to be fixed to the weekly figure, so the all-time
          tab ranked by lifetime XP while showing this week's: Omar led on
          8,000 lifetime and was displayed with 10 beside Layla's 900, which
          reads as a broken sort. The data was right and only the column was
          wrong, which is why it would never show up in the query. */}
      <div className="text-right shrink-0">
        <p className="font-bold text-primary">
          {(tab === "weekly" ? entry.xp_this_week : entry.total_xp).toLocaleString()}
        </p>
        <p className="text-xs text-muted-foreground">
          {tab === "weekly" ? "نقاط هذا الأسبوع" : "كل النقاط"}
        </p>
      </div>
    </div>
  );
};

const ProfileEditDialog = () => {
  const { data: profile, isLoading } = useMyProfile();
  const { data: institutions } = useInstitutions();
  const updateProfile = useUpdateProfile();
  const [displayName, setDisplayName] = useState("");
  const [showOnLeaderboard, setShowOnLeaderboard] = useState(true);
  const [institutionId, setInstitutionId] = useState<string>("none");
  const [customInstitution, setCustomInstitution] = useState("");
  const [showInstitution, setShowInstitution] = useState(true);
  const [open, setOpen] = useState(false);

  /**
   * Seed the form from the profile — in an effect, so it also catches a
   * profile that lands *after* the dialog is already open.
   *
   * This used to happen inline in `handleOpen`, guarded by `if (isOpen &&
   * profile)` with no else branch and nothing to catch up afterwards. Open the
   * dialog before the query resolved and every field showed its `useState`
   * default: empty name, leaderboard switch on, no institution. Those defaults
   * are not a preview — Save writes them. A learner who opened the dialog
   * quickly lost their display name and was put back on a leaderboard they had
   * deliberately left, having touched neither control.
   */
  useEffect(() => {
    if (!open || !profile) return;
    setDisplayName(profile.display_name || "");
    setShowOnLeaderboard(profile.show_on_leaderboard);
    setInstitutionId(profile.institution_id || "none");
    setCustomInstitution(profile.custom_institution || "");
    setShowInstitution(profile.show_institution);
  }, [open, profile]);

  const handleSave = async () => {
    try {
      await updateProfile.mutateAsync({
        display_name: displayName.trim() || null,
        show_on_leaderboard: showOnLeaderboard,
        institution_id: institutionId === "none" ? null : institutionId === "other" ? null : institutionId,
        custom_institution: institutionId === "other" ? customInstitution.trim() || null : null,
        show_institution: showInstitution,
      });
      toast.success("تم تحديث الملف الشخصي!");
      setOpen(false);
    } catch (e) {
      toast.error("تعذّر تحديث الملف الشخصي");
    }
  };

  const hasInstitution = institutionId !== "none";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تعديل الملف الشخصي</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="displayName">الاسم الظاهر</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="اسمك في لوحة الصدارة"
              maxLength={50}
            />
          </div>

          {/* Institution Selection */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Institution / School
            </Label>
            <Select value={institutionId} onValueChange={setInstitutionId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر مؤسستك" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">بدون</SelectItem>
                {institutions?.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    <span className="flex items-center gap-1.5">
                      {inst.name}
                      {inst.verified && <BadgeCheck className="h-3.5 w-3.5 text-primary inline" />}
                    </span>
                  </SelectItem>
                ))}
                <SelectItem value="other">Other (type your own)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {institutionId === "other" && (
            <div className="space-y-2">
              <Label htmlFor="customInstitution">اسم المؤسسة</Label>
              <Input
                id="customInstitution"
                value={customInstitution}
                onChange={(e) => setCustomInstitution(e.target.value)}
                placeholder="مثلاً: جامعة الملك سعود"
              />
            </div>
          )}

          {hasInstitution && (
            <div className="flex items-center justify-between">
              <Label htmlFor="showInstitution">أظهر المؤسسة في ملفي</Label>
              <Switch
                id="showInstitution"
                checked={showInstitution}
                onCheckedChange={setShowInstitution}
              />
            </div>
          )}

          <div className="flex items-center justify-between">
            <Label htmlFor="showOnLeaderboard">أظهرني في لوحة الصدارة</Label>
            <Switch
              id="showOnLeaderboard"
              checked={showOnLeaderboard}
              onCheckedChange={setShowOnLeaderboard}
            />
          </div>

          <Button
            onClick={handleSave}
            className="w-full"
            // Gated on the profile itself rather than on `isLoading`: if the
            // query fails outright, `isLoading` goes false with nothing to
            // seed from, and saving would write the defaults over real
            // settings — the same damage by a different route.
            disabled={updateProfile.isPending || !profile}
          >
            {updateProfile.isPending && (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            )}
            احفظ التعديلات
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Leaderboard = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [tab, setTab] = useState<Tab>("weekly");

  const { data: weeklyData, isLoading: weeklyLoading } = useWeeklyLeaderboard();
  const { data: allTimeData, isLoading: allTimeLoading } = useAllTimeLeaderboard();
  const { data: myRank } = useMyRank();

  const data = tab === "weekly" ? weeklyData : allTimeData;
  const isLoading = tab === "weekly" ? weeklyLoading : allTimeLoading;

  return (
    <AppShell>
      <HomeButton />

      <div className="py-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Trophy className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground inline-flex items-center gap-2">لوحة الصدارة <InfoHint {...PAGE_HINTS["leaderboard"]} /></h1>
              <p className="text-sm text-muted-foreground">
                نافس متعلمين آخرين
              </p>
            </div>
          </div>
          {isAuthenticated && <ProfileEditDialog />}
        </div>

        {/* My Rank Card */}
        {isAuthenticated && myRank && (
          <div className="bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Flame className="h-6 w-6 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">ترتيبك</p>
                  <p className="text-2xl font-bold text-foreground">
                    #{tab === "weekly" ? myRank.weeklyRank : myRank.allTimeRank}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">
                  {tab === "weekly" ? "هذا الأسبوع" : "كل الأوقات"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab Switcher */}
        <div className="flex gap-2 p-1 bg-muted rounded-xl">
          <button
            onClick={() => setTab("weekly")}
            className={cn(
              "flex-1 py-2.5 rounded-lg text-sm font-medium transition-all",
              tab === "weekly"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Flame className="h-4 w-4 inline me-1.5" />
            هذا الأسبوع
          </button>
          <button
            onClick={() => setTab("all-time")}
            className={cn(
              "flex-1 py-2.5 rounded-lg text-sm font-medium transition-all",
              tab === "all-time"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Star className="h-4 w-4 inline me-1.5" />
            كل الأوقات
          </button>
        </div>

        {/* Leaderboard List */}
        <div className="space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : data && data.length > 0 ? (
            data.map((entry) => (
              <LeaderboardRow
                key={entry.user_id}
                entry={entry}
                isCurrentUser={entry.user_id === user?.id}
                tab={tab}
              />
            ))
          ) : (
            <div className="text-center py-12">
              <Trophy className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">لا ترتيب بعد</p>
              <p className="text-sm text-muted-foreground/70">
                ابدأ التعلم لتظهر في لوحة الصدارة!
              </p>
            </div>
          )}
        </div>

        {/* CTA for non-authenticated users */}
        {!isAuthenticated && (
          <Button onClick={() => navigate("/auth")} className="w-full">
            سجّل الدخول للانضمام إلى لوحة الصدارة
          </Button>
        )}
      </div>
    </AppShell>
  );
};

export default Leaderboard;
