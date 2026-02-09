import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@/types';
import { supabase } from '@/lib/supabase';
import { initializeDemoData } from '@/lib/storage';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  signup: (email: string, password: string, firstName: string, lastName: string, jobTitle: string, role: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Initialize demo data for customers/manufacturers/templates
    initializeDemoData();

    // Check for existing Supabase session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        fetchUserProfile(session.user.id);
      } else {
        setIsLoading(false);
      }
    });

    // Listen for auth changes (for logout, session expiry, etc.)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, !!session);
      
      // Only handle sign out and token refresh, not sign in
      // (sign in is handled directly in the login/signup functions)
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
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
        // If profile not found and this is after signup, retry a few times
        // (race condition with trigger creating profile)
        if (result.error.code === 'PGRST116' && retryCount < 5) {
          console.log(`Profile not found yet, retrying in ${(retryCount + 1) * 300}ms... (attempt ${retryCount + 1})`);
          await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 300));
          return await fetchUserProfile(userId, retryCount + 1);
        }
        throw result.error;
      }

      if (result.data) {
        console.log('Profile loaded successfully:', result.data.email);
        // Map database fields to User type
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
        console.log('User profile set successfully');
        return true;
      } else {
        console.error('No data returned from profile query');
        return false;
      }
    } catch (error) {
      console.error('Error in fetchUserProfile:', error);
      // Sign out if we can't fetch profile after retries
      await supabase.auth.signOut();
      setUser(null);
      return false;
    } finally {
      console.log('Setting isLoading to false');
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      console.log('Logging in...');
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('Auth error:', error);
        return false;
      }

      if (data.user) {
        console.log('Auth successful, fetching profile...');
        // Directly fetch the user profile instead of waiting for the listener
        const success = await fetchUserProfile(data.user.id);
        
        if (success) {
          console.log('Login successful, user profile loaded');
          return true;
        } else {
          console.error('Failed to load user profile');
          return false;
        }
      }
      return false;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  };

  const signup = async (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    jobTitle: string,
    role: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      console.log('Starting signup process...');
      
      // Sign up the user with Supabase Auth and pass custom metadata
      // The database trigger will automatically create the user profile
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            job_title: jobTitle,
            role: role,
          },
        },
      });

      console.log('Signup response:', { user: authData.user?.id, session: !!authData.session, error: authError });

      if (authError) {
        return { success: false, error: authError.message };
      }

      if (!authData.user) {
        return { success: false, error: 'No user returned from signup' };
      }

      // If user is auto-confirmed and logged in, fetch the profile
      if (authData.session) {
        console.log('User auto-logged in, fetching profile...');
        const profileSuccess = await fetchUserProfile(authData.user.id);
        
        if (!profileSuccess) {
          console.error('Profile creation failed or timed out');
          return { success: false, error: 'Failed to create user profile. Please try again.' };
        }
      }

      console.log('Signup completed successfully');
      return { success: true };
    } catch (error: any) {
      console.error('Signup error:', error);
      return { success: false, error: error.message || 'An error occurred during signup' };
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, signup, logout }}>
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
