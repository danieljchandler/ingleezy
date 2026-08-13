import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppShell } from '@/components/layout/AppShell';
import { HomeButton } from '@/components/HomeButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Copy, Trash2, Ticket, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type InviteCode = {
  id: string;
  code: string;
  note: string | null;
  max_uses: number;
  uses: number;
  expires_at: string | null;
  created_at: string;
};

// Friendly codes: 8 chars, no ambiguous letters.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomCode = (len = 8) =>
  Array.from({ length: len }, () =>
    ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
  ).join('');

const AdminInviteCodes = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [code, setCode] = useState(randomCode());
  const [note, setNote] = useState('');
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState<number | ''>('');

  const { data: codes, isLoading } = useQuery({
    queryKey: ['invite-codes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invite_codes' as any)
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as unknown as InviteCode[]) ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not signed in');
      const expires_at =
        typeof expiresInDays === 'number' && expiresInDays > 0
          ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
          : null;
      const { error } = await supabase.from('invite_codes' as any).insert({
        code: code.trim().toUpperCase(),
        note: note.trim() || null,
        max_uses: Math.max(1, Math.floor(maxUses || 1)),
        expires_at,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invite-codes'] });
      setCode(randomCode());
      setNote('');
      setMaxUses(1);
      setExpiresInDays('');
      toast({ title: 'Invite code created' });
    },
    onError: (e: Error) =>
      toast({ title: 'Could not create code', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('invite_codes' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invite-codes'] });
      toast({ title: 'Code deleted' });
    },
    onError: (e: Error) =>
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' }),
  });

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: 'Copied', description: value });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  };

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <HomeButton />
        <Button variant="ghost" onClick={() => navigate('/admin')}>
          Back to admin
        </Button>
      </div>

      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-center gap-3">
          <div className="bg-primary/10 rounded-full p-3">
            <Ticket className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold font-heading">Beta Invite Codes</h1>
            <p className="text-muted-foreground text-sm">
              Generate one-time or multi-use codes for the closed beta. New users must redeem one
              to create an account.
            </p>
          </div>
        </header>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Plus className="h-4 w-4" /> Create a new code
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="code">Code</Label>
                <div className="flex gap-2">
                  <Input
                    id="code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    className="font-mono tracking-wider"
                  />
                  <Button type="button" variant="outline" onClick={() => setCode(randomCode())}>
                    Roll
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="note">Note (optional)</Label>
                <Input
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Twitter launch batch"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="maxUses">Max uses</Label>
                <Input
                  id="maxUses"
                  type="number"
                  min={1}
                  value={maxUses}
                  onChange={(e) => setMaxUses(parseInt(e.target.value, 10) || 1)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="expires">Expires in (days)</Label>
                <Input
                  id="expires"
                  type="number"
                  min={1}
                  placeholder="never"
                  value={expiresInDays}
                  onChange={(e) =>
                    setExpiresInDays(e.target.value === '' ? '' : parseInt(e.target.value, 10) || '')
                  }
                />
              </div>
            </div>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !code.trim()}
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Create code
            </Button>
          </CardContent>
        </Card>

        <div>
          <h2 className="font-semibold mb-3">Existing codes</h2>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !codes?.length ? (
            <p className="text-muted-foreground text-sm">No codes yet.</p>
          ) : (
            <div className="space-y-2">
              {codes.map((c) => {
                const exhausted = c.uses >= c.max_uses;
                const expired = c.expires_at && new Date(c.expires_at) < new Date();
                const dead = exhausted || expired;
                return (
                  <Card key={c.id} className={dead ? 'opacity-60' : ''}>
                    <CardContent className="py-3 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-semibold tracking-wider">{c.code}</span>
                          <span className="text-xs text-muted-foreground">
                            {c.uses}/{c.max_uses} used
                          </span>
                          {expired ? (
                            <span className="text-xs text-rose-600">expired</span>
                          ) : exhausted ? (
                            <span className="text-xs text-rose-600">used up</span>
                          ) : null}
                        </div>
                        {c.note && (
                          <p className="text-xs text-muted-foreground truncate">{c.note}</p>
                        )}
                        {c.expires_at && !expired && (
                          <p className="text-xs text-muted-foreground">
                            expires {new Date(c.expires_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleCopy(c.code)}
                          aria-label="Copy"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(c.id)}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4 text-rose-600" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
};

export default AdminInviteCodes;
