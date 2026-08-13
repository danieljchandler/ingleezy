import { useEffect } from 'react';
import { useNavigate, Outlet, useLocation } from 'react-router-dom';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { TranscriptionStatusBanner } from '@/components/admin/TranscriptionStatusBanner';
import { TranscriptionJobProvider } from '@/contexts/TranscriptionJobContext';
import { useDialect } from '@/contexts/DialectContext';
import AlertsBell from '@/components/admin/AlertsBell';
import { canAccessContentReviewerAdminPath } from '@/lib/rbac';

const DIALECT_META: Record<string, { flag: string; label: string; color: string }> = {
  Gulf: { flag: '🌊', label: 'Gulf Arabic Module', color: 'bg-sky-600' },
  Egyptian: { flag: '🇪🇬', label: 'Egyptian Arabic Module', color: 'bg-amber-600' },
  Yemeni: { flag: '🇾🇪', label: 'Yemeni Arabic Module', color: 'bg-red-700' },
};

const AdminLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, isContentReviewer, isRecorder, loading } = useAdminAuth();
  const { toast } = useToast();
  const { activeDialect, setDialect } = useDialect();
  const hasAnyPrivilegedRole = isAdmin || isRecorder || isContentReviewer;
  const hasGeneralAdminAccess = isAdmin || isRecorder;
  const hasContentReviewerAccess = isContentReviewer && canAccessContentReviewerAdminPath(location.pathname);
  const hasAccess = hasGeneralAdminAccess || hasContentReviewerAccess;

  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate('/admin/login');
      } else if (!hasAccess) {
        toast({
          variant: 'destructive',
          title: 'Access Denied',
          description: 'You do not have permission to access this admin section.',
        });
        navigate(hasAnyPrivilegedRole ? '/admin' : '/admin/login', { replace: true });
      }
    }
  }, [user, hasAccess, hasAnyPrivilegedRole, loading, navigate, toast]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Checking permissions...</p>
        </div>
      </div>
    );
  }

  if (!user || !hasAccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Redirecting…</p>
        </div>
      </div>
    );
  }

  const meta = DIALECT_META[activeDialect] || DIALECT_META.Gulf;
  const allDialects = Object.keys(DIALECT_META);
  const otherDialects = allDialects.filter(d => d !== activeDialect);

  return (
    <>
      {/* Dialect indicator bar */}
      <div className={`${meta.color} text-white px-4 py-2 flex items-center justify-between text-sm`}>
        <div className="flex items-center gap-2 font-medium">
          <span className="text-lg">{meta.flag}</span>
          <span>{meta.label}</span>
        </div>
        <div className="flex gap-1.5">
          {otherDialects.map(d => {
            const m = DIALECT_META[d];
            return (
              <button
                key={d}
                onClick={() => setDialect(d as 'Gulf' | 'Egyptian' | 'Yemeni')}
                className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 transition-colors rounded-full px-3 py-1 text-xs font-medium"
              >
                <span>{m.flag}</span>
                {m.label.replace(' Module', '')}
              </button>
            );
          })}
        </div>
      </div>
      <TranscriptionJobProvider>
        <Outlet />
        <TranscriptionStatusBanner />
        {isAdmin && <AlertsBell />}
      </TranscriptionJobProvider>
    </>
  );
};

export default AdminLayout;
