import React, { useState, useEffect, useRef, createContext } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import LoadingScreen from './screens/LoadingScreen';
import AuthLayout from './screens/AuthLayout';
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
  
  // 使用 sessionStorage 避免 Vite 热重载导致状态重置
  // 首次加载后标记，以后刷新页面不会重新显示加载画面
  const initialLoadedRef = useRef(sessionStorage.getItem('initial_loaded') === 'true');
  const [, forceUpdate] = useState(0);

  // 初始化延迟（首次加载时）
  useEffect(() => {
    if (!initialLoadedRef.current) {
      const timer = setTimeout(() => {
        initialLoadedRef.current = true;
        sessionStorage.setItem('initial_loaded', 'true');
        forceUpdate(k => k + 1);  // 触发重新渲染
      }, 2000);  // 2秒足够后端连接
      return () => clearTimeout(timer);
    }
  }, []);

  // Only redirect when path is login, register, forgot password page, or when not authenticated, to avoid interrupting /ambient, /live routes
  useEffect(() => {
    if (!initialLoadedRef.current || authLoading) return;

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
  }, [authLoading, isAuthenticated, location.pathname, navigate]);

  // 首次加载时显示 LoadingScreen
  if (!initialLoadedRef.current) {
    return <LoadingScreen />;
  }

  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
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
