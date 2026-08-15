import { Link } from "react-router-dom";

/**
 * Global footer with legal links + contact.
 * Lightweight, no shadcn deps so it can be used on auth/landing pages.
 */
export function Footer() {
  return (
    <footer className="mt-12 pt-6 pb-8 border-t border-border/60">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} إنجليزي — الإنجليزي للناطقين بالعربية.</p>
        <nav className="flex items-center gap-4">
          <Link to="/terms" className="hover:text-foreground hover:underline transition-colors">
            الشروط
          </Link>
          <Link to="/privacy" className="hover:text-foreground hover:underline transition-colors">
            الخصوصية
          </Link>
          <a
            href="mailto:hello@ingleezy.app"
            className="hover:text-foreground hover:underline transition-colors"
          >
            تواصل معنا
          </a>
        </nav>
      </div>
    </footer>
  );
}
