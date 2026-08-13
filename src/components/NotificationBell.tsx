import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSmartNotifications, SmartNotification } from "@/hooks/useSmartNotifications";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

export function NotificationBell() {
  const navigate = useNavigate();
  const { data: notifications } = useSmartNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const count = notifications?.length || 0;
  const highPriority = notifications?.filter(n => n.priority === "high").length || 0;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleAction = (n: SmartNotification) => {
    setOpen(false);
    if (n.actionUrl) navigate(n.actionUrl);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "relative p-2 rounded-lg transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-muted/50",
          open && "bg-muted/50 text-foreground"
        )}
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className={cn(
            "absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1",
            highPriority > 0
              ? "bg-destructive text-destructive-foreground animate-pulse"
              : "bg-primary text-primary-foreground"
          )}>
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className={cn(
          "absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto",
          "bg-card border border-border rounded-xl shadow-xl z-50",
          "animate-in fade-in slide-in-from-top-2 duration-200"
        )}>
          <div className="p-3 border-b border-border">
            <h3 className="font-semibold text-foreground text-sm">Notifications</h3>
          </div>

          {count === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-muted-foreground">You're all caught up! 🎉</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications?.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleAction(n)}
                  aria-label={`Notification: ${n.title}`}
                  className={cn(
                    "w-full text-left p-3 transition-colors hover:bg-muted/50",
                    n.priority === "high" && "bg-destructive/5"
                  )}
                >
                  <div className="flex gap-3">
                    <span className="text-xl shrink-0">{n.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "text-sm font-medium text-foreground leading-tight",
                        n.priority === "high" && "text-destructive"
                      )}>
                        {n.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                    </div>
                    {n.priority === "high" && (
                      <span className="text-[10px] font-bold text-destructive uppercase shrink-0">Urgent</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
