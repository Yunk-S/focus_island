import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { useBackend } from '../hooks/useBackend';
import { useI18n } from '../i18n/I18nContext';
import {
  ArrowLeft,
  Play,
  Pause,
  Camera,
  CameraOff,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Clock,
  Zap,
  RefreshCw,
} from 'lucide-react';

const FOCUS_STATES = {
  IDLE: 'idle',      // 未开始
  FOCUSING: 'focusing', // 专注中
  PAUSED: 'paused',   // 暂停
  ENDED: 'ended',    // 已手动结束（无倒计时，按需停止）
};

function AmbientModePage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user, updatePoints } = useAuth();
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

  // ─── Focus session state ─────────────────────────────────────────────────────
  const [focusState, setFocusState] = useState(FOCUS_STATES.IDLE);
  /** 累计计时秒数（本地计时器） */
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const elapsedTimerRef = useRef(null);

  // ─── Aggregated stats ────────────────────────────────────────────────────────
  const [todayFocusTime, setTodayFocusTime] = useState(0); // minutes (backend)
  const [totalPoints, setTotalPoints] = useState(user?.totalPoints || 0);
  const [sessionCount, setSessionCount] = useState(0);

  // ─── Camera / privacy ────────────────────────────────────────────────────────
  const [privacyMode, setPrivacyMode] = useState(true);
  const [cameraError, setCameraError] = useState(null);
  /** Backend MJPEG 预览 URL（单一摄像头，避免 Windows dual-open 黑屏） */
  const [cameraPreviewUrl, setCameraPreviewUrl] = useState(null);

  // ─── Permission modal ────────────────────────────────────────────────────────
  const [showPermissionModal, setShowPermissionModal] = useState(false);

  // ─── Backend session data ────────────────────────────────────────────────────
  const backendFocusMin = sessionState?.focus_time ?? 0; // 分钟（后端累计）
  const backendTotalPts = sessionState?.total_points ?? 0;
  const currentState = sessionState?.current_state ?? 'idle';
  const hasFace = sessionState?.has_face ?? false;

  /**
   * 专注率 = 后端已记录的专注分钟数 / 总经过分钟数。
   * 乘 100 转为百分比，保留 1 位小数。
   */
  const elapsedMin = elapsedSecs / 60;
  const focusRatePct = elapsedMin > 0
    ? Math.min(100, Math.round((backendFocusMin / elapsedMin) * 1000) / 10)
    : 0;

  // ─── Elapsed timer ───────────────────────────────────────────────────────────
  const clearElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (focusState === FOCUS_STATES.FOCUSING) {
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSecs((s) => s + 1);
      }, 1000);
    } else {
      clearElapsedTimer();
    }
    return () => clearElapsedTimer();
  }, [focusState, clearElapsedTimer]);

  useEffect(() => {
    if (focusSessionError) setFocusState(FOCUS_STATES.IDLE);
  }, [focusSessionError]);

  // ─── Camera: backend MJPEG ──────────────────────────────────────────────────
  useEffect(() => {
    if (privacyMode || !isConnected) {
      setCameraPreviewUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const base = await getApiBaseUrl();
        if (!cancelled) setCameraPreviewUrl(`${base}/api/video/stream`);
      } catch {
        if (!cancelled) setCameraPreviewUrl(null);
      }
    })();
    return () => { cancelled = true; };
  }, [privacyMode, isConnected, getApiBaseUrl]);

  // ─── Privacy toggle ──────────────────────────────────────────────────────────
  const handlePrivacyToggle = useCallback(() => {
    if (privacyMode) {
      // 尝试开启摄像头
      if (isConnected) {
        sendMessage({ type: 'start_camera' });
      }
      setPrivacyMode(false);
    } else {
      // 关闭摄像头
      if (isConnected) {
        sendMessage({ type: 'stop_camera' });
      }
      setPrivacyMode(true);
    }
  }, [privacyMode, isConnected, sendMessage]);

  // ─── Focus session ───────────────────────────────────────────────────────────
  const handleStartFocus = () => {
    if (!privacyMode && !sessionState) {
      setShowPermissionModal(true);
      return;
    }
    setElapsedSecs(0);
    setFocusState(FOCUS_STATES.FOCUSING);
    if (user?.id) startSession(user.id);
  };

  const handlePauseFocus = () => {
    setFocusState(FOCUS_STATES.PAUSED);
    pauseSession();
  };

  const handleResumeFocus = () => {
    setFocusState(FOCUS_STATES.FOCUSING);
    resumeSession();
  };

  const handleStopFocus = () => {
    clearElapsedTimer();
    setFocusState(FOCUS_STATES.ENDED);
    stopSession();

    const earned = backendTotalPts - (user?.totalPoints || 0);
    if (earned > 0 && updatePoints) updatePoints(earned);
    setSessionCount((n) => n + 1);
    setTodayFocusTime((m) => m + Math.floor(elapsedSecs / 60));
  };

  const handleReset = () => {
    setElapsedSecs(0);
    setFocusState(FOCUS_STATES.IDLE);
  };

  // ─── Permission granted ──────────────────────────────────────────────────────
  const handleGrantPermission = () => {
    setShowPermissionModal(false);
    setPrivacyMode(false);
    if (isConnected) sendMessage({ type: 'start_camera' });
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const fmtElapsed = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };

  const focusStateLabel = () => {
    if (currentState === 'focused') return t('dashboard.stateFocused');
    if (currentState === 'warning') return t('dashboard.stateWarning');
    if (currentState === 'interrupted') return t('dashboard.stateInterrupted');
    return t('dashboard.stateIdle');
  };

  const focusRateColor = () => {
    if (focusRatePct >= 80) return 'text-green-400';
    if (focusRatePct >= 50) return 'text-yellow-400';
    return 'text-red-400';
  };

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 flex flex-col bg-background overflow-hidden">

      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute rounded-full blur-3xl animate-pulse"
          style={{
            width: 600, height: 600,
            top: '10%', left: '20%',
            background: 'radial-gradient(circle, rgba(108,63,245,0.15) 0%, transparent 70%)',
            animationDuration: '6s',
          }}
        />
        <div
          className="absolute rounded-full blur-3xl animate-pulse"
          style={{
            width: 500, height: 500,
            bottom: '10%', right: '15%',
            background: 'radial-gradient(circle, rgba(219,127,127,0.12) 0%, transparent 70%)',
            animationDuration: '8s', animationDelay: '2s',
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(hsl(0 0% 100% / 0.05) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100% / 0.05) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-8 py-5">
        <button
          onClick={() => navigate('/personal')}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
        >
          <ArrowLeft className="size-4" />
          <span>{t('dashboard.backPersonal')}</span>
        </button>

        {/* Live stats */}
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Zap className="size-4 text-primary" />
            <span className="font-medium text-foreground">{totalPoints + backendTotalPts}</span>
            <span className="hidden sm:inline">{t('dashboard.points')}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="size-4 text-primary" />
            <span className="font-medium text-foreground">{todayFocusTime + Math.floor(backendFocusMin)}</span>
            <span className="hidden sm:inline">{t('dashboard.min')}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <CheckCircle2 className="size-4 text-primary" />
            <span className="font-medium text-foreground">{sessionCount}</span>
            <span className="hidden sm:inline">{t('dashboard.sessions')}</span>
          </div>
        </div>

        {/* Privacy toggle */}
        <button
          onClick={handlePrivacyToggle}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
        >
          {privacyMode ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          <span>{privacyMode ? t('dashboard.privacyMode') : t('dashboard.cameraMode')}</span>
        </button>
      </header>

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-8">

        {/* Status label */}
        <div
          className={`mb-6 flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium ${
            focusState === FOCUS_STATES.FOCUSING
              ? hasFace ? 'bg-green-500/15 text-green-400' : 'bg-yellow-500/15 text-yellow-400'
              : focusState === FOCUS_STATES.PAUSED
              ? 'bg-muted text-muted-foreground'
              : focusState === FOCUS_STATES.ENDED
              ? 'bg-primary/15 text-primary'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          <div
            className={`size-1.5 rounded-full ${
              focusState === FOCUS_STATES.FOCUSING
                ? hasFace ? 'bg-green-400 animate-pulse' : 'bg-yellow-400 animate-pulse'
                : 'bg-current'
            }`}
          />
          {focusState === FOCUS_STATES.FOCUSING && (hasFace ? t('dashboard.stateFocused') : t('dashboard.noFace'))}
          {focusState === FOCUS_STATES.PAUSED && t('dashboard.paused')}
          {focusState === FOCUS_STATES.ENDED && t('ambient.sessionEnded')}
          {focusState === FOCUS_STATES.IDLE && t('ambient.readyToFocus')}
        </div>

        {/* ── Central display (timer + focus rate) ─────────────────────────────── */}
        <div className="mb-10 flex flex-col items-center gap-6">

          {/* Elapsed / Total time */}
          <div
            className={`font-mono text-7xl font-bold tracking-tight transition-colors ${
              focusState === FOCUS_STATES.FOCUSING
                ? hasFace ? 'text-foreground' : 'text-yellow-400'
                : focusState === FOCUS_STATES.ENDED
                ? 'text-primary'
                : 'text-foreground'
            }`}
          >
            {fmtElapsed(elapsedSecs)}
          </div>

          {/* Focus rate ring */}
          <div className="relative flex items-center justify-center">
            <div className="relative size-48">
              <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 192 192">
                <circle cx="96" cy="96" r="88" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="5" />
                <circle
                  cx="96" cy="96" r="88"
                  fill="none"
                  stroke="url(#ambientGradient)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 88}
                  strokeDashoffset={2 * Math.PI * 88 * (1 - focusRatePct / 100)}
                  style={{ transition: 'stroke-dashoffset 1.5s ease' }}
                />
                <defs>
                  <linearGradient id="ambientGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#6C3FF5" />
                    <stop offset="100%" stopColor="#B794F4" />
                  </linearGradient>
                </defs>
              </svg>

              {/* Center: focus rate % */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-4xl font-bold ${focusRateColor()}`}>
                  {focusRatePct.toFixed(1)}
                </span>
                <span className="text-xs text-muted-foreground">{t('ambient.focusRate')}</span>
              </div>
            </div>
          </div>

          {/* Detail row */}
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <span>
              {t('ambient.focused')}: <span className="font-medium text-foreground">{Math.floor(backendFocusMin)}</span> {t('dashboard.min')}
            </span>
            <span>
              {t('ambient.totalElapsed')}: <span className="font-medium text-foreground">{fmtElapsed(elapsedSecs)}</span>
            </span>
          </div>
        </div>

        {/* Error */}
        {focusSessionError && (
          <p className="mb-4 max-w-md text-center text-sm text-red-400">{focusSessionError}</p>
        )}

        {/* ── Control buttons ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-4">
          {focusState === FOCUS_STATES.IDLE && (
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={handleStartFocus}
              className="flex items-center gap-3 rounded-full bg-primary px-10 py-5 text-base font-semibold text-primary-foreground shadow-xl shadow-primary/30 transition-all hover:scale-105 hover:shadow-2xl hover:shadow-primary/40 active:scale-95"
            >
              <Play className="size-5 fill-current" />
              {t('dashboard.startFocus')}
            </motion.button>
          )}

          {focusState === FOCUS_STATES.FOCUSING && (
            <>
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={handlePauseFocus}
                className="flex items-center gap-2 rounded-full bg-muted/80 px-6 py-3 text-sm font-medium text-foreground backdrop-blur-sm transition-all hover:bg-muted"
              >
                <Pause className="size-4 fill-current" />
                {t('dashboard.pause')}
              </motion.button>
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={handleStopFocus}
                className="flex items-center gap-2 rounded-full bg-red-500/20 px-6 py-3 text-sm font-medium text-red-400 transition-all hover:bg-red-500/30"
              >
                <AlertCircle className="size-4" />
                {t('dashboard.end')}
              </motion.button>
            </>
          )}

          {focusState === FOCUS_STATES.PAUSED && (
            <>
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={handleResumeFocus}
                className="flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:scale-105 active:scale-95"
              >
                <Play className="size-4 fill-current" />
                {t('dashboard.resume')}
              </motion.button>
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={handleStopFocus}
                className="flex items-center gap-2 rounded-full bg-red-500/20 px-6 py-3 text-sm font-medium text-red-400 transition-all hover:bg-red-500/30"
              >
                <AlertCircle className="size-4" />
                {t('dashboard.end')}
              </motion.button>
            </>
          )}

          {focusState === FOCUS_STATES.ENDED && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center gap-4"
            >
              {/* Summary */}
              <div className="flex flex-col items-center gap-1 rounded-2xl border border-primary/30 bg-primary/10 px-8 py-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="size-4" />
                  <span>{t('ambient.sessionEnded')}</span>
                </div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="text-3xl font-bold text-foreground">{fmtElapsed(elapsedSecs)}</span>
                  <span className="text-sm text-muted-foreground">
                    {t('ambient.focusRate')}: <span className={`font-bold ${focusRateColor()}`}>{focusRatePct.toFixed(1)}%</span>
                  </span>
                </div>
              </div>
              <motion.button
                onClick={handleReset}
                className="flex items-center gap-2 rounded-full bg-muted/60 px-6 py-3 text-sm font-medium text-muted-foreground backdrop-blur-sm transition-all hover:bg-muted hover:text-foreground"
              >
                <RefreshCw className="size-4" />
                {t('dashboard.tryAgain')}
              </motion.button>
            </motion.div>
          )}
        </div>

        {/* ── Camera preview (backend MJPEG) ─────────────────────────────────── */}
        <AnimatePresence>
          {!privacyMode && cameraPreviewUrl && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute bottom-8 right-8 overflow-hidden rounded-2xl border border-border/40 shadow-2xl"
              style={{ width: 180, height: 135 }}
            >
              <img
                key={cameraPreviewUrl}
                src={cameraPreviewUrl}
                alt=""
                className="absolute inset-0 z-0 h-full w-full object-cover [transform:scaleX(-1)]"
              />
              {/* Face indicator */}
              {focusState === FOCUS_STATES.FOCUSING && (
                <div
                  className={`pointer-events-none absolute inset-0 rounded-2xl border-2 ${
                    hasFace ? 'border-green-400/60' : 'border-yellow-400/60 animate-pulse'
                  }`}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Camera permission modal ──────────────────────────────────────────── */}
      <AnimatePresence>
        {showPermissionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm rounded-2xl border border-border/40 bg-card/90 p-8 text-center shadow-2xl backdrop-blur-xl"
            >
              <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl bg-primary/10">
                <Camera className="size-8 text-primary" />
              </div>
              <h2 className="mb-2 text-xl font-bold text-foreground">{t('dashboard.enableCam')}</h2>
              <p className="mb-6 whitespace-pre-line text-sm text-muted-foreground">
                {t('dashboard.cameraHint')}
              </p>
              {cameraError && (
                <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{cameraError}</div>
              )}
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleGrantPermission}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90"
                >
                  {t('dashboard.allowCamera')}
                </button>
                <button
                  onClick={() => { setShowPermissionModal(false); setPrivacyMode(true); handleStartFocus(); }}
                  className="w-full rounded-xl bg-muted/60 py-3 text-sm font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
                >
                  {t('dashboard.privacyModeOpt')}
                </button>
                <button
                  onClick={() => setShowPermissionModal(false)}
                  className="w-full rounded-xl py-2 text-sm text-muted-foreground transition-all hover:text-foreground"
                >
                  {t('dashboard.cancel')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default AmbientModePage;
