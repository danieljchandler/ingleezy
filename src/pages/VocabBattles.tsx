import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useMyBattles, usePendingBattles, type VocabBattle } from '@/hooks/useVocabBattles';
import { AppShell } from '@/components/layout/AppShell';
import { HomeButton } from '@/components/HomeButton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Swords, Trophy, Clock, ChevronRight, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/InfoHint';
import { PAGE_HINTS } from '@/lib/pageHints';
import { formatDistanceToNow } from 'date-fns';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20',
  in_progress: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  completed: 'bg-green-500/10 text-green-700 border-green-500/20',
};

const VocabBattles = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: battles, isLoading } = useMyBattles();
  const { data: pendingBattles } = usePendingBattles();

  if (authLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell>
        <div className="mb-6"><HomeButton /></div>
        <div className="text-center py-16">
          <Swords className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2 font-heading">Vocab Battles</h1>
          <p className="text-muted-foreground mb-6">Sign in to challenge friends to vocabulary battles</p>
          <Button onClick={() => navigate('/auth')}>Sign In</Button>
        </div>
      </AppShell>
    );
  }

  const pendingForMe = pendingBattles || [];
  const myBattles = battles || [];

  // Sort: pending challenges first, then by date
  const sortedBattles = [...myBattles].sort((a, b) => {
    const aIsPending = a.status === 'pending' && a.opponent_id === user.id;
    const bIsPending = b.status === 'pending' && b.opponent_id === user.id;
    if (aIsPending && !bIsPending) return -1;
    if (!aIsPending && bIsPending) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const getBattleStatus = (battle: VocabBattle) => {
    const isChallenger = battle.challenger_id === user.id;

    if (battle.status === 'completed') {
      if (battle.winner_id === user.id) return { text: 'You Won! 🎉', color: 'text-green-600' };
      if (battle.winner_id === null) return { text: 'Draw', color: 'text-yellow-600' };
      return { text: 'You Lost', color: 'text-red-600' };
    }

    if (battle.status === 'pending') {
      if (isChallenger) {
        return battle.challenger_score !== null
          ? { text: 'Waiting for opponent', color: 'text-muted-foreground' }
          : { text: 'Play your turn', color: 'text-primary' };
      } else {
        return { text: 'Your turn to play!', color: 'text-primary' };
      }
    }

    return { text: battle.status, color: 'text-muted-foreground' };
  };

  const canPlay = (battle: VocabBattle) => {
    const isChallenger = battle.challenger_id === user.id;
    if (battle.status === 'completed') return false;

    if (isChallenger) {
      return battle.challenger_score === null;
    } else {
      return battle.status === 'pending' && battle.challenger_score !== null;
    }
  };

  return (
    <AppShell>
      <div className="mb-6"><HomeButton /></div>

      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Swords className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold font-heading mb-1 inline-flex items-center gap-2 justify-center">Vocab Battles <InfoHint {...PAGE_HINTS["vocab-battles"]} size="md" /></h1>
          <p className="text-muted-foreground">Challenge friends to vocabulary showdowns</p>
        </div>

        {/* Challenge friends CTA */}
        <Button
          variant="outline"
          className="w-full mb-6 gap-2"
          onClick={() => navigate('/friends')}
        >
          <Users className="h-4 w-4" />
          Challenge a Friend
        </Button>

        {/* Pending challenges alert */}
        {pendingForMe.length > 0 && (
          <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 mb-6">
            <p className="font-semibold text-primary">
              🔥 {pendingForMe.length} battle{pendingForMe.length > 1 ? 's' : ''} waiting for you!
            </p>
          </div>
        )}

        {/* Battles list */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : sortedBattles.length > 0 ? (
          <div className="space-y-3">
            {sortedBattles.map((battle) => {
              const status = getBattleStatus(battle);
              const playable = canPlay(battle);
              const isChallenger = battle.challenger_id === user.id;

              return (
                <button
                  key={battle.id}
                  onClick={() => playable && navigate(`/battles/${battle.id}`)}
                  disabled={!playable}
                  className={cn(
                    'w-full text-left rounded-xl border-2 bg-card p-4',
                    'transition-all duration-200',
                    playable
                      ? 'border-primary/40 hover:border-primary hover:shadow-md cursor-pointer'
                      : 'border-border opacity-70 cursor-default'
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Swords className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-semibold truncate">
                          {isChallenger ? 'You challenged' : 'Challenged by'}
                        </span>
                        <Badge variant="outline" className={cn('text-xs', statusColors[battle.status])}>
                          {battle.status}
                        </Badge>
                      </div>

                      <p className={cn('text-sm font-medium', status.color)}>
                        {status.text}
                      </p>

                      {/* Scores if available */}
                      <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                        {battle.challenger_score !== null && (
                          <span>
                            {isChallenger ? 'You' : 'Them'}: {battle.challenger_score}/{battle.question_count}
                          </span>
                        )}
                        {battle.opponent_score !== null && (
                          <span>
                            {!isChallenger ? 'You' : 'Them'}: {battle.opponent_score}/{battle.question_count}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(battle.created_at), { addSuffix: true })}
                      </div>
                    </div>

                    {playable && (
                      <ChevronRight className="h-5 w-5 text-primary shrink-0" />
                    )}
                    {battle.status === 'completed' && battle.winner_id === user.id && (
                      <Trophy className="h-5 w-5 text-yellow-500 shrink-0" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16">
            <Swords className="h-16 w-16 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-muted-foreground mb-4">No battles yet</p>
            <Button onClick={() => navigate('/friends')}>
              <Users className="h-4 w-4 mr-2" />
              Find Friends to Battle
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default VocabBattles;
