import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useBackend } from '../hooks/useBackend';
import { useI18n } from '../i18n/I18nContext';
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
  { id: 1, name: 'Emma Wilson', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Emma', points: 1250, streak: 14, isOnline: true },
  { id: 2, name: 'Alex Chen', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex', points: 980, streak: 7, isOnline: true },
  { id: 3, name: 'Sarah Kim', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah', points: 890, streak: 5, isOnline: false },
  { id: 4, name: 'James Lee', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=James', points: 720, streak: 3, isOnline: true },
  { id: 5, name: 'Lisa Wang', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Lisa', points: 650, streak: 4, isOnline: false }
];

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
  } = useBackend();
  
  // Local state
  const [isFocusing, setIsFocusing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(true);
  const [cameraAgreed, setCameraAgreed] = useState(false);
  const [currentTime, setCurrentTime] = useState(25 * 60); // 25 minutes in seconds
  const [focusDuration, setFocusDuration] = useState(25);
  const [totalPoints, setTotalPoints] = useState(user?.totalPoints || 0);
  
  // Camera ref
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  // Timer effect
  useEffect(() => {
    let interval;
    if (isFocusing && !isPaused && currentTime > 0) {
      interval = setInterval(() => {
        setCurrentTime(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isFocusing, isPaused, currentTime]);
  
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

  // Ambient / dashboard：只有用户同意后才打开后端摄像头
  useEffect(() => {
    if (!isConnected) return undefined;
    if (!cameraAgreed) return undefined;
    sendMessage({ type: 'start_camera' });
    return () => {
      sendMessage({ type: 'stop_camera' });
    };
  }, [isConnected, sendMessage, cameraAgreed]);
  
  // Initialize camera
  useEffect(() => {
    if (cameraEnabled && !privacyMode) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [cameraEnabled, privacyMode]);
  
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 640, height: 480, facingMode: 'user' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Failed to start camera:', err);
    }
  };
  
  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };
  
  const handleLogout = () => {
    stopCamera();
    logout();
    navigate('/login');
  };
  
  const handleStartFocus = () => {
    setIsFocusing(true);
    setIsPaused(false);
    setCurrentTime(focusDuration * 60);
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
    setIsFocusing(false);
    setIsPaused(false);
    stopSession();
  };
  
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  
  const getStateColor = (state) => {
    switch (state) {
      case 'focused': return 'text-accent-mint';
      case 'warning': return 'text-yellow-400';
      case 'interrupted': return 'text-red-400';
      default: return 'text-text-secondary';
    }
  };
  
  const getStateGlow = (state) => {
    switch (state) {
      case 'focused': return 'shadow-glow-mint';
      case 'warning': return 'shadow-[0_0_30px_rgba(234,179,8,0.4)]';
      case 'interrupted': return 'shadow-[0_0_30px_rgba(248,113,113,0.4)]';
      default: return '';
    }
  };
  
  const progress = ((focusDuration * 60 - currentTime) / (focusDuration * 60)) * 100;

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
            <img
              src={user?.avatar}
              alt={user?.name}
              className="w-10 h-10 rounded-full border-2 border-accent-mint/50"
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
                onClick={() => setPrivacyMode(!privacyMode)}
                className="p-2 rounded-lg glass-hover transition-colors"
              >
                {privacyMode ? (
                  <EyeOff className="w-4 h-4 text-text-secondary" />
                ) : (
                  <Eye className="w-4 h-4 text-text-secondary" />
                )}
              </button>
            </div>
            
            {/* Video/Privacy View */}
            <div className="relative aspect-video rounded-2xl overflow-hidden bg-black/50">
              {cameraEnabled && !privacyMode ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover transform -scale-x-100"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <CameraOff className="w-12 h-12 text-text-muted mb-2" />
                  <span className="text-text-muted text-sm">
                    {privacyMode ? t('dashboard.privacyMode') : t('dashboard.cameraOff')}
                  </span>
                </div>
              )}
              
              {/* Face Detection Overlay */}
              {sessionState.has_face && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-32 h-40 border-2 border-accent-mint/50 rounded-lg animate-pulse" />
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
              onClick={() => setCameraEnabled(!cameraEnabled)}
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
          
          {/* Timer Circle */}
          <div className="relative mb-8">
            {/* Progress Ring */}
            <svg className="w-72 h-72 progress-ring">
              {/* Background circle */}
              <circle
                cx="144"
                cy="144"
                r="130"
                fill="none"
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="8"
              />
              {/* Progress circle */}
              <motion.circle
                cx="144"
                cy="144"
                r="130"
                fill="none"
                stroke="url(#progressGradient)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 130}`}
                animate={{ strokeDashoffset: `${2 * Math.PI * 130 * (1 - progress / 100)}` }}
                transition={{ duration: 0.5 }}
              />
              {/* Glow effect */}
              <defs>
                <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#7FDBDA" />
                  <stop offset="100%" stopColor="#B794F4" />
                </linearGradient>
              </defs>
            </svg>
            
            {/* Timer Display */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <motion.div
                animate={isFocusing && !isPaused ? { scale: [1, 1.02, 1] } : {}}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <span className="text-6xl font-display font-bold tracking-wider">
                  {formatTime(currentTime)}
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
          
          {/* Focus Stats */}
          <div className="flex items-center gap-8 mb-8">
            <div className="text-center">
              <p className="text-2xl font-bold text-accent-mint">{Math.floor(sessionState.focus_time / 60)}</p>
              <p className="text-xs text-text-muted">{t('dashboard.minToday')}</p>
            </div>
            <div className="w-px h-10 bg-white/10" />
            <div className="text-center">
              <p className="text-2xl font-bold text-accent-lavender">{Math.floor(sessionState.focus_time / 60) * 10}</p>
              <p className="text-xs text-text-muted">{t('dashboard.pointsEarned')}</p>
            </div>
            <div className="w-px h-10 bg-white/10" />
            <div className="text-center">
              <p className="text-2xl font-bold text-accent-gold">0</p>
              <p className="text-xs text-text-muted">{t('dashboard.milestones')}</p>
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
          
          {/* Duration Selector */}
          {!isFocusing && (
            <div className="mt-6 flex items-center gap-4">
              <span className="text-text-muted text-sm">{t('dashboard.duration')}</span>
              {[25, 45, 60].map(duration => (
                <button
                  key={duration}
                  onClick={() => setFocusDuration(duration)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                    focusDuration === duration
                      ? 'bg-accent-mint/20 text-accent-mint border border-accent-mint/50'
                      : 'glass text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {duration} {t('dashboard.min')}
                </button>
              ))}
            </div>
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
                  <img
                    src={player.avatar}
                    alt={player.name}
                    className="w-8 h-8 rounded-full"
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
                <p className="text-lg font-bold">98%</p>
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
              onClick={() => setCameraAgreed(false)}
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
                onClick={() => setCameraAgreed(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-pink-500 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-opacity hover:opacity-90"
              >
                {t('dashboard.allowCamera')}
              </button>
              <button
                onClick={() => setCameraAgreed(false)}
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
