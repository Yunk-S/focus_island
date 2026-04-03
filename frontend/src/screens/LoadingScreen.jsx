import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useBackend } from '../hooks/useBackend';
import { useI18n } from '../i18n/I18nContext';
import { Palmtree as IslandIcon, Star, Heart, Monitor, Cpu } from 'lucide-react';

function LoadingScreen() {
  const { t } = useI18n();
  const { systemInfo, backendLogs, error } = useBackend();
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');

  const loadingStages = useMemo(
    () => [
      { text: t('loading.models'), minProgress: 0 },
      { text: t('loading.face'), minProgress: 20 },
      { text: t('loading.nn'), minProgress: 40 },
      { text: t('loading.camera'), minProgress: 60 },
      { text: t('loading.ws'), minProgress: 80 },
      { text: t('loading.almost'), minProgress: 95 },
    ],
    [t]
  );

  useEffect(() => {
    setStatusText(t('loading.init'));
  }, [t]);

  // Animate progress
  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        const stage = loadingStages.find((s) => s.minProgress > prev) || loadingStages[loadingStages.length - 1];
        setStatusText(stage.text);
        return prev + 2;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [loadingStages]);

  // Update status based on backend logs
  useEffect(() => {
    backendLogs.forEach((log) => {
      const msg = typeof log.message === 'string' ? log.message : '';
      if (msg.includes('Loading')) {
        setStatusText(t('loading.models'));
      } else if (msg.includes('GPU') || msg.includes('CUDA')) {
        setStatusText(t('loading.gpu'));
      } else if (msg.includes('Face detector') || msg.includes('RetinaFace')) {
        setStatusText(t('loading.retina'));
      } else if (msg.includes('recognizer') || msg.includes('ArcFace')) {
        setStatusText(t('loading.arc'));
      } else if (msg.includes('landmark') || msg.includes('Landmark')) {
        setStatusText(t('loading.landmark'));
      } else if (msg.includes('head pose') || msg.includes('HeadPose')) {
        setStatusText(t('loading.headpose'));
      } else if (msg.includes('camera') || msg.includes('Camera')) {
        setStatusText(t('loading.camera'));
      } else if (msg.includes('WebSocket') || msg.includes('websocket')) {
        setStatusText(t('loading.ws'));
      } else if (msg.includes('ready') || msg.includes('started')) {
        setStatusText(t('loading.ready'));
      }
    });

    if (backendLogs.length > 0) {
      setProgress((prev) => (prev < 90 ? Math.min(prev + 10, 90) : prev));
    }
  }, [backendLogs, t]);

  // Update progress based on backend ready state
  useEffect(() => {
    if (systemInfo.backend_ready) {
      setProgress(100);
      setStatusText(t('loading.ready'));
    }
  }, [systemInfo.backend_ready, t]);

  const errorDisplay =
    error === 'Connection error' || (typeof error === 'string' && error.toLowerCase().includes('connection'))
      ? t('backend.wsError')
      : error;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 flex flex-col items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #0a0a0f 0%, #0f0f1a 50%, #0a0a0f 100%)' }}
    >
      {/* Animated background particles */}
      <div className="particles">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="particle"
            style={{
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 10}s`,
              animationDuration: `${15 + Math.random() * 10}s`,
              background: i % 2 === 0 ? '#7FDBDA' : '#B794F4',
            }}
          />
        ))}
      </div>

      {/* Logo */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="relative mb-8"
      >
        <div
          className="w-32 h-32 rounded-3xl bg-gradient-to-br from-accent-mint to-accent-lavender flex items-center justify-center shadow-2xl"
          style={{ boxShadow: '0 0 60px rgba(127, 219, 218, 0.4)' }}
        >
          <IslandIcon className="w-20 h-20 text-background" />
        </div>

        {/* Floating elements */}
        <motion.div
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute -top-4 -right-4 w-8 h-8 rounded-xl bg-accent-mint/20 backdrop-blur-sm flex items-center justify-center"
        >
          <Star className="w-4 h-4 text-accent-mint" />
        </motion.div>
        <motion.div
          animate={{ y: [0, 10, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute -bottom-2 -left-6 w-6 h-6 rounded-full bg-accent-lavender/20 backdrop-blur-sm flex items-center justify-center"
        >
          <Heart className="w-3 h-3 text-accent-lavender" />
        </motion.div>
      </motion.div>

      {/* App Name */}
      <motion.h1
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="text-4xl font-display font-bold mb-2"
      >
        <span className="gradient-text">{t('login.brand')}</span>
      </motion.h1>

      {/* Tagline */}
      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="text-text-secondary mb-12"
      >
        {t('loading.tagline')}
      </motion.p>

      {/* Progress Section */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="w-80 mb-8"
      >
        {/* Progress Bar */}
        <div className="relative h-1.5 bg-white/5 rounded-full overflow-hidden mb-4">
          <motion.div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-accent-mint to-accent-lavender rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        {/* Status Text */}
        <div className="flex items-center justify-between">
          <motion.span
            key={statusText}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-sm text-text-secondary"
          >
            {statusText}
          </motion.span>
          <span className="text-sm text-accent-mint font-medium">{progress}%</span>
        </div>
      </motion.div>

      {/* System Info */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.5 }}
        className="glass rounded-xl px-6 py-4 mb-8"
      >
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${systemInfo.backend_ready ? 'bg-accent-mint' : 'bg-yellow-500 animate-pulse'}`}
            />
            <span className="text-text-secondary">{t('loading.backend')}</span>
          </div>
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-text-secondary" />
            <span className="text-text-secondary">
              {systemInfo.gpu_available ? systemInfo.gpu_name : t('loading.cpu')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-text-secondary" />
            <span className="text-text-secondary">
              {t('loading.version')} {systemInfo.version}
            </span>
          </div>
        </div>
      </motion.div>

      {/* Loading Logs */}
      {backendLogs.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-80 h-24 overflow-y-auto glass rounded-xl p-3">
          {backendLogs.slice(-10).map((log, i) => (
            <div
              key={i}
              className={`text-xs font-mono mb-1 ${log.type === 'error' ? 'text-red-400' : 'text-text-muted'}`}
            >
              {log.message ?? ''}
            </div>
          ))}
        </motion.div>
      )}

      {/* Error Display */}
      {error && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-80 mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl"
        >
          <p className="text-red-400 text-sm">{errorDisplay}</p>
        </motion.div>
      )}
    </motion.div>
  );
}

export default LoadingScreen;
