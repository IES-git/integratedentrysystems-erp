import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@/types';
import { userStorage, initializeDemoData } from '@/lib/storage';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  switchUser: (userId: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Initialize demo data and load current user
    initializeDemoData();
    const currentUser = userStorage.getCurrentUser();
    setUser(currentUser);
    setIsLoading(false);
  }, []);

  const login = async (email: string, _password: string): Promise<boolean> => {
    // Demo login - find user by email
    const users = userStorage.getAll();
    const foundUser = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.active);
    
    if (foundUser) {
      userStorage.setCurrentUser(foundUser);
      setUser(foundUser);
      return true;
    }
    return false;
  };

  const logout = () => {
    userStorage.setCurrentUser(null);
    setUser(null);
  };

  const switchUser = (userId: string) => {
    const foundUser = userStorage.getById(userId);
    if (foundUser && foundUser.active) {
      userStorage.setCurrentUser(foundUser);
      setUser(foundUser);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, switchUser }}>
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
