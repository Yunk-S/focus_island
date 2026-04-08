import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { WebRTCProvider, useWebRTC } from '../hooks/useWebRTC';
import { useI18n } from '../i18n/I18nContext';
import {
  ArrowLeft,
  Copy,
  Check,
  Users,
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  Plus,
  LogIn,
  Crown,
  RefreshCw,
  AlertCircle,
  Wifi,
  LayoutGrid,
  Shield,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ─── Remote video sub-component ─────────────────────────────────────────────────
function RemoteVideo({ stream, clientId, userName }) {
  const { t } = useI18n();
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);
  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="size-full object-cover"
        style={{ minHeight: 200 }}
      />
      <div className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
        {userName || clientId?.slice(0, 6) || t('live.unknownGuest')}
      </div>
    </>
  );
}

// ─── Pre-join selection screen ─────────────────────────────────────────────────
function LiveModeSelectScreen({ navigate }) {
  const { t } = useI18n();
  const [selection, setSelection] = useState(null); // 'host' | 'join'

  if (selection === 'join') {
    return <JoinRoomScreen navigate={navigate} onBack={() => setSelection(null)} />;
  }

  if (selection === 'host') {
    return <HostScreen navigate={navigate} onBack={() => setSelection(null)} />;
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-background overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/4 right-1/4 size-[400px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 size-[500px] rounded-full bg-pink-500/5 blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center px-8 py-5">
        <button
          onClick={() => navigate('/personal')}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
        >
          <ArrowLeft className="size-4" />
          <span>{t('live.backHub')}</span>
        </button>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-8">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-12 text-center"
        >
          <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
            {t('live.title')}
            <span className="bg-gradient-to-r from-pink-400 to-rose-500 bg-clip-text text-transparent">
              {' '}
              {t('live.badgeLive')}
            </span>
          </h1>
          <p className="text-muted-foreground">{t('live.subtitle')}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid w-full max-w-2xl grid-cols-1 gap-6 sm:grid-cols-2"
        >
          {/* Host */}
          <motion.button
            whileHover={{ scale: 1.03, y: -4 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setSelection('host')}
            className="group relative flex flex-col items-center gap-4 rounded-2xl border border-border/40 bg-card/60 p-8 text-center shadow-xl backdrop-blur-xl transition-shadow hover:border-pink-500/30 hover:shadow-2xl"
          >
            <div className="flex size-16 items-center justify-center rounded-2xl bg-pink-500/10">
              <Crown className="size-8 text-pink-400" />
            </div>
            <div>
              <h2 className="mb-1 text-xl font-bold text-foreground">{t('live.hostTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('live.hostDesc')}</p>
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-pink-400">
              <span>{t('live.hostCta')}</span>
              <Plus className="size-4" />
            </div>
            <div className="absolute bottom-0 left-0 h-1 w-0 bg-gradient-to-r from-pink-500 to-rose-500 transition-all duration-500 group-hover:w-full" />
          </motion.button>

          {/* Join */}
          <motion.button
            whileHover={{ scale: 1.03, y: -4 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setSelection('join')}
            className="group relative flex flex-col items-center gap-4 rounded-2xl border border-border/40 bg-card/60 p-8 text-center shadow-xl backdrop-blur-xl transition-shadow hover:border-primary/30 hover:shadow-2xl"
          >
            <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
              <LogIn className="size-8 text-primary" />
            </div>
            <div>
              <h2 className="mb-1 text-xl font-bold text-foreground">{t('live.joinTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('live.joinDesc')}</p>
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <span>{t('live.joinCta')}</span>
              <LogIn className="size-4" />
            </div>
            <div className="absolute bottom-0 left-0 h-1 w-0 bg-gradient-to-r from-primary to-pink-400 transition-all duration-500 group-hover:w-full" />
          </motion.button>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-10 text-center text-xs text-muted-foreground/60"
        >
          💡 {t('live.footerTip')}
        </motion.p>
      </main>
    </div>
  );
}

// ─── Host screen ────────────────────────────────────────────────────────────────
function HostScreen({ navigate, onBack }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const { createRoom, myRoomId, signalingState, roomError, requestCamera, localStream, cameraError } = useWebRTC();
  const [roomId, setRoomId] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showPermission, setShowPermission] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef(null);

  useEffect(() => {
    createRoom(user?.name || 'Host');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (myRoomId) setRoomId(myRoomId);
  }, [myRoomId]);

  useEffect(() => {
    if (localStream && videoRef.current) {
      videoRef.current.srcObject = localStream;
      setCameraReady(true);
    }
  }, [localStream]);

  const handleGrantCamera = async () => {
    const stream = await requestCamera();
    if (stream) setShowPermission(false);
  };

  const copyInviteCode = () => {
    if (!roomId) return;
    navigator.clipboard.writeText(roomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleEnterRoom = () => {
    navigate('/live/room');
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#0b0b10]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,80,200,0.12),transparent)]" />
      <header className="relative z-10 flex items-center border-b border-white/10 bg-black/30 px-8 py-5 backdrop-blur-xl">
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
        >
          <ArrowLeft className="size-4" />
          <span>{t('common.back')}</span>
        </button>
        <div className="flex-1 text-center">
          <span className="text-sm font-medium text-foreground">{t('live.hostHeader')}</span>
        </div>
        <div className="w-20" />
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-8">
        <AnimatePresence mode="wait">
          {!roomId ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4"
            >
              <RefreshCw className="size-8 animate-spin text-primary" />
              <p className="text-muted-foreground">{t('live.creating')}</p>
              {roomError && (
                <div className="max-w-md text-center">
                  <p className="text-sm text-red-400">{roomError}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{t('live.signalingFailed')}</p>
                </div>
              )}
            </motion.div>
          ) : !showPermission ? (
            <motion.div
              key="room-ready"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex w-full max-w-lg flex-col items-center gap-8"
            >
              {/* Invite code card */}
              <div className="w-full rounded-2xl border border-border/40 bg-card/80 p-8 text-center shadow-xl backdrop-blur-xl">
                <div className="mb-2 text-sm font-medium text-muted-foreground">{t('live.inviteLabel')}</div>
                <div className="mb-4 flex items-center justify-center gap-3">
                  <span className="font-mono text-4xl font-bold tracking-widest text-foreground">{roomId}</span>
                  <button
                    onClick={copyInviteCode}
                    className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
                  >
                    {copied ? (
                      <Check className="size-5 text-green-400" />
                    ) : (
                      <Copy className="size-5" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{t('live.inviteHint')}</p>
              </div>

              {/* Camera preview */}
              <div
                className="relative overflow-hidden rounded-2xl border border-border/40 shadow-2xl"
                style={{ width: 320, height: 240 }}
              >
                {cameraReady ? (
                  <video ref={videoRef} autoPlay muted playsInline className="size-full object-cover" />
                ) : (
                  <div className="flex size-full flex-col items-center justify-center gap-3 bg-muted/20">
                    <VideoOff className="size-10 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{t('live.openCam')}</p>
                    {cameraError && <p className="text-xs text-red-400">{cameraError}</p>}
                  </div>
                )}
              </div>

              <div className="flex gap-4">
                {!cameraReady && (
                  <button
                    onClick={() => setShowPermission(true)}
                    className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90"
                  >
                    <Video className="size-4" />
                    {t('live.openCam')}
                  </button>
                )}
                <button
                  onClick={handleEnterRoom}
                  className="flex items-center gap-2 rounded-xl bg-pink-500 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-pink-500/30 transition-all hover:bg-pink-500/90 hover:scale-105"
                >
                  <Users className="size-4" />
                  {t('live.enterRoom')}
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div
                  className={`size-1.5 rounded-full ${
                    signalingState === 'in_room' ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'
                  }`}
                />
                {signalingState === 'in_room' ? t('live.roomReady') : t('live.connecting')}
                {' · '}
                {t('live.waiting')}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="permission"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm rounded-2xl border border-border/40 bg-card/90 p-8 text-center shadow-2xl backdrop-blur-xl"
            >
              <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl bg-primary/10">
                <Video className="size-8 text-primary" />
              </div>
              <h2 className="mb-2 text-xl font-bold text-foreground">{t('login.cameraTitle')}</h2>
              <p className="mb-6 text-sm text-muted-foreground">{t('login.cameraBody')}</p>
              {cameraError && (
                <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                  {cameraError}
                </div>
              )}
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleGrantCamera}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90"
                >
                  {t('login.allowCamera')}
                </button>
                <button
                  onClick={() => {
                    setShowPermission(false);
                    navigate('/live/room');
                  }}
                  className="w-full rounded-xl bg-muted/60 py-3 text-sm font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
                >
                  {t('login.skipCamera')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// ─── Join room screen ──────────────────────────────────────────────────────────
function JoinRoomScreen({ navigate, onBack }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const { joinRoom, signalingState, roomError } = useWebRTC();
  const [inputCode, setInputCode] = useState('');
  const [localError, setLocalError] = useState('');

  const handleJoin = () => {
    const code = inputCode.trim().toUpperCase();
    if (!code) { setLocalError(t('live.errEmptyCode')); return; }
    if (code.length < 4) { setLocalError(t('live.errShortCode')); return; }
    setLocalError('');
    joinRoom(code, user?.name || 'Guest');
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#0b0b10]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,80,200,0.12),transparent)]" />
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/4 right-1/4 size-[400px] rounded-full bg-primary/5 blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center border-b border-white/10 bg-black/30 px-8 py-5 backdrop-blur-xl">
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
        >
          <ArrowLeft className="size-4" />
          <span>{t('common.back')}</span>
        </button>
        <div className="flex-1 text-center">
          <span className="text-sm font-medium text-foreground">{t('live.joinHeader')}</span>
        </div>
        <div className="w-20" />
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm"
        >
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary/10">
              <LogIn className="size-8 text-primary" />
            </div>
            <h2 className="mb-2 text-2xl font-bold text-foreground">{t('live.joinCodeTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('live.joinSubtitle')}</p>
          </div>

          <div className="space-y-4">
            <div>
              <Label htmlFor="roomCode" className="mb-2 block text-sm font-medium">
                {t('live.codeLabel')}
              </Label>
              <Input
                id="roomCode"
                value={inputCode}
                onChange={(e) => {
                  setInputCode(e.target.value.toUpperCase());
                  setLocalError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                placeholder={t('live.codePlaceholder')}
                maxLength={8}
                className="h-12 text-center font-mono text-xl tracking-widest"
                autoFocus
              />
            </div>

            {(localError || roomError) && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 rounded-lg bg-red-500/10 p-3 text-sm text-red-400"
              >
                <AlertCircle className="size-4 shrink-0" />
                {localError || roomError}
              </motion.div>
            )}

            {signalingState === 'connecting' && (
              <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" />
                {t('live.connecting')}
              </div>
            )}

            {signalingState === 'in_room' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-3 rounded-xl border border-green-500/20 bg-green-500/5 p-4"
              >
                <div className="flex items-center gap-2 text-sm text-green-400">
                  <Wifi className="size-4" />
                  {t('live.connected')}
                </div>
                <button
                  onClick={() => navigate('/live/room')}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 hover:scale-[1.02]"
                >
                  {t('live.enterRoom')}
                </button>
              </motion.div>
            )}

            <button
              onClick={handleJoin}
              disabled={signalingState === 'connecting' || signalingState === 'in_room'}
              className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 disabled:opacity-50 disabled:hover:scale-100"
            >
              {t('live.joinBtn')}
            </button>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

// ─── In-room screen ────────────────────────────────────────────────────────────
function LiveRoomScreen({ navigate }) {
  const { t } = useI18n();
  const {
    myClientId,
    myRoomId,
    participants,
    localStream,
    remoteStreams,
    signalingState,
    leaveRoom,
    requestCamera,
    cameraError,
    isHost,
  } = useWebRTC();
  const [copied, setCopied] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [hostToast, setHostToast] = useState(false);
  const localVideoRef = useRef(null);

  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream]);

  useEffect(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = micOn;
    });
  }, [localStream, micOn]);

  useEffect(() => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach((track) => {
      track.enabled = camOn;
    });
  }, [localStream, camOn]);

  const copyCode = () => {
    if (!myRoomId) return;
    navigator.clipboard.writeText(myRoomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleLeave = () => {
    leaveRoom();
    navigate('/live');
  };

  const handleHostMuteAllReminder = () => {
    setHostToast(true);
    setTimeout(() => setHostToast(false), 3200);
  };

  const participantIds = Object.keys(remoteStreams);

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#0b0b10]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,80,200,0.12),transparent)]" />

      {/* Top bar — online meeting style */}
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/40 px-4 py-3 backdrop-blur-xl md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/30 to-cyan-500/20 ring-1 ring-white/10">
            <LayoutGrid className="size-5 text-violet-200" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-mono text-base font-semibold tracking-wide text-white md:text-lg">
                {myRoomId || '—'}
              </span>
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-500/30">
                {t('live.meetingLive')}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-white/50">
              <span
                className={`inline-block size-1.5 rounded-full ${
                  signalingState === 'in_room' ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              {participants.length + 1} {t('live.peopleOnline')}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copyCode}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/90 transition-colors hover:bg-white/10"
          >
            {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
            {t('live.meetingCopyLink')}
          </button>
          {isHost && (
            <div className="hidden items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90 md:flex">
              <Crown className="size-3.5 text-amber-300" />
              {t('live.meetingHost')}
            </div>
          )}
          <button
            type="button"
            onClick={handleLeave}
            className="flex items-center gap-2 rounded-xl bg-red-500/15 px-4 py-2 text-sm font-medium text-red-300 ring-1 ring-red-500/30 transition-colors hover:bg-red-500/25"
          >
            <PhoneOff className="size-4" />
            {isHost ? t('live.meetingEndForAll') : t('live.leave')}
          </button>
        </div>
      </header>

      {/* Main stage */}
      <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:p-6">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 auto-rows-fr">
          {localStream ? (
            <div className="relative flex min-h-[180px] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/80 shadow-2xl ring-1 ring-white/5">
              <video ref={localVideoRef} autoPlay muted playsInline className="size-full object-cover" />
              <div className="absolute bottom-3 left-3 flex max-w-[90%] items-center gap-2 rounded-lg bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-md">
                {isHost && <Crown className="size-3.5 shrink-0 text-amber-300" />}
                <span className="truncate">
                  {t('live.meetingYou')}
                  {myClientId ? ` · ${myClientId.slice(0, 6)}` : ''}
                </span>
              </div>
              {!camOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90">
                  <VideoOff className="mb-2 size-10 text-white/40" />
                  <span className="text-xs text-white/50">{t('live.meetingCamOff')}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 bg-zinc-900/40 p-6 text-center">
              <VideoOff className="size-10 text-white/30" />
              <p className="text-sm text-white/50">{t('live.camOff')}</p>
              {cameraError && <p className="text-xs text-red-400">{cameraError}</p>}
              <button
                type="button"
                onClick={() => requestCamera()}
                className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
              >
                {t('live.enableCam')}
              </button>
            </div>
          )}

          <AnimatePresence>
            {participantIds.map((cid) => {
              const stream = remoteStreams[cid];
              const p = participants.find((x) => x.client_id === cid);
              if (!stream) return null;
              return (
                <motion.div
                  key={cid}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  className="relative min-h-[180px] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/80 shadow-xl"
                >
                  <RemoteVideo stream={stream} clientId={cid} userName={p?.user_name} />
                </motion.div>
              );
            })}
          </AnimatePresence>

          {participantIds.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-16 text-center">
              <Users className="size-12 text-white/20" />
              <p className="text-base font-medium text-white/60">{t('live.waitOthers')}</p>
              <p className="max-w-sm text-sm text-white/40">{t('live.shareHint')}</p>
            </div>
          )}
        </div>

        {/* Host strip */}
        {isHost && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/15 bg-amber-500/5 px-4 py-3">
            <Shield className="size-4 shrink-0 text-amber-400/80" />
            <span className="text-xs font-medium text-amber-100/80">{t('live.meetingHostOnly')}</span>
            <button
              type="button"
              onClick={handleHostMuteAllReminder}
              className="ml-auto rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/80 transition-colors hover:bg-white/10"
            >
              {t('live.meetingMuteAllHint')}
            </button>
          </div>
        )}
        {hostToast && (
          <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/10 bg-zinc-900/95 px-4 py-2 text-xs text-white/90 shadow-xl">
            {t('live.meetingMuteAllHint')} ✓
          </div>
        )}
      </main>

      {/* Bottom toolbar */}
      <footer className="relative z-10 border-t border-white/10 bg-black/50 px-4 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-3 md:gap-4">
          <button
            type="button"
            onClick={() => setMicOn((m) => !m)}
            disabled={!localStream}
            className={`flex size-12 items-center justify-center rounded-full border transition-colors ${
              micOn
                ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
                : 'border-red-500/40 bg-red-500/20 text-red-200'
            } disabled:opacity-40`}
            title={micOn ? t('live.meetingMicOn') : t('live.meetingMicOff')}
          >
            {micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
          </button>
          <button
            type="button"
            onClick={() => setCamOn((c) => !c)}
            disabled={!localStream}
            className={`flex size-12 items-center justify-center rounded-full border transition-colors ${
              camOn
                ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
                : 'border-amber-500/40 bg-amber-500/15 text-amber-100'
            } disabled:opacity-40`}
            title={camOn ? t('live.meetingCamOn') : t('live.meetingCamOff')}
          >
            {camOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}
          </button>
          <button
            type="button"
            onClick={handleLeave}
            className="flex size-14 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/30 transition-transform hover:scale-105 active:scale-95"
            title={t('live.leave')}
          >
            <PhoneOff className="size-6" />
          </button>
        </div>
      </footer>
    </div>
  );
}

// ─── Root Live Mode — provides WebRTC context ───────────────────────────────────
function LiveModePageInner() {
  const navigate = useNavigate();
  const location = useLocation();

  // Do not auto-start backend camera, wait for user to manually enable in room

  // Only /live/room shows video room, avoid signalingState=in_room from taking over host screen after creating room
  if (location.pathname === '/live/room' || location.pathname.endsWith('/live/room')) {
    return <LiveRoomScreen navigate={navigate} />;
  }

  return <LiveModeSelectScreen navigate={navigate} />;
}

function LiveModePage() {
  return (
    <WebRTCProvider>
      <LiveModePageInner />
    </WebRTCProvider>
  );
}

export default LiveModePage;
