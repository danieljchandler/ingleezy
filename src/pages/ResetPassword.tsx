import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { PageCorner } from "@/components/shell/PageCorner";
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
            setError("رابط إعادة التعيين غير صالح أو انتهت صلاحيته. اطلب رابطاً جديداً.");
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
      setError("كلمة المرور لازم 6 أحرف على الأقل");
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
          title: "ما قدرنا نغيّر كلمة المرور",
          description: updateError.message,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "تغيّرت كلمة المرور",
        description: "دخلت بكلمة المرور الجديدة.",
      });
      navigate("/");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="mb-8">
        <PageCorner />
      </div>
      <div className="max-w-sm mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold font-heading mb-2">عيّن كلمة مرور جديدة</h1>
          <p className="text-muted-foreground text-sm">
            اختر كلمة مرور جديدة لحسابك في إنجليزي.
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
                رجوع لتسجيل الدخول
              </Button>
            </div>
          )}
          {isReady && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  كلمة المرور الجديدة
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
                  أكّد كلمة المرور
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
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "غيّر كلمة المرور"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </AppShell>
  );
};

export default ResetPassword;
