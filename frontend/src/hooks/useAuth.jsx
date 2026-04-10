import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

// Auth context
const AuthContext = createContext(null);

// Demo user data
const DEMO_USERS = [
  {
    id: 'user_001',
    name: 'Yunkun',
    email: 'yunkun@focusisland.com',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Yunkun',
    totalPoints: 1250,
    streak: 7,
    level: 5
  },
  {
    id: 'user_002',
    name: 'Emma Wilson',
    email: 'emma@focusisland.com',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Emma',
    totalPoints: 890,
    streak: 3,
    level: 3
  }
];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Check for existing session on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('focus_island_user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (err) {
        localStorage.removeItem('focus_island_user');
      }
    }
  }, []);

  // Login
  const login = useCallback(async (email, password) => {
    setIsLoading(true);
    setError(null);

    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Find demo user or create new one
      let foundUser = DEMO_USERS.find(u => u.email === email);
      
      if (!foundUser && email) {
        // Create new user
        foundUser = {
          id: `user_${Date.now()}`,
          name: email.split('@')[0],
          email,
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${email.split('@')[0]}`,
          totalPoints: 0,
          streak: 0,
          level: 1
        };
      }

      if (foundUser) {
        setUser(foundUser);
        localStorage.setItem('focus_island_user', JSON.stringify(foundUser));
        return foundUser;
      } else {
        throw new Error('Invalid credentials');
      }
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Logout
  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('focus_island_user');
  }, []);

  // Update user points
  const updatePoints = useCallback((points) => {
    if (user) {
      const updatedUser = {
        ...user,
        totalPoints: user.totalPoints + points
      };
      setUser(updatedUser);
      localStorage.setItem('focus_island_user', JSON.stringify(updatedUser));
    }
  }, [user]);

  // Update streak
  const updateStreak = useCallback((streak) => {
    if (user) {
      const updatedUser = {
        ...user,
        streak
      };
      setUser(updatedUser);
      localStorage.setItem('focus_island_user', JSON.stringify(updatedUser));
    }
  }, [user]);

  /** Merge partial fields into current user and persist (demo / local only) */
  const updateUser = useCallback((patch) => {
    if (user && patch && typeof patch === 'object') {
      const updatedUser = { ...user, ...patch };
      setUser(updatedUser);
      localStorage.setItem('focus_island_user', JSON.stringify(updatedUser));
      return updatedUser;
    }
    return user;
  }, [user]);

  /** Clear local session (demo "delete account") */
  const clearLocalAccount = useCallback(() => {
    setUser(null);
    localStorage.removeItem('focus_island_user');
  }, []);

  const value = {
    user,
    isLoading,
    isAuthenticated: !!user,
    error,
    login,
    logout,
    updatePoints,
    updateStreak,
    updateUser,
    clearLocalAccount
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
