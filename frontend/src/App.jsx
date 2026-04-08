import React, { useState, useEffect, createContext } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import LoadingScreen from './screens/LoadingScreen';
import LoginScreen from './screens/LoginScreen';
import ForgotPasswordPage from './screens/ForgotPasswordPage';
import RegisterPage from './screens/RegisterPage';
import Dashboard from './screens/Dashboard';
import PersonalPage from './screens/PersonalPage';
import LiveModePage from './screens/LiveModePage';
import ProfilePage from './screens/ProfilePage';
import AccountPage from './screens/AccountPage';
import SettingsPage from './screens/SettingsPage';
import FaceSetupPage from './screens/FaceSetupPage';
import { BackendProvider } from './hooks/useBackend';
import { AuthProvider, useAuth } from './hooks/useAuth';

export const AppContext = createContext(null);

/** Application entry is mostly `/`, must match routes, otherwise Router won't render any page (black screen). */
function RootRedirect() {
  const { isAuthenticated } = useAuth();
  return <Navigate to={isAuthenticated ? '/personal' : '/login'} replace />;
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setInitialLoading(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Only redirect when path is login, register, forgot password page, or when not authenticated, to avoid interrupting /ambient, /live routes
  useEffect(() => {
    if (initialLoading || authLoading) return;

    const path = location.pathname;

    // Keep authenticated users on current page when visiting auth pages
    if (isAuthenticated && (path === '/register' || path === '/forgot-password')) {
      return;
    }

    if (!isAuthenticated) {
      if (path !== '/login' && path !== '/register' && path !== '/forgot-password') {
        navigate('/login', { replace: true });
      }
      return;
    }

    // Redirect authenticated users from login page to personal page
    if (path === '/login') {
      navigate('/personal', { replace: true });
    }
  }, [initialLoading, authLoading, isAuthenticated, location.pathname, navigate]);

  if (initialLoading || authLoading) {
    return <LoadingScreen />;
  }

  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/ambient" element={<Dashboard />} />
      <Route path="/face-setup" element={<FaceSetupPage />} />
      <Route path="/personal" element={<PersonalPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/account" element={<AccountPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/live/*" element={<LiveModePage />} />
    </Routes>
  );
}

function App() {
  return (
    <BackendProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BackendProvider>
  );
}

export default App;
