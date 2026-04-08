import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Palmtree as IslandIcon,
  ScanFace,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useBackend } from '../hooks/useBackend';
import { useI18n } from '../i18n/I18nContext';

function FaceSetupPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user } = useAuth();
  const {
    isConnected,
    sendMessage,
    sessionState,
    getApiBaseUrl,
    checkFaceStatus,
  } = useBackend();

  const [bound, setBound] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastJson, setLastJson] = useState(null);
  const [statusErr, setStatusErr] = useState(null);

  const userId = user?.id || 'default_user';

  const refreshBound = useCallback(async () => {
    if (!isConnected) return;
    setStatusErr(null);
    checkFaceStatus(userId);
    try {
      const base = await getApiBaseUrl();
      const res = await fetch(
        `${base}/api/face/status/${encodeURIComponent(userId)}`
      );
      const j = await res.json();
      if (j.success) setBound(!!j.is_bound);
      else setStatusErr(j.error || t('faceSetup.errRequest'));
    } catch (e) {
      setStatusErr(e.message || t('faceSetup.errRequest'));
    }
  }, [isConnected, checkFaceStatus, userId, getApiBaseUrl, t]);

  useEffect(() => {
    if (!isConnected) return undefined;
    sendMessage({ type: 'start_camera' });
    void refreshBound();
    const id = setInterval(() => void refreshBound(), 8000);
    return () => clearInterval(id);
  }, [isConnected, sendMessage, refreshBound]);

  useEffect(() => {
    if (sessionState?.face_status?.is_bound != null) {
      setBound(sessionState.face_status.is_bound);
    }
  }, [sessionState?.face_status?.is_bound]);

  const postFace = async (path) => {
    if (!isConnected) {
      setLastJson({ success: false, error: t('faceSetup.errNoBackend') });
      return;
    }
    setLoading(true);
    setLastJson(null);
    try {
      const base = await getApiBaseUrl();
      const url = `${base}${path}?user_id=${encodeURIComponent(userId)}&language=zh`;
      const res = await fetch(url, { method: 'POST' });
      const j = await res.json();
      setLastJson(j);
      if (j.success && path.includes('bind')) setBound(true);
      void refreshBound();
    } catch (e) {
      setLastJson({ success: false, error: e.message || t('faceSetup.errRequest') });
    } finally {
      setLoading(false);
    }
  };

  const state = sessionState?.current_state || 'idle';
  const hasFace = sessionState?.has_face ?? false;

  return (
    <div className="fixed inset-0 flex flex-col overflow-y-auto bg-background">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute right-0 top-0 size-[520px] rounded-full bg-primary/8 blur-3xl" />
        <div className="absolute bottom-0 left-0 size-[420px] rounded-full bg-pink-500/8 blur-3xl" />
      </div>

      <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 px-6 py-5 sm:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/80 to-pink-500/80">
            <IslandIcon className="size-6 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-foreground">
              {t('faceSetup.title')}
            </h1>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 pb-12 sm:px-8">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t('faceSetup.subtitle')}
        </p>
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-200/90">
          {t('faceSetup.backendCamHint')}
        </p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border/60 bg-card/40 p-6 backdrop-blur-md"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ScanFace className="size-5 text-primary" />
              {t('faceSetup.statusLabel')}
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                hasFace ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted text-muted-foreground'
              }`}
            >
              {hasFace ? 'Face' : 'No face'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-muted/40 px-3 py-2">
              <p className="text-muted-foreground text-xs">FSM</p>
              <p className="font-mono text-foreground">{state}</p>
            </div>
            <div className="rounded-xl bg-muted/40 px-3 py-2">
              <p className="text-muted-foreground text-xs">{t('faceSetup.bound')}</p>
              <p className="font-medium text-foreground">
                {bound === null ? '…' : bound ? t('faceSetup.boundYes') : t('faceSetup.boundNo')}
              </p>
            </div>
          </div>
        </motion.div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled={loading || !isConnected}
            onClick={() => void postFace('/api/face/bind')}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-pink-500 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-opacity disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {t('faceSetup.bindBtn')}
          </button>
          <button
            type="button"
            disabled={loading || !isConnected}
            onClick={() => void postFace('/api/face/verify')}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/30 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
          >
            {t('faceSetup.verifyBtn')}
          </button>
          <button
            type="button"
            onClick={() => void refreshBound()}
            className="text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {t('faceSetup.refreshStatus')}
          </button>
        </div>

        {lastJson && (
          <div
            className={`flex gap-2 rounded-xl border px-4 py-3 text-sm ${
              lastJson.success
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                : 'border-red-500/30 bg-red-500/10 text-red-200'
            }`}
          >
            {lastJson.success ? (
              <CheckCircle2 className="size-5 shrink-0" />
            ) : (
              <AlertCircle className="size-5 shrink-0" />
            )}
            <div>
              <p className="font-medium">{t('faceSetup.result')}</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs opacity-90">
                {JSON.stringify(lastJson, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {statusErr && (
          <p className="text-center text-xs text-red-400">{statusErr}</p>
        )}

        <div className="mt-auto flex flex-col gap-3 pt-4">
          <button
            type="button"
            onClick={() => navigate('/personal')}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-foreground py-3.5 text-sm font-semibold text-background"
          >
            {t('faceSetup.continueHome')}
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => navigate('/personal')}
            className="text-center text-xs text-muted-foreground hover:text-foreground"
          >
            {t('faceSetup.skipHint')}
          </button>
        </div>
      </main>
    </div>
  );
}

export default FaceSetupPage;
