import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { InfoHint } from "@/components/InfoHint";
import { PAGE_HINTS } from "@/lib/pageHints";
import {
  useFriendsActivity,
  useSearchUsers,
  useFollowUser,
  useUnfollowUser,
  useMyChallenges,
  useCreateChallenge,
  useAcceptChallenge,
  useDeclineChallenge,
  FriendWithProfile,
  Challenge,
} from "@/hooks/useSocial";
import { useLikedVideos } from "@/hooks/useVideoLikes";
import { useCreateBattle } from "@/hooks/useVocabBattles";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Users,
  UserPlus,
  UserMinus,
  Search,
  Loader2,
  User,
  Flame,
  Swords,
  Trophy,
  Clock,
  Check,
  X,
  Zap,
  ChevronRight,
  Heart,
  Play,
} from "lucide-react";
import { formatDuration } from "@/lib/videoEmbed";
import type { DiscoverVideo } from "@/hooks/useDiscoverVideos";

const LikedVideoCard = ({
  video,
  onClick,
}: {
  video: DiscoverVideo;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full rounded-xl overflow-hidden border border-border bg-card/50 text-left",
      "transition-all duration-200 hover:border-primary/40 hover:shadow-sm active:scale-[0.99]",
      "flex gap-0"
    )}
  >
    {/* Thumbnail */}
    <div className="relative w-20 shrink-0 bg-muted overflow-hidden">
      {video.thumbnail_url ? (
        <img
          src={video.thumbnail_url}
          alt={video.title}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Play className="h-6 w-6 text-muted-foreground/30" />
        </div>
      )}
      {video.duration_seconds && (
        <div className="absolute bottom-1 right-1">
          <span className="text-[10px] font-medium text-white bg-black/60 px-1 py-0.5 rounded">
            {formatDuration(video.duration_seconds)}
          </span>
        </div>
      )}
    </div>

    {/* Content */}
    <div className="flex-1 p-2 min-w-0">
      <p className="font-medium text-foreground text-xs line-clamp-2">
        {video.title}
      </p>
      <div className="flex gap-1 mt-1">
        <Badge variant="outline" className="text-[10px] px-1 py-0">{video.dialect}</Badge>
        <Badge variant="outline" className="text-[10px] px-1 py-0">{video.difficulty}</Badge>
      </div>
    </div>
  </button>
);

