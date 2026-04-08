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
  RotateCcw,
  Camera,
  CameraOff,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Zap,
} from 'lucide-react';

const FOCUS_STATES = {
  IDLE: 'idle',
  FOCUSING: 'focusing',
  PAUSED: 'paused',
  COMPLETED: 'completed',
};

const FOCUS_DURATIONS = [15, 25, 45, 60]; // minutes

function AmbientModePage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user, updatePoints, updateStreak } = useAuth();
  const {
    sessionState,
    isConnected,
    startSession,
    stopSession,
    pauseSession,
    resumeSession,
    focusSessionError,
  } = useBackend();

  // ─── Timer state ─────────────────────────────────────────────────────────────
  const [focusDuration, setFocusDuration] = useState(25); // minutes
  const [timeLeft, setTimeLeft] = useState(25 * 60); // seconds
  const [focusState, setFocusState] = useState(FOCUS_STATES.IDLE);
  const [totalPoints, setTotalPoints] = useState(user?.totalPoints || 0);
  const [sessionCount, setSessionCount] = useState(0);
  const [todayFocusTime, setTodayFocusTime] = useState(0); // minutes

  // ─── Camera / privacy state ─────────────────────────────────────────────────
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(true); // camera off by default
  const [cameraGranted, setCameraGranted] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [cameraRequested, setCameraRequested] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // ─── UI state ────────────────────────────────────────────────────────────────
  const [showSettings, setShowSettings] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [muted, setMuted] = useState(false);

  // ─── Permission flow ─────────────────────────────────────────────────────────
  const requestCameraPermission = useCallback(async () => {
    setCameraRequested(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraGranted(true);
      setCameraError(null);
      setShowPermissionModal(false);
      setCameraEnabled(true);
    } catch (err) {
      setCameraError(err.message || 'Camera access denied');
      setCameraGranted(false);
    }
  }, []);

  const releaseCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraGranted(false);
    setCameraEnabled(false);
  }, []);

  // ─── Timer logic ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let interval = null;
    if (focusState === FOCUS_STATES.FOCUSING && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            handleSessionComplete();
            return 0;
          }
          return prev - 1;
        });
        // Update focus time every minute
        if (timeLeft % 60 === 0) {
          setTodayFocusTime((t) => t + 1);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [focusState, timeLeft]);

  useEffect(() => {
    if (focusSessionError) {
      setFocusState(FOCUS_STATES.IDLE);
    }
  }, [focusSessionError]);

  const handleStartFocus = () => {
    if (!cameraRequested && !privacyMode) {
      setShowPermissionModal(true);
      return;
    }
    setFocusState(FOCUS_STATES.FOCUSING);
    if (user?.id) {
      startSession(user.id);
    }
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
    setFocusState(FOCUS_STATES.IDLE);
    setTimeLeft(focusDuration * 60);
    stopSession();
  };

  const handleSessionComplete = useCallback(() => {
    const earnedPoints = Math.round(focusDuration * 10);
    setTotalPoints((prev) => prev + earnedPoints);
    setSessionCount((prev) => prev + 1);
    setFocusState(FOCUS_STATES.COMPLETED);
    stopSession();

    // Update auth context
    if (updatePoints) updatePoints(earnedPoints);
  }, [focusDuration, stopSession, updatePoints]);

  const handleReset = () => {
    setFocusState(FOCUS_STATES.IDLE);
    setTimeLeft(focusDuration * 60);
  };

  const handleDurationChange = (mins) => {
    if (focusState === FOCUS_STATES.IDLE) {
      setFocusDuration(mins);
      setTimeLeft(mins * 60);
    }
  };

  // ─── Format time ─────────────────────────────────────────────────────────────
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // ─── Progress ────────────────────────────────────────────────────────────────
  const progress = focusDuration > 0 ? ((focusDuration * 60 - timeLeft) / (focusDuration * 60)) * 100 : 0;

  // ─── Session state from backend ──────────────────────────────────────────────
  const currentState = sessionState?.current_state || 'idle';
  const hasFace = sessionState?.has_face ?? false;

  return (
    <div className="fixed inset-0 flex flex-col bg-background overflow-hidden">
      {/* Background ambient decorations */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Animated gradient orbs */}
        <div
          className="absolute rounded-full blur-3xl animate-pulse"
          style={{
            width: 600,
            height: 600,
            top: '10%',
            left: '20%',
            background: 'radial-gradient(circle, rgba(108,63,245,0.15) 0%, transparent 70%)',
            animationDuration: '6s',
          }}
        />
        <div
          className="absolute rounded-full blur-3xl animate-pulse"
          style={{
            width: 500,
            height: 500,
            bottom: '10%',
            right: '15%',
            background: 'radial-gradient(circle, rgba(219,127,127,0.12) 0%, transparent 70%)',
            animationDuration: '8s',
            animationDelay: '2s',
          }}
        />
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(hsl(0 0% 100% / 0.05) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100% / 0.05) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-8 py-5">
        <button
          onClick={() => navigate('/personal')}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
        >
          <ArrowLeft className="size-4" />
          <span>{t('dashboard.backPersonal')}</span>
        </button>

        <div className="flex items-center gap-6 text-sm">
          {/* Stats */}
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Zap className="size-4 text-primary" />
            <span className="font-medium text-foreground">{totalPoints}</span>
            <span className="hidden sm:inline">{t('dashboard.points')}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="size-4 text-primary" />
            <span className="font-medium text-foreground">{todayFocusTime}</span>
            <span className="hidden sm:inline">{t('dashboard.min')}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <CheckCircle2 className="size-4 text-primary" />
            <span className="font-medium text-foreground">{sessionCount}</span>
            <span className="hidden sm:inline">{t('dashboard.sessions')}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setPrivacyMode(!privacyMode)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
          >
            {privacyMode ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            <span>{privacyMode ? t('dashboard.privacyMode') : t('dashboard.cameraMode')}</span>
          </button>
        </div>
      </header>

      {/* Main timer area */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-8">
        {/* Duration selector (only when idle) */}
        <AnimatePresence>
          {focusState === FOCUS_STATES.IDLE && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-8 flex items-center gap-3"
            >
              {FOCUS_DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => handleDurationChange(d)}
                  className={`rounded-full px-5 py-2 text-sm font-medium transition-all ${
                    focusDuration === d
                      ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30'
                      : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {t('dashboard.durations', { n: d })}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Circular progress timer */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative mb-10 flex items-center justify-center"
        >
          {/* Outer ring */}
          <div className="relative size-72 rounded-full border border-border/30 bg-card/40 backdrop-blur-xl shadow-2xl">
            {/* Progress arc */}
            <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 288 288">
              {/* Background circle */}
              <circle cx="144" cy="144" r="136" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="6" />
              {/* Progress circle */}
              <circle
                cx="144"
                cy="144"
                r="136"
                fill="none"
                stroke="url(#progressGradient)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 136}
                strokeDashoffset={2 * Math.PI * 136 * (1 - progress / 100)}
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
              <defs>
                <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#6C3FF5" />
                  <stop offset="100%" stopColor="#B794F4" />
                </linearGradient>
              </defs>
            </svg>

            {/* Timer content */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div
                className={`mb-1 font-mono text-6xl font-bold tracking-tight transition-colors ${
                  focusState === FOCUS_STATES.FOCUSING
                    ? hasFace ? 'text-foreground' : 'text-yellow-400'
                    : focusState === FOCUS_STATES.COMPLETED
                    ? 'text-green-400'
                    : 'text-foreground'
                }`}
              >
                {formatTime(timeLeft)}
              </div>
              <div className="text-sm text-muted-foreground">
                {focusState === FOCUS_STATES.IDLE && t('dashboard.ready')}
                {focusState === FOCUS_STATES.FOCUSING && (hasFace ? t('dashboard.focusing') : t('dashboard.noFace'))}
                {focusState === FOCUS_STATES.PAUSED && t('dashboard.paused')}
                {focusState === FOCUS_STATES.COMPLETED && t('dashboard.complete')}
              </div>
            </div>

            {/* Camera indicator dot */}
            {focusState === FOCUS_STATES.FOCUSING && (
              <div
                className={`absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
                  hasFace
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-yellow-500/20 text-yellow-400'
                }`}
              >
                <div className={`size-1.5 rounded-full ${hasFace ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
                {hasFace ? t('dashboard.faceDetected') : t('dashboard.noFaceDetected')}
              </div>
            )}
          </div>
        </motion.div>

        {/* Control buttons */}
        {focusSessionError && (
          <p className="mb-2 max-w-md text-center text-sm text-red-400">{focusSessionError}</p>
        )}

        <div className="flex items-center gap-4">
          {focusState === FOCUS_STATES.IDLE && (
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={handleStartFocus}
              className="flex items-center gap-3 rounded-full bg-primary px-8 py-4 text-base font-semibold text-primary-foreground shadow-xl shadow-primary/30 transition-all hover:scale-105 hover:shadow-2xl hover:shadow-primary/40 active:scale-95"
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

          {focusState === FOCUS_STATES.COMPLETED && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-2 rounded-full bg-green-500/20 px-6 py-3 text-base font-semibold text-green-400">
                <CheckCircle2 className="size-5" />
                {t('dashboard.completePoints')}+{Math.round(focusDuration * 10)} {t('dashboard.points')}
              </div>
              <motion.button
                onClick={handleReset}
                className="flex items-center gap-2 rounded-full bg-muted/60 px-6 py-3 text-sm font-medium text-muted-foreground backdrop-blur-sm transition-all hover:bg-muted hover:text-foreground"
              >
                <RotateCcw className="size-4" />
                {t('dashboard.tryAgain')}
              </motion.button>
            </motion.div>
          )}
        </div>

        {/* Camera preview (small) */}
        <AnimatePresence>
          {cameraEnabled && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute bottom-8 right-8 overflow-hidden rounded-2xl border border-border/40 shadow-2xl"
              style={{ width: 180, height: 135 }}
            >
              <video ref={videoRef} autoPlay muted playsInline className="size-full object-cover" />
              {/* Face detection overlay */}
              {focusState === FOCUS_STATES.FOCUSING && (
                <div
                  className={`absolute inset-0 border-2 ${
                    hasFace ? 'border-green-400/60' : 'border-yellow-400/60 animate-pulse'
                  } rounded-2xl`}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Camera permission modal */}
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
                <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                  {cameraError}
                </div>
              )}
              <div className="flex flex-col gap-3">
                <button
                  onClick={requestCameraPermission}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90"
                >
                  {t('dashboard.allowCamera')}
                </button>
                <button
                  onClick={() => { setShowPermissionModal(false); setPrivacyMode(true); setFocusState(FOCUS_STATES.FOCUSING); }}
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
