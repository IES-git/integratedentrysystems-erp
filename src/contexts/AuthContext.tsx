import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@/types';
import { createSupabaseAccessTokenClient, supabase, supabaseAuthStorageKey } from '@/lib/supabase';
import { initializeDemoData } from '@/lib/storage';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  forgotPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_BOOT_TIMEOUT_MS = 6000;
const PROFILE_FETCH_TIMEOUT_MS = 8000;
const SESSION_EXPIRY_GRACE_MS = 30_000;

type StoredSupabaseSession = {
  access_token?: string;
  expires_at?: number;
  user?: {
    id?: string;
  };
};

function readStoredSupabaseSession(): StoredSupabaseSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const rawSession = window.localStorage.getItem(supabaseAuthStorageKey);
    if (!rawSession) return null;

    const session = JSON.parse(rawSession) as StoredSupabaseSession;
    if (!session.access_token || !session.user?.id) return null;

    if (session.expires_at && session.expires_at * 1000 <= Date.now() + SESSION_EXPIRY_GRACE_MS) {
      return null;
    }

    return session;
  } catch (error) {
    console.warn('Unable to read stored Supabase session.', error);
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, timeoutMs);

    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => window.clearTimeout(timeoutId));
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    initializeDemoData();

    const finishLoading = () => {
      if (isMounted) {
        setIsLoading(false);
      }
    };

    const bootstrapAuth = async () => {
      const storedSession = readStoredSupabaseSession();
      if (storedSession?.user?.id && storedSession.access_token) {
        await fetchUserProfile(storedSession.user.id, 0, storedSession.access_token);
        return;
      }

      try {
        const {
          data: { session },
        } = await withTimeout(supabase.auth.getSession(), AUTH_BOOT_TIMEOUT_MS, 'Initial auth session check');

        if (!isMounted) return;

        if (session?.user) {
          await fetchUserProfile(session.user.id, 0, session.access_token);
        } else {
          setUser(null);
          finishLoading();
        }
      } catch (error) {
        console.warn('Initial auth check failed; showing login instead of blocking on loading.', error);
        if (isMounted) {
          setUser(null);
          setIsLoading(false);
        }
      }
    };

    void bootstrapAuth();

    // Keep this listener synchronous. Supabase invokes auth-state callbacks
    // while its auth lock can be held, so profile/data reads are deferred.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setIsLoading(false);
      } else if (event === 'TOKEN_REFRESHED') {
        if (session?.user) {
          window.setTimeout(() => {
            void fetchUserProfile(session.user.id, 0, session.access_token);
          }, 0);
        } else {
          setUser(null);
          setIsLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const fetchUserProfile = async (
    userId: string,
    retryCount = 0,
    accessToken?: string,
  ): Promise<boolean> => {
    try {
      const profileClient = accessToken ? createSupabaseAccessTokenClient(accessToken) : supabase;
      const result = await withTimeout(
        profileClient
          .from('users')
          .select('*')
          .eq('id', userId)
          .single(),
        PROFILE_FETCH_TIMEOUT_MS,
        'User profile fetch',
      );

      if (result.error) {
        console.error('Profile fetch error:', result.error);
        if (result.error.code === 'PGRST116' && retryCount < 5) {
          await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 300));
          return await fetchUserProfile(userId, retryCount + 1, accessToken);
        }
        throw result.error;
      }

      if (result.data) {
        // Active-user gate: deactivated accounts cannot log in
        if (!result.data.active) {
          console.warn('Login blocked: account is deactivated');
          await supabase.auth.signOut();
          setUser(null);
          return false;
        }

        const userProfile: User = {
          id: result.data.id,
          name: `${result.data.first_name} ${result.data.last_name}`,
          email: result.data.email,
          firstName: result.data.first_name,
          lastName: result.data.last_name,
          jobTitle: result.data.job_title,
          role: result.data.role,
          active: result.data.active,
          createdAt: result.data.created_at,
        };

        setUser(userProfile);
        return true;
      } else {
        console.error('No data returned from profile query');
        return false;
      }
    } catch (error) {
      console.error('Error in fetchUserProfile:', error);
      await supabase.auth.signOut();
      setUser(null);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('Auth error:', error);
        return { success: false, error: error.message };
      }

      if (data.user) {
        // Use the returned access token for the profile read so the query does
        // not need to reacquire Supabase Auth's cross-tab lock during login.
        const success = await fetchUserProfile(data.user.id, 0, data.session?.access_token);
        if (success) {
          return { success: true };
        } else {
          // fetchUserProfile already signed out if the account is inactive
          return {
            success: false,
            error: 'Your account has been deactivated. Please contact an administrator.',
          };
        }
      }
      return { success: false, error: 'An unexpected error occurred.' };
    } catch (error: unknown) {
      console.error('Login error:', error);
      const message = error instanceof Error ? error.message : 'An error occurred during login';
      return { success: false, error: message };
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const forgotPassword = async (email: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An error occurred';
      return { success: false, error: message };
    }
  };

  const resetPassword = async (newPassword: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { success: false, error: error.message };
      // Recovery links create a temporary authenticated session. The reset UI
      // promises a return to login, so clear that recovery session explicitly.
      await supabase.auth.signOut();
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An error occurred';
      return { success: false, error: message };
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, forgotPassword, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
