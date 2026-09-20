import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/design-system";
import { Home } from "lucide-react";
import { IconBack } from "@/components/shared/DirectionalIcon";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Page not found — Ingleezy";
    console.warn("404: route not found:", location.pathname);
  }, [location.pathname]);

  return (
    <AppShell>
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="text-center max-w-md">
          <p
            className="text-6xl font-bold mb-2 text-primary"
          >
            404
          </p>
          <h1
            className="text-2xl font-semibold mb-3 text-foreground"
          >
            ما لقينا هذي الصفحة
          </h1>
          <p className="text-muted-foreground mb-6">
            يمكن الرابط مكسور، أو الصفحة انتقلت. ارجع للرئيسية وابدأ من جديد.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={() => navigate(-1)} variant="outline" className="h-11">
              <IconBack className="h-4 w-4 me-2" />
              رجوع
            </Button>
            <Button onClick={() => navigate("/")} className="h-11">
              <Home className="h-4 w-4 me-2" />
              الرئيسية
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
};

export default NotFound;
