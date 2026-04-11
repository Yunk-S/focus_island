import React, { useState, useEffect, createContext } from 'react';
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

/** 
 * AppContent - 简化版解决 Vite 热重载黑屏问题
 * 
 * 策略：始终显示 LoadingScreen，直到所有依赖加载完成
 */

// 页面是否已完全加载（显示过内容后不再显示 LoadingScreen）
const LOADED_KEY = 'focus_island_page_loaded';

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  
  // 检查是否已经显示过主页面内容
  const [pageLoaded, setPageLoaded] = useState(() => {
    return sessionStorage.getItem(LOADED_KEY) === 'true';
  });

  // 加载完成超时 - 2秒后强制显示页面
  useEffect(() => {
    if (pageLoaded) return;
    
    const timer = setTimeout(() => {
      sessionStorage.setItem(LOADED_KEY, 'true');
      setPageLoaded(true);
      console.log('[App] Loading timeout, showing page');
    }, 2000);
    
    return () => clearTimeout(timer);
  }, [pageLoaded]);

  // 监听后端连接成功事件
  useEffect(() => {
    if (pageLoaded) return;
    
    // 检查是否有后端连接成功的日志
    const checkBackendConnection = setInterval(() => {
      // 通过检查 sessionStorage 中的标记
      if (sessionStorage.getItem(LOADED_KEY) === 'true') {
        setPageLoaded(true);
        clearInterval(checkBackendConnection);
      }
    }, 500);
    
    return () => clearInterval(checkBackendConnection);
  }, [pageLoaded]);

  // 路由重定向
  useEffect(() => {
    if (!pageLoaded || authLoading) return;

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
  }, [pageLoaded, authLoading, isAuthenticated, location.pathname, navigate]);

  // 未加载完成时显示 LoadingScreen
  if (!pageLoaded) {
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