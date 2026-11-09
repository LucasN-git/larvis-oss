import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { DEV_BYPASS_AUTH, loadDevSession, stubSession } from './devBypass';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  /** Schickt einen einmaligen Anmeldecode an ein bestehendes Konto; legt nie ein neues an. */
  signInWithOtp: (email: string) => Promise<{ error: string | null }>;
  /** Löst den Code aus der Mail gegen eine Sitzung ein. */
  verifyOtp: (email: string, token: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Mit Stub-Sitzung darf das INITIAL_SESSION-Ereignis (null) die Sitzung nicht löschen.
    let stub = false;
    const boot = async () => {
      // Die Tokens aus der Datei nur einmal einsetzen: eine gespeicherte Sitzung hat sie
      // bereits rotiert, ein erneutes setSession mit dem alten Refresh-Token würde die
      // ganze Sitzungsfamilie bei Supabase widerrufen.
      if (DEV_BYPASS_AUTH && !(await supabase.auth.getSession()).data.session) {
        const tokens = await loadDevSession();
        if (tokens) {
          const { error } = await supabase.auth.setSession(tokens);
          if (error) console.warn('[dev-bypass] Sitzung aus dev-session.json ungültig:', error.message);
        } else {
          stub = true;
          setSession(stubSession());
          setLoading(false);
          return;
        }
      }
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setLoading(false);
    };
    void boot();
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (stub && event === 'INITIAL_SESSION') return;
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    signInWithPassword: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },
    signInWithOtp: async (email) => {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      return { error: error?.message ?? null };
    },
    verifyOtp: async (email, token) => {
      const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
      return { error: error?.message ?? null };
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
