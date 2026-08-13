import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { HomeButton } from "@/components/HomeButton";
import { Button } from "@/components/design-system";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Lock } from "lucide-react";

const ResetPassword = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isReady, setIsReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Supabase delivers recovery via PKCE (?code=) or hash (#type=recovery).
    // The auth client auto-exchanges; we just need a session to update password.
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setIsReady(true);
      } else {
        // Give the client a moment to exchange the code in the URL.
        const sub = supabase.auth.onAuthStateChange((event) => {
          if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
            setIsReady(true);
          }
        });
        setTimeout(async () => {
          const { data: again } = await supabase.auth.getSession();
          if (!again.session) {
            setError("This password reset link is invalid or has expired. Please request a new one.");
          }
        }, 1500);
        return () => sub.data.subscription.unsubscribe();
      }
    };
    check();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        toast({
          title: "Couldn't update password",
          description: updateError.message,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Password updated",
        description: "You're signed in with your new password.",
      });
      navigate("/");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="mb-8">
        <HomeButton />
      </div>
      <div className="max-w-sm mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold font-heading mb-2">Set a new password</h1>
          <p className="text-muted-foreground text-sm">
            Choose a new password for your Ingleezy account.
          </p>
        </div>
        <div className="bg-card rounded-xl p-6 border border-border">
          {!isReady && !error && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
          {error && (
            <div className="space-y-4">
              <p className="text-destructive text-sm">{error}</p>
              <Button onClick={() => navigate("/auth")} className="w-full">
                Back to sign in
              </Button>
            </div>
          )}
          {isReady && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  New password
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-11 rounded-lg"
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm" className="text-sm font-medium flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  Confirm password
                </Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  className="h-11 rounded-lg"
                  disabled={isSubmitting}
                />
              </div>
              <Button type="submit" className="w-full h-11" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </AppShell>
  );
};

export default ResetPassword;