const FriendCard = ({
  friend,
  onChallenge,
}: {
  friend: FriendWithProfile;
  onChallenge: (userId: string) => void;
}) => {
  const navigate = useNavigate();
  const followUser = useFollowUser();
  const unfollowUser = useUnfollowUser();
  const { data: likedVideos, isLoading: videosLoading } = useLikedVideos(friend.user_id);

  const handleToggleFollow = async () => {
    try {
      if (friend.is_following) {
        await unfollowUser.mutateAsync(friend.user_id);
        toast.success("Unfollowed");
      } else {
        await followUser.mutateAsync(friend.user_id);
        toast.success("Following!");
      }
    } catch {
      toast.error("Failed to update follow status");
    }
  };

  const isPending = followUser.isPending || unfollowUser.isPending;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
          {friend.avatar_url ? (
            <img
              src={friend.avatar_url}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <User className="h-6 w-6 text-muted-foreground" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground truncate">
            {friend.display_name || "Anonymous"}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Level {friend.level}</span>
            {friend.current_streak > 0 && (
              <>
                <span>·</span>
                <span className="flex items-center gap-0.5 text-orange-500">
                  <Flame className="h-3 w-3" />
                  {friend.current_streak}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className="font-bold text-primary">{friend.xp_this_week}</p>
          <p className="text-xs text-muted-foreground">XP this week</p>
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        <Button
          variant={friend.is_following ? "outline" : "default"}
          size="sm"
          className="flex-1"
          onClick={handleToggleFollow}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : friend.is_following ? (
            <>
              <UserMinus className="h-4 w-4 mr-1.5" />
              Unfollow
            </>
          ) : (
            <>
              <UserPlus className="h-4 w-4 mr-1.5" />
              Follow
            </>
          )}
        </Button>
        {friend.is_following && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChallenge(friend.user_id)}
          >
            <Swords className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Liked Videos Section */}
      {friend.is_following && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center gap-2 mb-2">
            <Heart className="h-4 w-4 text-primary fill-primary/30" />
            <span className="text-sm font-medium text-muted-foreground">
              Liked Videos {likedVideos && likedVideos.length > 0 ? `(${likedVideos.length})` : ""}
            </span>
          </div>
          {videosLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : likedVideos && likedVideos.length > 0 ? (
            <div className="space-y-2">
              {likedVideos.slice(0, 3).map((video) => (
                <LikedVideoCard
                  key={video.id}
                  video={video}
                  onClick={() => navigate(`/discover/${video.id}`)}
                />
              ))}
              {likedVideos.length > 3 && (
                <p className="text-xs text-muted-foreground text-center pt-1">
                  +{likedVideos.length - 3} more
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-2">No liked videos yet</p>
          )}
        </div>
      )}
    </div>
  );
};

const ChallengeCard = ({
  challenge,
  currentUserId,
  friendsMap,
}: {
  challenge: Challenge;
  currentUserId: string;
  friendsMap: Record<string, FriendWithProfile>;
}) => {
  const acceptChallenge = useAcceptChallenge();
  const declineChallenge = useDeclineChallenge();

  const isChallenger = challenge.challenger_id === currentUserId;
  const opponentId = isChallenger
    ? challenge.challenged_id
    : challenge.challenger_id;
  const opponent = friendsMap[opponentId];
  const opponentName = opponent?.display_name || "Someone";

  const myProgress = isChallenger
    ? challenge.challenger_progress
    : challenge.challenged_progress;
  const theirProgress = isChallenger
    ? challenge.challenged_progress
    : challenge.challenger_progress;

  const progressPercent = Math.min(
    100,
    (myProgress / challenge.target_xp) * 100
  );
  const theirPercent = Math.min(
    100,
    (theirProgress / challenge.target_xp) * 100
  );

  const expiresAt = new Date(challenge.expires_at);
  const now = new Date();
  const daysLeft = Math.max(
    0,
    Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  );

  const isPending = challenge.status === "pending";
  const isActive = challenge.status === "active";
  const needsResponse = isPending && !isChallenger;

  const handleAccept = async () => {
    try {
      await acceptChallenge.mutateAsync(challenge.id);
      toast.success("Challenge accepted!");
    } catch {
      toast.error("Failed to accept challenge");
    }
  };

  const handleDecline = async () => {
    try {
      await declineChallenge.mutateAsync(challenge.id);
      toast("Challenge declined");
    } catch {
      toast.error("Failed to decline challenge");
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl p-4 border",
        isPending && needsResponse
          ? "bg-primary/5 border-primary/30"
          : "bg-card border-border"
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Swords className="h-5 w-5 text-primary" />
          <span className="font-semibold text-foreground">
            {isPending
              ? needsResponse
                ? `${opponentName} challenged you!`
                : `Waiting for ${opponentName}`
              : isActive
              ? `vs ${opponentName}`
              : challenge.winner_id === currentUserId
              ? "You won!"
              : "Challenge ended"}
          </span>
        </div>
        <Badge
          variant={
            isPending ? "secondary" : isActive ? "default" : "outline"
          }
        >
          {isPending ? "Pending" : isActive ? `${daysLeft}d left` : challenge.status}
        </Badge>
      </div>

      {isActive && (
        <div className="space-y-2 mb-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">You</span>
            <span className="font-semibold text-primary">
              {myProgress} / {challenge.target_xp} XP
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{opponentName}</span>
            <span className="font-semibold text-muted-foreground">
              {theirProgress} / {challenge.target_xp} XP
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-muted-foreground/50 transition-all"
              style={{ width: `${theirPercent}%` }}
            />
          </div>
        </div>
      )}

      {needsResponse && (
        <div className="flex gap-2">
          <Button
            onClick={handleAccept}
            className="flex-1"
            disabled={acceptChallenge.isPending}
          >
            {acceptChallenge.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Check className="h-4 w-4 mr-1.5" />
                Accept
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleDecline}
            disabled={declineChallenge.isPending}
          >
            {declineChallenge.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
};

const CreateChallengeDialog = ({
  friendId,
  friendName,
  onClose,
}: {
  friendId: string;
  friendName: string;
  onClose: () => void;
}) => {
  const navigate = useNavigate();
  const [challengeType, setChallengeType] = useState<'xp' | 'vocab'>('vocab');
  const [targetXp, setTargetXp] = useState(100);
  const [durationDays, setDurationDays] = useState(7);
  const createChallenge = useCreateChallenge();
  const createBattle = useCreateBattle();

  const handleCreate = async () => {
    try {
      if (challengeType === 'vocab') {
        const battle = await createBattle.mutateAsync({
          opponentId: friendId,
          questionCount: 10,
          timeLimitSeconds: 60,
        });
        toast.success("Vocab battle created! Play your turn now.");
        onClose();
        navigate(`/battles/${battle.id}`);
      } else {
        await createChallenge.mutateAsync({
          challengedId: friendId,
          targetXp,
          durationDays,
        });
        toast.success("Challenge sent!");
        onClose();
      }
    } catch {
      toast.error("Failed to send challenge");
    }
  };

  const isPending = createChallenge.isPending || createBattle.isPending;

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Challenge {friendName}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 pt-4">
        {/* Challenge Type Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Challenge Type</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setChallengeType('vocab')}
              className={cn(
                "p-3 rounded-xl border-2 text-left transition-all",
                challengeType === 'vocab'
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              )}
            >
              <Swords className="h-5 w-5 text-primary mb-1" />
              <p className="font-semibold text-sm">Vocab Battle</p>
              <p className="text-xs text-muted-foreground">Timed vocabulary quiz</p>
            </button>
            <button
              onClick={() => setChallengeType('xp')}
              className={cn(
                "p-3 rounded-xl border-2 text-left transition-all",
                challengeType === 'xp'
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              )}
            >
              <Zap className="h-5 w-5 text-yellow-500 mb-1" />
              <p className="font-semibold text-sm">XP Race</p>
              <p className="text-xs text-muted-foreground">First to target XP wins</p>
            </button>
          </div>
        </div>

        {challengeType === 'xp' && (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">Target XP</label>
              <div className="flex gap-2">
                {[50, 100, 200, 500].map((xp) => (
                  <Button
                    key={xp}
                    variant={targetXp === xp ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTargetXp(xp)}
                  >
                    {xp}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Duration</label>
              <div className="flex gap-2">
                {[3, 7, 14].map((days) => (
                  <Button
                    key={days}
                    variant={durationDays === days ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDurationDays(days)}
                  >
                    {days} days
                  </Button>
                ))}
              </div>
            </div>

            <div className="bg-muted rounded-xl p-4 text-sm text-muted-foreground">
              First to earn <strong className="text-foreground">{targetXp} XP</strong> within{" "}
              <strong className="text-foreground">{durationDays} days</strong> wins!
            </div>
          </>
        )}

        {challengeType === 'vocab' && (
          <div className="bg-muted rounded-xl p-4 text-sm text-muted-foreground">
            <strong className="text-foreground">10 questions</strong> · <strong className="text-foreground">60 seconds</strong>
            <br />
            Answer vocabulary questions as fast as you can. Highest score wins!
          </div>
        )}

        <Button
          onClick={handleCreate}
          className="w-full"
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Swords className="h-4 w-4 mr-2" />
          )}
          {challengeType === 'vocab' ? 'Start Vocab Battle' : 'Send XP Challenge'}
        </Button>
      </div>
    </DialogContent>
  );
};

const Friends = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [challengeTarget, setChallengeTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const { data: friends, isLoading: friendsLoading } = useFriendsActivity();
  const { data: searchResults, isLoading: searchLoading } =
    useSearchUsers(searchTerm);
  const { data: challenges } = useMyChallenges();

  const friendsMap: Record<string, FriendWithProfile> = {};
  (friends || []).forEach((f) => {
    friendsMap[f.user_id] = f;
  });

  const pendingChallenges =
    challenges?.filter(
      (c) => c.status === "pending" && c.challenged_id === user?.id
    ) || [];
  const activeChallenges =
    challenges?.filter((c) => c.status === "active") || [];

  const handleChallenge = (userId: string) => {
    const friend = friendsMap[userId];
    setChallengeTarget({
      id: userId,
      name: friend?.display_name || "Friend",
    });
  };

  if (!isAuthenticated) {
    return (
      <AppShell>
        <HomeButton />
        <div className="py-12 text-center">
          <Users className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">
            Sign in to see friends
          </h2>
          <p className="text-muted-foreground mb-4">
            Follow other learners and challenge them!
          </p>
          <Button onClick={() => navigate("/auth")}>Sign In</Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <HomeButton />

      <div className="py-4 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground inline-flex items-center gap-2">Friends <InfoHint {...PAGE_HINTS["friends"]} /></h1>
            <p className="text-sm text-muted-foreground">
              Follow & challenge other learners
            </p>
          </div>
        </div>

        {/* Pending Challenges */}
        {pendingChallenges.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Incoming Challenges
            </h2>
            {pendingChallenges.map((challenge) => (
              <ChallengeCard
                key={challenge.id}
                challenge={challenge}
                currentUserId={user!.id}
                friendsMap={friendsMap}
              />
            ))}
          </div>
        )}

        {/* Active Challenges */}
        {activeChallenges.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Active Challenges
            </h2>
            {activeChallenges.map((challenge) => (
              <ChallengeCard
                key={challenge.id}
                challenge={challenge}
                currentUserId={user!.id}
                friendsMap={friendsMap}
              />
            ))}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search users by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Search Results */}
        {searchTerm.length >= 2 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Search Results
            </h2>
            {searchLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : searchResults && searchResults.length > 0 ? (
              searchResults.map((user) => (
                <FriendCard
                  key={user.user_id}
                  friend={user}
                  onChallenge={handleChallenge}
                />
              ))
            ) : (
              <p className="text-center text-muted-foreground py-4">
                No users found
              </p>
            )}
          </div>
        )}

        {/* Friends List */}
        {!searchTerm && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Following ({friends?.length || 0})
            </h2>
            {friendsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : friends && friends.length > 0 ? (
              friends.map((friend) => (
                <FriendCard
                  key={friend.user_id}
                  friend={friend}
                  onChallenge={handleChallenge}
                />
              ))
            ) : (
              <div className="text-center py-8">
                <UserPlus className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">
                  You're not following anyone yet
                </p>
                <p className="text-sm text-muted-foreground/70">
                  Search for users above to start following!
                </p>
              </div>
            )}
          </div>
        )}

        {/* Challenge Dialog */}
        <Dialog
          open={!!challengeTarget}
          onOpenChange={(open) => !open && setChallengeTarget(null)}
        >
          {challengeTarget && (
            <CreateChallengeDialog
              friendId={challengeTarget.id}
              friendName={challengeTarget.name}
              onClose={() => setChallengeTarget(null)}
            />
          )}
        </Dialog>
      </div>
    </AppShell>
  );
};

export default Friends;
