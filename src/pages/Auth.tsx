import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/design-system";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HomeButton } from "@/components/HomeButton";
import { AppShell } from "@/components/layout/AppShell";
import { IngleezyLogo } from "@/components/brand/IngleezyLogo";
import { IngleezyLoading } from "@/components/brand/IngleezyMark";
import { Loader2, Mail, Lock, UserPlus, LogIn, Ticket } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Lightweight inline validators — dropping `zod` here saves ~12 kB gz on the Auth chunk.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validateAuthInput = (
  email: string,
  password: string,
  inviteCode: string,
  isSignup: boolean,
) => {
  const errors: { email?: string; password?: string; inviteCode?: string } = {};
  if (!EMAIL_RE.test(email.trim())) errors.email = "أدخل بريداً إلكترونياً صحيحاً";
  if (password.length < 6) errors.password = "يجب ألا تقل كلمة المرور عن 6 أحرف";
  if (isSignup && inviteCode.trim().length < 4) errors.inviteCode = "رمز الدعوة مطلوب";
  return errors;
};

const Auth = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Where the user was headed before being bounced to /auth (set by ProtectedRoute).
  const redirectTo = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const { toast } = useToast();
  const { signIn, signUp, isAuthenticated, loading } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; inviteCode?: string }>({});

  useEffect(() => {
    if (isAuthenticated && !loading) {
      // Check if onboarding is completed
      const checkOnboarding = async () => {
        const { data } = await supabase
          .from('profiles' as any)
          .select('onboarding_completed')
          .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
          .maybeSingle();
        if (data && !(data as any).onboarding_completed) {
          navigate('/onboarding');
        } else {
          navigate(redirectTo && redirectTo !== '/auth' ? redirectTo : '/');
        }
      };
      checkOnboarding();
    }
  }, [isAuthenticated, loading, navigate, redirectTo]);

  const validateForm = () => {
    const newErrors = validateAuthInput(email, password, inviteCode, !isLogin);
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) {
          toast({
            title: "فشل تسجيل الدخول",
            description: error.message === "Invalid login credentials"
              ? "البريد الإلكتروني أو كلمة المرور غير صحيحة. حاول من جديد."
              : error.message,
            variant: "destructive",
          });
        } else {
          toast({
            title: "أهلاً بعودتك",
            description: "جاهز لمواصلة التعلم؟",
          });
        }
      } else {
        // Pre-validate invite code before creating the account so we don't leave
        // orphan users behind when a code is bad/expired/used up.
        const trimmedCode = inviteCode.trim().toUpperCase();
        const { data: codeOk, error: verifyError } = await supabase.rpc(
          "verify_invite_code",
          { _code: trimmedCode },
        );
        if (verifyError) {
          toast({
            title: "تعذّر التحقق من رمز الدعوة",
            description: verifyError.message,
            variant: "destructive",
          });
          return;
        }
        if (!codeOk) {
          setErrors((prev) => ({ ...prev, inviteCode: "رمز غير صالح أو منتهٍ أو مستنفد" }));
          toast({
            title: "لم يُقبل رمز الدعوة",
            description: "تأكد من الرمز أو اطلب رمزاً جديداً.",
            variant: "destructive",
          });
          return;
        }

        const { error } = await signUp(email, password);
        if (error) {
          toast({
            title: "فشل إنشاء الحساب",
            description: error.message.includes("already registered")
              ? "هذا البريد مسجّل من قبل. جرّب تسجيل الدخول."
              : error.message,
            variant: "destructive",
          });
          return;
        }

        // Best-effort redemption. If it races (someone else used the last seat
        // between verify and redeem) we surface that and sign the user out.
        const { error: redeemError } = await supabase.rpc(
          "redeem_invite_code",
          { _code: trimmedCode },
        );
        if (redeemError) {
          await supabase.auth.signOut();
          toast({
            title: "تعذّر استخدام رمز الدعوة",
            description: redeemError.message || "حاول برمز آخر.",
            variant: "destructive",
          });
          return;
        }

        toast({
          title: "تم إنشاء الحساب",
          description: "كل شيء جاهز لتبدأ التعلم.",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <IngleezyLoading className="py-24" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-8">
        <HomeButton />
      </div>

      {/* Main Content - centered with generous spacing */}
      <div className="max-w-sm mx-auto">
        {/* Logo and Title */}
        <div className="text-center mb-10">
          <IngleezyLogo className="mx-auto mb-5 text-3xl" />
          <h1 className="text-2xl font-bold text-foreground mb-2 font-heading">
            {isLogin ? "أهلاً بعودتك" : "انضم إلى إنجليزي"}
          </h1>
          <p className="text-muted-foreground">
            {isLogin
              ? "سجّل الدخول لمواصلة رحلة تعلمك"
              : "أنشئ حساباً لتتبع تقدمك"}
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-card rounded-xl p-6 border border-border">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                البريد الإلكتروني
              </Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="h-11 rounded-lg"
                disabled={isSubmitting}
              />
              {errors.email && (
                <p className="text-destructive text-sm">{errors.email}</p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium flex items-center gap-2">
                <Lock className="h-4 w-4 text-muted-foreground" />
                كلمة المرور
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete={isLogin ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11 rounded-lg"
                disabled={isSubmitting}
              />
              {errors.password && (
                <p className="text-destructive text-sm">{errors.password}</p>
              )}
              {isLogin && (
                <div className="text-right">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={async () => {
                      if (!EMAIL_RE.test(email.trim())) {
                        setErrors((prev) => ({ ...prev, email: "أدخل بريدك الإلكتروني أعلاه أولاً" }));
                        return;
                      }
                      setIsSubmitting(true);
                      try {
                        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
                          redirectTo: `${window.location.origin}/reset-password`,
                        });
                        if (error) {
                          toast({
                            title: "تعذّر إرسال رابط إعادة التعيين",
                            description: error.message,
                            variant: "destructive",
                          });
                        } else {
                          toast({
                            title: "تفقد بريدك الوارد",
                            description: "أرسلنا لك رابطاً لإعادة تعيين كلمة المرور.",
                          });
                        }
                      } finally {
                        setIsSubmitting(false);
                      }
                    }}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    نسيت كلمة المرور؟
                  </button>
                </div>
              )}
            </div>

            {/* Invite code (signup only) */}
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="inviteCode" className="text-sm font-medium flex items-center gap-2">
                  <Ticket className="h-4 w-4 text-muted-foreground" />
                  رمز الدعوة التجريبي
                </Label>
                <Input
                  id="inviteCode"
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="مثلاً: INGLEEZY-XXXX"
                  className="h-11 rounded-lg font-mono tracking-wider"
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  disabled={isSubmitting}
                />
                {errors.inviteCode && (
                  <p className="text-destructive text-sm">{errors.inviteCode}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  إنجليزي في مرحلة تجريبية مغلقة. لا تملك رمزاً؟ راسلنا على hello@ingleezy.app
                </p>
              </div>
            )}


            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full h-11"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isLogin ? (
                <>
                  <LogIn className="h-4 w-4 me-2" />
                  تسجيل الدخول
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 me-2" />
                  إنشاء حساب
                </>
              )}
            </Button>
          </form>

          {/* Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">أو تابع باستخدام</span>
            </div>
          </div>

          {/* Google Sign In */}
          <Button
            type="button"
            variant="outline"
            className="w-full h-11"
            disabled={isSubmitting}
            onClick={async () => {
              setIsSubmitting(true);
              try {
                const { error } = await lovable.auth.signInWithOAuth("google", {
                  redirect_uri: window.location.origin,
                });
                if (error) {
                  toast({
                    title: "فشل تسجيل الدخول عبر Google",
                    description: String(error),
                    variant: "destructive",
                  });
                }
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            <svg className="h-4 w-4 me-2" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            المتابعة عبر Google
          </Button>

          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setErrors({});
              }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {isLogin ? (
                <>
                  جديد هنا؟{" "}
                  <span className="font-medium text-primary">أنشئ حساباً</span>
                </>
              ) : (
                <>
                  لديك حساب بالفعل؟{" "}
                  <span className="font-medium text-primary">سجّل الدخول</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
};

export default Auth;
