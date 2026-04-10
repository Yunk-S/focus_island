import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useBackend } from '../hooks/useBackend';
import { useI18n } from '../i18n/I18nContext';
import { buildDicebearAvatarUrl } from '../lib/avatarUrl';
import {
  Palmtree as IslandIcon,
  LogOut,
  Settings,
  ArrowLeft,
  Play,
  Pause,
  StopCircle,
  Camera,
  CameraOff,
  Eye,
  EyeOff,
  Trophy,
  Star,
  Zap,
  Target,
  TrendingUp,
  Crown,
  Flame,
  Timer,
  Shield,
  X,
} from 'lucide-react';

// Mock leaderboard data
const mockLeaderboard = [
  { id: 1, name: 'Emma Wilson', avatar: buildDicebearAvatarUrl('Emma'), points: 1250, streak: 14, isOnline: true },
  { id: 2, name: 'Yunkun', avatar: buildDicebearAvatarUrl('Yunkun'), points: 980, streak: 7, isOnline: true },
  { id: 3, name: 'Sarah Kim', avatar: buildDicebearAvatarUrl('Sarah'), points: 890, streak: 5, isOnline: false },
  { id: 4, name: 'James Lee', avatar: buildDicebearAvatarUrl('James'), points: 720, streak: 3, isOnline: true },
  { id: 5, name: 'Lisa Wang', avatar: buildDicebearAvatarUrl('Lisa'), points: 650, streak: 4, isOnline: false }
];

