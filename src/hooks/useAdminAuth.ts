import { useState, useEffect, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export type UserRole = 'admin' | 'content_reviewer' | 'recorder' | null;

export const useAdminAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isContentReviewer, setIsContentReviewer] = useState(false);
  const [isRecorder, setIsRecorder] = useState(false);
  const [role, setRole] = useState<UserRole>(null);
  const [loading, setLoading] = useState(true);
  // Track the currently-authenticated user ID so token refreshes for the
  // same user don't trigger a loading spinner (which causes a white flash).
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Check for existing session FIRST, then subscribe to changes.
    // This avoids a race condition where a token refresh could fire
    // between subscribing and checking the initial session.
    let subscription: { unsubscribe: () => void } | null = null;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        currentUserIdRef.current = session.user.id;
        checkRoles(session.user.id);
      } else {
        setLoading(false);
      }

      // Now subscribe to future auth state changes
      const { data } = supabase.auth.onAuthStateChange(
        (_event, newSession) => {
          setSession(newSession);
          setUser(newSession?.user ?? null);

          if (newSession?.user) {
            const isNewUser = newSession.user.id !== currentUserIdRef.current;
            currentUserIdRef.current = newSession.user.id;

            if (isNewUser) {
              setLoading(true);
            }
            setTimeout(() => {
              checkRoles(newSession.user.id);
            }, 0);
          } else {
            currentUserIdRef.current = null;
            setIsAdmin(false);
            setIsContentReviewer(false);
            setIsRecorder(false);
            setRole(null);
            setLoading(false);
          }
        }
      );
      subscription = data.subscription;
    };

    init();

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  const checkRoles = async (userId: string) => {
    try {
      // Check all relevant roles in parallel
      const [adminResult, contentReviewerResult, recorderResult] = await Promise.all([
        supabase.rpc('has_role', { _user_id: userId, _role: 'admin' }),
        supabase.rpc('has_role', { _user_id: userId, _role: 'content_reviewer' }),
        supabase.rpc('has_role', { _user_id: userId, _role: 'recorder' }),
      ]);

      const adminRole = adminResult.data === true;
      const contentReviewerRole = contentReviewerResult.data === true;
      const recorderRole = recorderResult.data === true;

      setIsAdmin(adminRole);
      setIsContentReviewer(contentReviewerRole);
      setIsRecorder(recorderRole);
      
      if (adminRole) {
        setRole('admin');
      } else if (contentReviewerRole) {
        setRole('content_reviewer');
      } else if (recorderRole) {
        setRole('recorder');
      } else {
        setRole(null);
      }
    } catch (err) {
      console.error('Error checking roles:', err);
      setIsAdmin(false);
      setIsContentReviewer(false);
      setIsRecorder(false);
      setRole(null);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string) => {
    const redirectUrl = `${window.location.origin}/admin`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl
      }
    });
    return { error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (!error) {
      setUser(null);
      setSession(null);
      setIsAdmin(false);
      setIsContentReviewer(false);
      setIsRecorder(false);
      setRole(null);
    }
    return { error };
  };

  return {
    user,
    session,
    isAdmin,
    isContentReviewer,
    isRecorder,
    role,
    loading,
    signIn,
    signUp,
    signOut,
  };
};
