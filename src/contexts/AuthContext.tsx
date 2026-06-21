import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@/types';
import { supabase } from '@/lib/supabase';
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    initializeDemoData();

    // Fast, reliable initial session check (reads from localStorage synchronously).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        fetchUserProfile(session.user.id);
      } else {
        setIsLoading(false);
      }
    });

    // Listen for auth state changes (logout, session expiry, token refresh).
    // SIGNED_IN is intentionally NOT handled here — fetchUserProfile() makes
    // a Supabase data request and calling it inside onAuthStateChange causes a
    // deadlock in the Supabase auth library (the auth lock is held during the
    // event callback). login() calls fetchUserProfile() directly instead, after
    // signInWithPassword() fully completes and releases the lock.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, !!session);

      if (event === 'SIGNED_OUT') {
        setUser(null);
        setIsLoading(false);
      } else if (event === 'TOKEN_REFRESHED') {
        if (session?.user) {
          await fetchUserProfile(session.user.id);
        } else {
          setUser(null);
          setIsLoading(false);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserProfile = async (userId: string, retryCount = 0): Promise<boolean> => {
    try {
      console.log(`Fetching profile for user ${userId} (attempt ${retryCount + 1})`);
      const result = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      console.log('Profile query result:', { data: !!result.data, error: result.error });

      if (result.error) {
        console.error('Profile fetch error:', result.error);
        if (result.error.code === 'PGRST116' && retryCount < 5) {
          console.log(`Profile not found yet, retrying in ${(retryCount + 1) * 300}ms...`);
          await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 300));
          return await fetchUserProfile(userId, retryCount + 1);
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

        console.log('Profile loaded successfully:', result.data.email);
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

        console.log('Setting user profile');
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
      console.log('Setting isLoading to false');
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      console.log('Logging in...');
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('Auth error:', error);
        return { success: false, error: error.message };
      }

      if (data.user) {
        console.log('Auth successful, fetching profile...');
        // Fetch profile directly here (after signInWithPassword fully completes)
        // rather than from onAuthStateChange to avoid a deadlock in the Supabase
        // auth library (the auth lock is held while dispatching events).
        const success = await fetchUserProfile(data.user.id);
        if (success) {
          console.log('Login successful, user profile loaded');
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