function AvatarImage({ src, name, className }) {
  const [failed, setFailed] = useState(false);
  const initials = (name || '?').trim().slice(0, 2).toUpperCase() || '?';
  const safe = src && typeof src === 'string' && src.trim() !== '';
  if (!safe || failed) {
    return (
      <div
        className={`${className} flex shrink-0 items-center justify-center bg-gradient-to-br from-accent-mint/35 to-accent-lavender/35 text-[10px] font-semibold tracking-tight text-foreground`}
        aria-hidden
      >
        {initials}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const {
    sessionState,
    isConnected,
    startSession,
    stopSession,
    pauseSession,
    resumeSession,
    sendMessage,
    focusSessionError,
    getApiBaseUrl,
  } = useBackend();
  
  // Local state
  const [isFocusing, setIsFocusing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(true);
  const [cameraAgreed, setCameraAgreed] = useState(false);
  /** 累计专注会话经过的秒数（正计时，非倒计时） */
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const elapsedTimerRef = useRef(null);
  /** 本会话内处于 focused 的秒数（后端 preview 或身份未验证时 focus_time_min 可能恒为 0） */
  const [clientFocusedSecs, setClientFocusedSecs] = useState(0);
  /** 预览流（无正式 session）下的总秒数与 focused 秒数，用于右下角专注率 */
  const [previewElapsedSecs, setPreviewElapsedSecs] = useState(0);
  const [previewFocusedSecs, setPreviewFocusedSecs] = useState(0);
  const currentStateRef = useRef(sessionState.current_state);
  currentStateRef.current = sessionState.current_state;
  /** 上一场结束后的专注率，空闲时右下角仍可读 */
  const [lastSessionFocusRate, setLastSessionFocusRate] = useState(null);
  /** 结束会话后保留的本场快照（避免 stopSession 清空后端状态后三项统计归零） */
  const [lastSessionStats, setLastSessionStats] = useState(null);
  /** 本场开始时的后端累计积分，用于计算本场获得积分 */
  const [sessionPointsBaseline, setSessionPointsBaseline] = useState(0);
  const [distractionSecs, setDistractionSecs] = useState(0);
  const distractionTimerRef = useRef(null);
  const lastDistractionStartRef = useRef(null);
  const [totalPoints, setTotalPoints] = useState(user?.totalPoints || 0);
  /** Backend MJPEG preview (same device as OpenCV — avoids Windows dual-open black screen). */
  const [cameraPreviewUrl, setCameraPreviewUrl] = useState(null);

  const currentState = sessionState?.current_state ?? 'idle';

  // 分心时长：与氛围模式一致，>5s 黄光源、>30s 红光源（仅专注且未暂停时）
  useEffect(() => {
    const clearDistractionTimer = () => {
      if (distractionTimerRef.current) {
        clearInterval(distractionTimerRef.current);
        distractionTimerRef.current = null;
      }
    };
    if (!isFocusing || isPaused) {
      clearDistractionTimer();
      lastDistractionStartRef.current = null;
      setDistractionSecs(0);
      return undefined;
    }
    if (currentState !== 'warning' && currentState !== 'interrupted') {
      clearDistractionTimer();
      lastDistractionStartRef.current = null;
      setDistractionSecs(0);
      return undefined;
    }
    if (!lastDistractionStartRef.current) {
      lastDistractionStartRef.current = Date.now();
    }
    distractionTimerRef.current = setInterval(() => {
      const start = lastDistractionStartRef.current;
      if (!start) return;
      setDistractionSecs(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => {
      clearDistractionTimer();
    };
  }, [isFocusing, isPaused, currentState]);

  const glowLevel =
    distractionSecs >= 30 ? 'critical' : distractionSecs >= 5 ? 'warning' : 'normal';
  
  useEffect(() => {
    if (isFocusing && !isPaused) {
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSecs((s) => s + 1);
        if (currentStateRef.current === 'focused') {
          setClientFocusedSecs((s) => s + 1);
        }
      }, 1000);
    } else if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [isFocusing, isPaused]);

  const previewModeActive =
    !isFocusing &&
    sessionState.preview_mode === true &&
    cameraAgreed &&
    !privacyMode &&
    isConnected;

  useEffect(() => {
    if (!previewModeActive) {
      setPreviewElapsedSecs(0);
      setPreviewFocusedSecs(0);
      return undefined;
    }
    const id = setInterval(() => {
      setPreviewElapsedSecs((s) => s + 1);
      if (currentStateRef.current === 'focused') {
        setPreviewFocusedSecs((s) => s + 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [previewModeActive]);
  
  // Update points from backend
  useEffect(() => {
    if (sessionState.total_points > 0) {
      setTotalPoints(sessionState.total_points);
    }
  }, [sessionState.total_points]);

  useEffect(() => {
    if (focusSessionError) {
      setIsFocusing(false);
      setIsPaused(false);
    }
  }, [focusSessionError]);

  // Ambient / dashboard: Only open backend camera after user consent
  useEffect(() => {
    if (!isConnected) return undefined;
    if (!cameraAgreed) return undefined;
    sendMessage({ type: 'start_camera' });
    return () => {
      sendMessage({ type: 'stop_camera' });
    };
  }, [isConnected, sendMessage, cameraAgreed]);
  
  useEffect(() => {
    if (!cameraEnabled || privacyMode || !isConnected) {
      setCameraPreviewUrl(null);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const base = await getApiBaseUrl();
        if (!cancelled) {
          setCameraPreviewUrl(`${base}/api/video/stream`);
        }
      } catch (e) {
        console.error('Failed to resolve camera preview URL:', e);
        if (!cancelled) setCameraPreviewUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cameraEnabled, privacyMode, isConnected, getApiBaseUrl]);
  
  const handleLogout = () => {
    setCameraPreviewUrl(null);
    logout();
    navigate('/login');
  };
  
  const handleStartFocus = () => {
    setElapsedSecs(0);
    setClientFocusedSecs(0);
    setPreviewElapsedSecs(0);
    setPreviewFocusedSecs(0);
    setLastSessionFocusRate(null);
    setLastSessionStats(null);
    setSessionPointsBaseline(sessionState?.total_points ?? 0);
    setIsFocusing(true);
    setIsPaused(false);
    startSession(user?.id);
  };
  
  const handlePauseFocus = () => {
    setIsPaused(!isPaused);
    if (isPaused) {
      resumeSession();
    } else {
      pauseSession();
    }
  };
  
  const handleStopFocus = () => {
    const elapsedMin = elapsedSecs / 60;
    const backendMin = sessionState?.focus_time ?? 0;
    const effectiveMin = Math.max(backendMin, clientFocusedSecs / 60);
    const rate =
      elapsedMin > 0 ? Math.min(100, Math.round((effectiveMin / elapsedMin) * 1000) / 10) : 0;
    const endPoints = sessionState?.total_points ?? 0;
    const pointsEarned = Math.max(0, endPoints - sessionPointsBaseline);
    setLastSessionFocusRate(rate);
    setLastSessionStats({
      focusedMin: effectiveMin,
      pointsEarned,
      ratePct: rate,
    });
    setClientFocusedSecs(0);
    setIsFocusing(false);
    setIsPaused(false);
    stopSession();
  };
  
  const formatElapsed = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  /** 后端 sessionState.focus_time 为「分钟」 */
  const backendFocusMin = sessionState?.focus_time ?? 0;
  const effectiveFocusMinLive = Math.max(backendFocusMin, clientFocusedSecs / 60);
  const elapsedMinLive = elapsedSecs / 60;
  const focusRateLive =
    isFocusing && elapsedMinLive > 0
      ? Math.min(100, Math.round((effectiveFocusMinLive / elapsedMinLive) * 1000) / 10)
      : 0;
  const previewFocusRate =
    previewModeActive && previewElapsedSecs > 0
      ? Math.min(100, Math.round((previewFocusedSecs / previewElapsedSecs) * 1000) / 10)
      : null;
  const focusRateDisplay = isFocusing
    ? focusRateLive
    : lastSessionFocusRate != null
      ? lastSessionFocusRate
      : previewFocusRate != null
        ? previewFocusRate
        : null;

  /** 本场已获得积分（进行中）；结束后用 lastSessionStats */
  const pointsEarnedLive = Math.max(
    0,
    (sessionState?.total_points ?? 0) - sessionPointsBaseline
  );
  const focusedMinShown = isFocusing
    ? effectiveFocusMinLive
    : lastSessionStats?.focusedMin ?? 0;
  const pointsEarnedShown = isFocusing
    ? pointsEarnedLive
    : lastSessionStats?.pointsEarned ?? 0;
  const focusRateCenterPct = isFocusing
    ? focusRateLive
    : lastSessionStats?.ratePct ?? lastSessionFocusRate ?? null;
  
  const getStateColor = (state) => {
    switch (state) {
      case 'focused': return 'text-accent-mint';
      case 'warning': return 'text-yellow-400';
      case 'interrupted': return 'text-red-400';
      default: return 'text-text-secondary';
    }
  };
  
  /** 圆环进度 = 专注率；结束后保留上一场 */
  const ringProgress = isFocusing
    ? focusRateLive
    : lastSessionStats != null
      ? lastSessionStats.ratePct
      : lastSessionFocusRate ?? 0;

  const progressStroke =
    glowLevel === 'critical'
      ? '#EF4444'
      : glowLevel === 'warning'
        ? '#F59E0B'
        : 'url(#progressGradient)';

  const sessionStateLabel = useCallback(
    (state) => {
      const key =
        {
          focused: 'dashboard.stateFocused',
          warning: 'dashboard.stateWarning',
          interrupted: 'dashboard.stateInterrupted',
        }[state] || 'dashboard.stateIdle';
      return t(key);
    },
    [t]
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-screen flex flex-col overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0a0a0f 0%, #0f0f1a 50%, #0a0a0f 100%)' }}
    >
      {/* Animated background particles */}
      <div className="particles">
        {[...Array(15)].map((_, i) => (
          <div
            key={i}
            className="particle"
            style={{
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 10}s`,
              animationDuration: `${15 + Math.random() * 10}s`,
              background: i % 2 === 0 ? '#7FDBDA' : '#B794F4'
            }}
          />
        ))}
      </div>
      
      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 glass border-b border-white/5">
        <div className="flex items-center gap-3 md:gap-4">
          <button
            type="button"
            onClick={() => navigate('/personal')}
            className="flex items-center gap-1 rounded-xl p-2 glass-hover text-text-secondary transition-colors hover:text-text-primary"
            title={t('common.backHome')}
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="hidden text-sm sm:inline">{t('dashboard.backPersonal')}</span>
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-mint to-accent-lavender flex items-center justify-center">
            <IslandIcon className="w-6 h-6 text-background" />
          </div>
          <div>
            <h1 className="text-xl font-display font-bold gradient-text">{t('login.brand')}</h1>
            <p className="text-xs text-text-muted">{t('dashboard.tagline')}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          {/* Points */}
          <div className="flex items-center gap-2 glass rounded-full px-4 py-2">
            <Star className="w-4 h-4 text-accent-gold" />
            <span className="font-semibold text-accent-gold">{totalPoints}</span>
            <span className="text-text-muted text-sm">{t('dashboard.pts')}</span>
          </div>
          
          {/* Streak */}
          <div className="flex items-center gap-2 glass rounded-full px-4 py-2">
            <Flame className="w-4 h-4 text-orange-400" />
            <span className="font-semibold text-orange-400">{user?.streak || 0}</span>
            <span className="text-text-muted text-sm">{t('dashboard.dayStreak')}</span>
          </div>
          
          {/* User Avatar */}
          <div className="flex items-center gap-3">
            <AvatarImage
              src={user?.avatar}
              name={user?.name}
              className="h-10 w-10 rounded-full border-2 border-accent-mint/50 object-cover"
            />
            <div className="hidden md:block">
              <p className="font-medium text-sm">{user?.name}</p>
              <p className="text-xs text-text-muted">
                {t('dashboard.level')} {user?.level || 1}
              </p>
            </div>
          </div>
          
          {/* Settings */}
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="p-2 rounded-xl glass-hover transition-colors"
            title={t('settings.title')}
          >
            <Settings className="w-5 h-5 text-text-secondary" />
          </button>
          
          {/* Logout */}
          <button
            onClick={handleLogout}
            className="p-2 rounded-xl glass-hover transition-colors text-red-400"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="relative z-10 flex-1 flex gap-6 p-6 overflow-hidden">
        {/* Left Column - Camera */}
        <motion.div
          initial={{ x: -50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="w-80 flex flex-col gap-4"
        >
          {/* Camera Feed */}
          <div className="glass rounded-3xl p-4 flex-1 relative overflow-hidden">
            {/* Camera Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-accent-mint animate-pulse' : 'bg-red-400'}`} />
                <span className="text-sm font-medium">{t('dashboard.cameraFeed')}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (privacyMode) {
                    setCameraAgreed(true);
                    setCameraEnabled(true);
                    setPrivacyMode(false);
                  } else {
                    setPrivacyMode(true);
                  }
                }}
                className="p-2 rounded-lg glass-hover transition-colors"
              >
                {privacyMode ? (
                  <EyeOff className="w-4 h-4 text-text-secondary" />
                ) : (
                  <Eye className="w-4 h-4 text-text-secondary" />
                )}
              </button>
            </div>
            
            {/* Video/Privacy View — MJPEG from backend (OpenCV already holds the camera). */}
            <div className="relative aspect-video rounded-2xl overflow-hidden bg-black/50">
              {cameraEnabled && !privacyMode ? (
                cameraPreviewUrl ? (
                  <img
                    key={cameraPreviewUrl}
                    src={cameraPreviewUrl}
                    alt=""
                    className="absolute inset-0 z-0 h-full w-full object-cover [transform:scaleX(-1)]"
                  />
                ) : (
                  <div className="absolute inset-0 z-0 flex flex-col items-center justify-center gap-2">
                    <div className="size-8 animate-spin rounded-full border-2 border-accent-mint/30 border-t-accent-mint" />
                    <span className="text-text-muted text-xs">{t('dashboard.previewLoading')}</span>
                  </div>
                )
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <CameraOff className="w-12 h-12 text-text-muted mb-2" />
                  <span className="text-text-muted text-sm">
                    {privacyMode ? t('dashboard.privacyMode') : t('dashboard.cameraOff')}
                  </span>
                </div>
              )}

              {/* Face Detection Overlay */}
              {cameraEnabled && !privacyMode && sessionState.has_face && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                  <div className="h-40 w-32 rounded-lg border-2 border-accent-mint/50 animate-pulse" />
                </div>
              )}
            </div>
            
            {/* Camera Stats */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="glass rounded-xl p-3">
                <p className="text-text-muted text-xs mb-1">{t('dashboard.status')}</p>
                <p className={`font-semibold ${getStateColor(sessionState.current_state)}`}>
                  {sessionStateLabel(sessionState.current_state)}
                </p>
              </div>
              <div className="glass rounded-xl p-3">
                <p className="text-text-muted text-xs mb-1">{t('dashboard.identity')}</p>
                <p className={`font-semibold ${sessionState.identity?.verified ? 'text-accent-mint' : 'text-yellow-400'}`}>
                  {sessionState.identity?.verified ? t('dashboard.verified') : t('dashboard.pending')}
                </p>
              </div>
            </div>
            
            {/* Camera Toggle */}
            <button
              type="button"
              onClick={() => {
                const on = !cameraEnabled;
                setCameraEnabled(on);
                if (on) {
                  setCameraAgreed(true);
                  setPrivacyMode(false);
                }
              }}
              className="mt-4 w-full py-3 rounded-xl glass-hover flex items-center justify-center gap-2 transition-colors"
            >
              {cameraEnabled ? (
                <>
                  <CameraOff className="w-4 h-4" />
                  <span className="text-sm">{t('dashboard.disableCam')}</span>
                </>
              ) : (
                <>
                  <Camera className="w-4 h-4" />
                  <span className="text-sm">{t('dashboard.enableCam')}</span>
                </>
              )}
            </button>
          </div>
        </motion.div>
        
        {/* Center Column - Timer */}
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex-1 flex flex-col items-center justify-center"
        >
          <div className="text-center mb-8">
            <h2 className="text-2xl font-display font-bold mb-2">{t('dashboard.focusTimer')}</h2>
            <p className="text-text-secondary">{t('dashboard.stayFocused')}</p>
          </div>
          
          {/* Timer Circle — 计时盘即光源：分心时黄/红模糊光晕照向背景 */}
          <div className="relative mb-8 flex items-center justify-center">
            <AnimatePresence>
              {glowLevel === 'warning' && (
                <motion.div
                  key="warn-glow"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="pointer-events-none absolute rounded-full"
                  style={{
                    width: 420,
                    height: 420,
                    background:
                      'radial-gradient(circle, rgba(234,179,8,0.45) 0%, rgba(234,179,8,0.15) 45%, transparent 72%)',
                    filter: 'blur(28px)',
                  }}
                />
              )}
              {glowLevel === 'critical' && (
                <motion.div
                  key="crit-glow"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="pointer-events-none absolute rounded-full"
                  style={{
                    width: 480,
                    height: 480,
                    background:
                      'radial-gradient(circle, rgba(239,68,68,0.5) 0%, rgba(239,68,68,0.2) 40%, transparent 70%)',
                    filter: 'blur(36px)',
                  }}
                />
              )}
            </AnimatePresence>
            {/* 大面积背景染色（光照射在背景上） */}
            <AnimatePresence>
              {glowLevel === 'warning' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="pointer-events-none fixed left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    width: '120vmin',
                    height: '120vmin',
                    background:
                      'radial-gradient(circle, rgba(234,179,8,0.12) 0%, rgba(234,179,8,0.04) 35%, transparent 65%)',
                    filter: 'blur(64px)',
                  }}
                />
              )}
              {glowLevel === 'critical' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="pointer-events-none fixed left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    width: '140vmin',
                    height: '140vmin',
                    background:
                      'radial-gradient(circle, rgba(239,68,68,0.16) 0%, rgba(239,68,68,0.06) 30%, transparent 58%)',
                    filter: 'blur(72px)',
                  }}
                />
              )}
            </AnimatePresence>

            {/* Progress Ring */}
            <svg className="relative z-10 h-72 w-72 progress-ring" style={{ filter: glowLevel !== 'normal' ? 'drop-shadow(0 0 14px rgba(255,200,80,0.35))' : undefined }}>
              {/* Background circle */}
              <circle
                cx="144"
                cy="144"
                r="130"
                fill="none"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="8"
              />
              {/* Progress circle */}
              <motion.circle
                cx="144"
                cy="144"
                r="130"
                fill="none"
                stroke={progressStroke}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 130}`}
                animate={{ strokeDashoffset: `${2 * Math.PI * 130 * (1 - ringProgress / 100)}` }}
                transition={{ duration: 0.5 }}
                style={
                  glowLevel === 'critical'
                    ? { filter: 'drop-shadow(0 0 10px rgba(239,68,68,0.75))' }
                    : glowLevel === 'warning'
                      ? { filter: 'drop-shadow(0 0 10px rgba(245,158,11,0.75))' }
                      : undefined
                }
              />
              <defs>
                <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#7FDBDA" />
                  <stop offset="100%" stopColor="#B794F4" />
                </linearGradient>
              </defs>
            </svg>
            
            {/* Timer Display */}
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
              <motion.div
                animate={isFocusing && !isPaused ? { scale: [1, 1.02, 1] } : {}}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <span className="text-6xl font-display font-bold tracking-wider">
                  {formatElapsed(elapsedSecs)}
                </span>
              </motion.div>
              <p className="text-text-muted mt-2">
                {isFocusing
                  ? isPaused
                    ? t('dashboard.paused')
                    : t('dashboard.focusing')
                  : t('dashboard.ready')}
              </p>
            </div>
          </div>
          
          {/* Focus Stats — 进行中实时；结束后显示本场快照 */}
          <div className="relative z-10 flex items-center gap-8 mb-8">
            <div className="text-center">
              <p className="text-2xl font-bold text-accent-mint">
                {isFocusing || lastSessionStats != null ? focusedMinShown.toFixed(1) : '—'}
              </p>
              <p className="text-xs text-text-muted">{t('dashboard.sessionFocusMinutes')}</p>
            </div>
            <div className="w-px h-10 bg-white/10" />
            <div className="text-center">
              <p className="text-2xl font-bold text-accent-lavender">
                {isFocusing || lastSessionStats != null ? Math.round(pointsEarnedShown) : '—'}
              </p>
              <p className="text-xs text-text-muted">{t('dashboard.pointsEarned')}</p>
            </div>
            <div className="w-px h-10 bg-white/10" />
            <div className="text-center">
              <p className="text-2xl font-bold text-accent-gold">
                {focusRateCenterPct != null ? `${focusRateCenterPct.toFixed(1)}%` : '—'}
              </p>
              <p className="text-xs text-text-muted">{t('dashboard.focusRate')}</p>
            </div>
          </div>

          {focusSessionError && (
            <p className="mb-4 max-w-md text-center text-sm text-red-400">
              {focusSessionError}
            </p>
          )}
          
          {/* Control Buttons */}
          <div className="flex items-center gap-4">
            {!isFocusing ? (
              <motion.button
                onClick={handleStartFocus}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-accent-mint to-accent-lavender text-background font-semibold flex items-center gap-3 shadow-lg hover:shadow-xl transition-shadow"
                style={{ boxShadow: '0 0 40px rgba(127, 219, 218, 0.4)' }}
              >
                <Play className="w-6 h-6" fill="currentColor" />
                {t('dashboard.startFocus')}
              </motion.button>
            ) : (
              <>
                <motion.button
                  onClick={handlePauseFocus}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="p-4 rounded-full glass-hover transition-colors"
                >
                  {isPaused ? (
                    <Play className="w-6 h-6 text-accent-mint" fill="currentColor" />
                  ) : (
                    <Pause className="w-6 h-6 text-yellow-400" />
                  )}
                </motion.button>
                <motion.button
                  onClick={handleStopFocus}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="px-8 py-4 rounded-2xl bg-gradient-to-r from-red-500 to-red-600 text-white font-semibold flex items-center gap-3 shadow-lg hover:shadow-xl transition-shadow"
                >
                  <StopCircle className="w-6 h-6" />
                  {t('dashboard.endSession')}
                </motion.button>
              </>
            )}
          </div>
          
          {!isFocusing && (
            <p className="mt-6 max-w-sm text-center text-xs text-text-muted">
              {t('dashboard.cumulativeHint')}
            </p>
          )}
        </motion.div>
        
        {/* Right Column - Leaderboard */}
        <motion.div
          initial={{ x: 50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="w-72 flex flex-col gap-4"
        >
          {/* Leaderboard Card */}
          <div className="glass rounded-3xl p-5 flex-1">
            <div className="flex items-center gap-3 mb-4">
              <Trophy className="w-5 h-5 text-accent-gold" />
              <h3 className="font-semibold">{t('dashboard.leaderboard')}</h3>
              <span className="ml-auto flex items-center gap-1 text-xs text-accent-mint">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-mint animate-pulse" />
                {t('dashboard.online')}
              </span>
            </div>
            
            <div className="space-y-3">
              {mockLeaderboard.map((player, index) => (
                <motion.div
                  key={player.id}
                  initial={{ x: 20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.4 + index * 0.1 }}
                  className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${
                    player.name === user?.name 
                      ? 'bg-accent-mint/10 border border-accent-mint/30' 
                      : 'glass-hover'
                  }`}
                >
                  {/* Rank */}
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    index === 0 ? 'bg-accent-gold/20 text-accent-gold' :
                    index === 1 ? 'bg-gray-400/20 text-gray-400' :
                    index === 2 ? 'bg-orange-400/20 text-orange-400' :
                    'bg-white/5 text-text-muted'
                  }`}>
                    {index + 1}
                  </div>
                  
                  {/* Avatar */}
                  <AvatarImage
                    src={player.avatar}
                    name={player.name}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                  
                  {/* Name & Streak */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {player.name}
                      {player.name === user?.name && <span className="text-accent-mint ml-1">{t('dashboard.you')}</span>}
                    </p>
                    <div className="flex items-center gap-1">
                      <Flame className="w-3 h-3 text-orange-400" />
                      <span className="text-xs text-text-muted">
                        {player.streak} {t('dashboard.days')}
                      </span>
                    </div>
                  </div>
                  
                  {/* Points */}
                  <div className="text-right">
                    <p className="text-sm font-semibold text-accent-gold">{player.points}</p>
                    <p className="text-xs text-text-muted">{t('dashboard.pts')}</p>
                  </div>
                  
                  {/* Online indicator */}
                  <div className={`w-2 h-2 rounded-full ${player.isOnline ? 'bg-accent-mint' : 'bg-text-muted/30'}`} />
                </motion.div>
              ))}
            </div>
          </div>
          
          {/* Quick Stats */}
          <div className="glass rounded-3xl p-5">
            <h3 className="font-semibold mb-4">{t('dashboard.yourStats')}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="glass rounded-xl p-3 text-center">
                <Target className="w-5 h-5 mx-auto mb-2 text-accent-coral" />
                <p className="text-lg font-bold">{user?.totalPoints || 0}</p>
                <p className="text-xs text-text-muted">{t('dashboard.totalPoints')}</p>
              </div>
              <div className="glass rounded-xl p-3 text-center">
                <TrendingUp className="w-5 h-5 mx-auto mb-2 text-accent-lavender" />
                <p className="text-lg font-bold">#{Math.floor(Math.random() * 10) + 1}</p>
                <p className="text-xs text-text-muted">{t('dashboard.rank')}</p>
              </div>
              <div className="glass rounded-xl p-3 text-center">
                <Zap className="w-5 h-5 mx-auto mb-2 text-accent-mint" />
                <p className="text-lg font-bold">{user?.streak || 0}</p>
                <p className="text-xs text-text-muted">{t('dashboard.dayStreak')}</p>
              </div>
              <div className="glass rounded-xl p-3 text-center">
                <Shield className="w-5 h-5 mx-auto mb-2 text-accent-gold" />
                <p
                  className={`text-lg font-bold ${
                    focusRateDisplay == null
                      ? 'text-text-muted'
                      : focusRateDisplay >= 80
                        ? 'text-accent-mint'
                        : focusRateDisplay >= 50
                          ? 'text-yellow-400'
                          : 'text-red-400'
                  }`}
                >
                  {focusRateDisplay != null ? `${focusRateDisplay.toFixed(1)}%` : '—'}
                </p>
                <p className="text-xs text-text-muted">{t('dashboard.focusRate')}</p>
              </div>
            </div>
          </div>
        </motion.div>
      </main>

      {!cameraAgreed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-sm mx-4 rounded-2xl border border-white/20 bg-white/10 p-8 shadow-2xl backdrop-blur-xl">
            <button
              type="button"
              onClick={() => {
                setCameraAgreed(true);
                setPrivacyMode(true);
              }}
              className="absolute right-4 top-4 text-white/50 hover:text-white"
            >
              <X className="size-5" />
            </button>
            <div className="flex size-14 mx-auto mb-5 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/80 to-pink-500/80">
              <Camera className="size-7 text-white" />
            </div>
            <h2 className="mb-3 text-center text-xl font-semibold text-white">
              {t('dashboard.enableCam')}
            </h2>
            <p className="mb-7 text-center text-sm leading-relaxed text-white/70">
              {t('dashboard.cameraHint')}
            </p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setCameraAgreed(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-pink-500 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-opacity hover:opacity-90"
              >
                {t('dashboard.allowCamera')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCameraAgreed(true);
                  setPrivacyMode(true);
                }}
                className="w-full rounded-xl border border-white/20 py-3 text-center text-sm text-white/60 transition-colors hover:border-white/40 hover:text-white/80"
              >
                {t('dashboard.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default Dashboard;
