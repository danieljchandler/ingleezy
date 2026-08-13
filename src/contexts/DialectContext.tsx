import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export type DialectModule = 'Gulf' | 'Egyptian' | 'Yemeni';

interface DialectContextType {
  activeDialect: DialectModule;
  setDialect: (dialect: DialectModule) => void;
}

const DialectContext = createContext<DialectContextType>({
  activeDialect: 'Gulf',
  setDialect: () => {},
});

const STORAGE_KEY = 'hakiya_dialect_module';

/** Query-key prefixes that depend on the active dialect and should be
 *  invalidated when the user switches dialect. */
const DIALECT_DEPENDENT_KEYS = [
  'due-words',
  'review-stats',
  'all-vocabulary-words',
  'user-vocabulary',
  'topics',
  'lessons',
  'smart-notifications',
];

/** Per-dialect accent palette (HSL triplets).
 *  Exposed as --dialect-accent for opt-in components only.
 *  We intentionally do NOT override --primary / --accent / --ring globally —
 *  that washes the entire app in one dialect's hue. */
const DIALECT_THEMES: Record<DialectModule, { accent: string; glow: string }> = {
  Gulf:     { accent: '12 68% 32%', glow: '28 70% 48%' },
  Egyptian: { accent: '38 85% 45%', glow: '42 95% 55%' },
  Yemeni:   { accent: '0 70% 42%',  glow: '0 75% 55%'  },
};

function applyDialectTheme(dialect: DialectModule) {
  if (typeof document === 'undefined') return;
  const theme = DIALECT_THEMES[dialect];
  const root = document.documentElement;
  try {
    root.style.setProperty('--dialect-accent', theme.accent);
    root.style.setProperty('--dialect-glow', theme.glow);
    // Clean up any previously-applied global overrides from earlier builds.
    root.style.removeProperty('--primary');
    root.style.removeProperty('--accent');
    root.style.removeProperty('--ring');
    root.style.removeProperty('--primary-glow');
    root.dataset.dialect = dialect.toLowerCase();
  } catch {
    // ignore (SSR / restricted iframe)
  }
}

export const DialectProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [activeDialect, setActiveDialect] = useState<DialectModule>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return (stored === 'Gulf' || stored === 'Egyptian' || stored === 'Yemeni') ? stored : 'Gulf';
    } catch {
      return 'Gulf';
    }
  });

  // On mount, sync from profile if authenticated
  useEffect(() => {
    const syncFromProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('profiles' as never)
        .select('preferred_dialect')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        const dialect = (data as Record<string, unknown>).preferred_dialect;
        if (dialect === 'Gulf' || dialect === 'Egyptian' || dialect === 'Yemeni') {
          setActiveDialect(dialect);
          try { localStorage.setItem(STORAGE_KEY, dialect); } catch {}
        }
      }
    };
    syncFromProfile();
  }, []);

  // Apply theme tokens whenever the active dialect changes (and on mount).
  useEffect(() => {
    applyDialectTheme(activeDialect);
  }, [activeDialect]);

  const setDialect = (dialect: DialectModule) => {
    setActiveDialect(dialect);
    try { localStorage.setItem(STORAGE_KEY, dialect); } catch {}

    // Invalidate only dialect-dependent queries instead of the entire cache
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && DIALECT_DEPENDENT_KEYS.includes(key);
      },
    });

    // Persist to profile if authenticated — with error handling
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase
          .from('profiles' as never)
          .update({ preferred_dialect: dialect } as never)
          .eq('user_id', user.id)
          .then(({ error }) => {
            if (error) {
              console.error('Failed to persist dialect preference:', error);
              toast.error('Could not save dialect preference');
            }
          });
      }
    });
  };

  return (
    <DialectContext.Provider value={{ activeDialect, setDialect }}>
      {children}
    </DialectContext.Provider>
  );
};

export const useDialect = () => useContext(DialectContext);
