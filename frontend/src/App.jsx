import React, { useState, useEffect } from 'react';
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
import FriendsPage from './screens/FriendsPage';
import ProPage from './screens/ProPage';
import { BackendProvider } from './hooks/useBackend';
import { AuthProvider, useAuth } from './hooks/useAuth';

/**
 * AppContent - 最小化加载逻辑
 * 
 * 策略：简单 1.5 秒超时后显示页面，避免任何复杂状态管理导致的黑屏
 */

// 超时时间（毫秒）
const LOADING_TIMEOUT = 1500;

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  
  // 使用简单的时间戳追踪加载状态
  const [loadingStart] = useState(() => Date.now());
  const [shouldShowPage, setShouldShowPage] = useState(false);

  // 固定超时后显示页面
  useEffect(() => {
    const elapsed = Date.now() - loadingStart;
    const remaining = Math.max(0, LOADING_TIMEOUT - elapsed);
    
    const timer = setTimeout(() => {
      setShouldShowPage(true);
    }, remaining);
    
    return () => clearTimeout(timer);
  }, [loadingStart]);

  // 路由重定向（仅在页面可见时执行）
  useEffect(() => {
    if (!shouldShowPage || authLoading) return;

    const path = location.pathname;

    if (isAuthenticated && (path === '/register' || path === '/forgot-password')) {
      return;
    }

    if (!isAuthenticated) {
      if (path !== '/login' && path !== '/register' && path !== '/forgot-password') {
        navigate('/login', { replace: true });
      }
      return;
    }

    if (path === '/login') {
      navigate('/personal', { replace: true });
    }
  }, [shouldShowPage, authLoading, isAuthenticated, location.pathname, navigate]);

  // 加载中显示 LoadingScreen
  if (!shouldShowPage) {
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
      <Route path="/friends" element={<FriendsPage />} />
      <Route path="/pro" element={<ProPage />} />
      <Route path="/live/*" element={<LiveModePage />} />
    </Routes>
  );
}

function RootRedirect() {
  const { isAuthenticated } = useAuth();
  return <Navigate to={isAuthenticated ? '/personal' : '/login'} replace />;
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