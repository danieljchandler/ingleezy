import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { IngleezyMark } from "@/components/brand/IngleezyMark";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * ProtectedRoute — redirects unauthenticated users to /auth.
 * Shows a loading spinner while auth state is being determined.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <IngleezyMark animate className="h-10 text-primary" label="جارٍ التحميل" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Preserve where the user was headed so /auth can return them there.
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
