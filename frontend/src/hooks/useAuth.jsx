import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { buildDicebearAvatarUrl, emailLocalPart } from '../lib/avatarUrl';

// Auth context
const AuthContext = createContext(null);

function avatarSeedForUser(u) {
  if (!u || typeof u !== 'object') return 'user';
  const fromName = u.name && String(u.name).trim();
  return fromName || emailLocalPart(u.email);
}

/** Ensures avatar URL matches profile and is safe for query strings (fixes broken img after edits). */
function ensureUserAvatar(u) {
  if (!u || typeof u !== 'object') return u;
  return { ...u, avatar: buildDicebearAvatarUrl(avatarSeedForUser(u)) };
}

// Demo user data
const DEMO_USERS = [
  {
    id: 'user_001',
    name: 'Yunkun',
    email: 'yunkun@focusisland.com',
    avatar: buildDicebearAvatarUrl('Yunkun'),
    totalPoints: 1250,
    streak: 7,
    level: 5
  },
  {
    id: 'user_002',
    name: 'Emma Wilson',
    email: 'emma@focusisland.com',
    avatar: buildDicebearAvatarUrl('Emma Wilson'),
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
        const parsed = JSON.parse(savedUser);
        const normalized = ensureUserAvatar(parsed);
        setUser(normalized);
        localStorage.setItem('focus_island_user', JSON.stringify(normalized));
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
        const local = emailLocalPart(email);
        foundUser = {
          id: `user_${Date.now()}`,
          name: local,
          email,
          avatar: buildDicebearAvatarUrl(local),
          totalPoints: 0,
          streak: 0,
          level: 1
        };
      }

      if (foundUser) {
        const withAvatar = ensureUserAvatar(foundUser);
        setUser(withAvatar);
        localStorage.setItem('focus_island_user', JSON.stringify(withAvatar));
        return withAvatar;
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
      const updatedUser = ensureUserAvatar({
        ...user,
        totalPoints: user.totalPoints + points
      });
      setUser(updatedUser);
      localStorage.setItem('focus_island_user', JSON.stringify(updatedUser));
    }
  }, [user]);

  // Update streak
  const updateStreak = useCallback((streak) => {
    if (user) {
      const updatedUser = ensureUserAvatar({
        ...user,
        streak
      });
      setUser(updatedUser);
      localStorage.setItem('focus_island_user', JSON.stringify(updatedUser));
    }
  }, [user]);

  /** Merge partial fields into current user and persist (demo / local only) */
  const updateUser = useCallback((patch) => {
    if (user && patch && typeof patch === 'object') {
      const cleanPatch = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined)
      );
      const updatedUser = ensureUserAvatar({ ...user, ...cleanPatch });
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
