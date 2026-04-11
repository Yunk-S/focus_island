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
 * 简化版 AppContent - 解决 Vite 热重载黑屏问题
 * 
 * 问题根因:
 * 1. useState 初始化函数只在首次挂载时执行，热重载后状态重置
 * 2. 导出的 AppContext 导致热更新失败 (HMR invalidate)
 * 
 * 解决方案:
 * 1. 使用 sessionStorage 直接读取 + state 更新模式
 * 2. 移除 AppContext 导出，避免 HMR 冲突
 */

// 持久化标记：在整个页面生命周期内只显示一次 LoadingScreen
const INITIAL_LOAD_KEY = 'focus_island_initialized';

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  
  // 从 sessionStorage 读取初始状态（热重载后仍然保留）
  const [initialized, setInitialized] = useState(() => {
    return sessionStorage.getItem(INITIAL_LOAD_KEY) === 'true';
  });

  // 初始化延迟 - 只在未初始化时执行
  useEffect(() => {
    if (initialized) return;  // 已初始化则跳过
    
    const timer = setTimeout(() => {
      sessionStorage.setItem(INITIAL_LOAD_KEY, 'true');
      setInitialized(true);
    }, 2000);  // 2秒足够后端连接
    
    return () => clearTimeout(timer);
  }, [initialized]);

  // 路由重定向逻辑
  useEffect(() => {
    if (!initialized || authLoading) return;

    const path = location.pathname;

    // 已登录用户停留在注册/忘记密码页
    if (isAuthenticated && (path === '/register' || path === '/forgot-password')) {
      return;
    }

    // 未登录用户重定向到登录页
    if (!isAuthenticated) {
      if (path !== '/login' && path !== '/register' && path !== '/forgot-password') {
        navigate('/login', { replace: true });
      }
      return;
    }

    // 已登录用户从登录页重定向到个人页
    if (path === '/login') {
      navigate('/personal', { replace: true });
    }
  }, [initialized, authLoading, isAuthenticated, location.pathname, navigate]);

  // 未初始化时显示加载画面
  if (!initialized) {
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

/** 应用入口重定向 - 根据认证状态跳转 */
function RootRedirect() {
  const { isAuthenticated } = useAuth();
  return <Navigate to={isAuthenticated ? '/personal' : '/login'} replace />;
}

/** 主应用入口 - 包含 Context Providers */
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