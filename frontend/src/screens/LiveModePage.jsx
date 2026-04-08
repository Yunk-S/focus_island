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
    <div className="fixed inset-0 flex flex-col bg-background overflow-hidden">
      <header className="relative z-10 flex items-center px-8 py-5 border-b border-border/20">
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
              {roomError && <p className="text-sm text-red-400">{roomError}</p>}
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
    <div className="fixed inset-0 flex flex-col bg-background overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/4 right-1/4 size-[400px] rounded-full bg-primary/5 blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center px-8 py-5">
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
  const { myClientId, myRoomId, participants, localStream, remoteStreams, signalingState, leaveRoom, requestCamera, cameraError } = useWebRTC();
  const [copied, setCopied] = useState(false);
  const localVideoRef = useRef(null);

  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

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

  const participantIds = Object.keys(remoteStreams);

  return (
    <div className="fixed inset-0 flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-border/30 bg-card/60 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/20">
            <Users className="size-4 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-foreground">{myRoomId}</span>
              <button onClick={copyCode} className="text-muted-foreground hover:text-foreground transition-colors">
                {copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
              </button>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <div
                className={`size-1.5 rounded-full ${
                  signalingState === 'in_room' ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'
                }`}
              />
              {participants.length + 1} {t('live.peopleOnline')}
            </div>
          </div>
        </div>

        <button
          onClick={handleLeave}
          className="flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-all hover:bg-red-500/20"
        >
          <PhoneOff className="size-4" />
          {t('live.leave')}
        </button>
      </header>

      {/* Video grid */}
      <main className="relative z-10 flex-1 overflow-auto p-4">
        <div className="grid h-full auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Local video */}
          {localStream ? (
            <div className="group relative overflow-hidden rounded-2xl border border-border/40 bg-card shadow-xl">
              <video ref={localVideoRef} autoPlay muted playsInline className="size-full object-cover" />
              <div className="absolute bottom-3 left-3 rounded-lg bg-black/50 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
                {myClientId ? `${t('live.youLabel')} (${myClientId.slice(0, 6)})` : t('live.youLabel')}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border/40 bg-card/40 p-8 text-center shadow-xl">
              <VideoOff className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t('live.camOff')}</p>
              {cameraError && <p className="text-xs text-red-400">{cameraError}</p>}
              <button
                onClick={requestCamera}
                className="rounded-lg bg-primary/10 px-4 py-2 text-xs font-medium text-primary transition-all hover:bg-primary/20"
              >
                {t('live.enableCam')}
              </button>
            </div>
          )}

          {/* Remote videos */}
          <AnimatePresence>
            {participantIds.map((cid) => {
              const stream = remoteStreams[cid];
              const p = participants.find((x) => x.client_id === cid);
              if (!stream) return null;
              return (
                <motion.div
                  key={cid}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="relative overflow-hidden rounded-2xl border border-border/40 bg-card shadow-xl"
                >
                  <RemoteVideo stream={stream} clientId={cid} userName={p?.user_name} />
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Empty placeholder */}
          {participantIds.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/40 bg-card/20 p-12 text-center">
              <Users className="size-12 text-muted-foreground/30" />
              <p className="text-base font-medium text-muted-foreground">{t('live.waitOthers')}</p>
              <p className="text-sm text-muted-foreground/60">{t('live.shareHint')}</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ─── Root Live Mode — provides WebRTC context ───────────────────────────────────
function LiveModePageInner() {
  const navigate = useNavigate();
  const location = useLocation();

  // 不自动启动后端摄像头，等待用户在房间内主动开启

  // 仅 /live/room 显示视频房间，避免创建房间后 signalingState=in_room 抢走主持界面
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
