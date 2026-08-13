import { useState } from "react";
import { Check, Copy, Gift, Loader2, Share2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ReferralInfo {
  code: string;
  referrals: { pending: number; converted: number; rewarded: number };
  redeemed: boolean;
  rewards_enabled: boolean;
}

/**
 * The learner's referral card — collapsed by default and fetched only on
 * open, so pages that host it pay nothing until the learner shows intent.
 * Copy adapts to whether rewards are configured server-side
 * (STRIPE_REFERRAL_COUPON): with them it's "give a month, get a month";
 * without, it's a plain invite.
 */
export function ReferralCard() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [redeemInput, setRedeemInput] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  const load = async () => {
    setOpen(true);
    if (info || loading) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("referral", {
        body: { action: "get" },
      });
      if (error || !data?.code) throw error ?? new Error("no code");
      setInfo(data as ReferralInfo);
    } catch {
      toast.error("Couldn't load your invite code — try again in a moment.");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(shareText(info));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — long-press the code instead.");
    }
  };

  const share = async () => {
    if (!info) return;
    const text = shareText(info);
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        /* learner dismissed the sheet */
      }
    } else {
      void copy();
    }
  };

  const shareText = (i: ReferralInfo) =>
    i.rewards_enabled
      ? `I'm learning spoken Arabic on Ingleezy — join with my code ${i.code} and your first month is free: https://ingleezy.app/?ref=${i.code}`
      : `I'm learning spoken Arabic on Ingleezy — join me with my code ${i.code}: https://ingleezy.app/?ref=${i.code}`;

  const redeem = async () => {
    const code = redeemInput.trim();
    if (!code) return;
    setRedeeming(true);
    try {
      const { data, error } = await supabase.functions.invoke("referral", {
        body: { action: "redeem", code },
      });
      if (error || data?.error) {
        const message =
          (data as { message?: string } | null)?.message ??
          "Couldn't redeem that code.";
        toast.error(message);
        return;
      }
      toast.success(
        info?.rewards_enabled
          ? "Code accepted — your first month's discount applies at checkout."
          : "Code accepted!",
      );
      setInfo((prev) => (prev ? { ...prev, redeemed: true } : prev));
      setRedeemInput("");
    } finally {
      setRedeeming(false);
    }
  };

  if (!open) {
    return (
      <Button variant="outline" className="w-full gap-2" onClick={load}>
        <Gift className="h-4 w-4" />
        Invite friends
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Gift className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">
          {info?.rewards_enabled ? "Give a month, get a month" : "Invite friends"}
        </p>
      </div>

      {loading || !info ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {info.rewards_enabled
              ? "Friends who join with your code get their first month free — and when they subscribe, a month's credit lands on your account."
              : "Share your code with friends learning Arabic."}
          </p>

          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border border-border bg-muted/50 px-3 py-2 text-center font-mono text-lg tracking-widest">
              {info.code}
            </code>
            <Button size="icon" variant="outline" onClick={copy} aria-label="Copy invite">
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button size="icon" variant="outline" onClick={share} aria-label="Share invite">
              <Share2 className="h-4 w-4" />
            </Button>
          </div>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {info.referrals.pending + info.referrals.converted + info.referrals.rewarded} joined ·{" "}
            {info.referrals.converted + info.referrals.rewarded} subscribed
          </p>

          {!info.redeemed && (
            <div className="flex items-center gap-2 border-t border-border pt-3">
              <Input
                placeholder="Got a code? Enter it here"
                value={redeemInput}
                onChange={(e) => setRedeemInput(e.target.value)}
                className="h-8 text-sm"
                aria-label="Referral code"
              />
              <Button size="sm" onClick={redeem} disabled={redeeming || !redeemInput.trim()}>
                {redeeming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Redeem"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
