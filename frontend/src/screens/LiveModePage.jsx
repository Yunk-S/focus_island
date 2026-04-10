import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  MessageSquare,
  Trophy,
  Zap,
  Clock,
  Hand,
  X,
  Send,
  ChevronUp,
  ChevronDown,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ─── Constants ────────────────────────────────────────────────────────────────
const REACTIONS = ['thumbsup', 'clap', 'heart', 'laugh'];
const REACTION_EMOJI = {
  thumbsup: '👍',
  clap: '👏',
  heart: '❤️',
  laugh: '😂',
};

const FOCUS_COLORS = {
  focused: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', border: 'border-emerald-500/40' },
  warning:  { bg: 'bg-amber-500/20',  text: 'text-amber-300',  border: 'border-amber-500/40' },
  idle:    { bg: 'bg-zinc-500/20',   text: 'text-zinc-400',    border: 'border-zinc-500/40' },
};

// ─── Focus badge ──────────────────────────────────────────────────────────────
function FocusBadge({ state, ear, className = '' }) {
  const { t } = useI18n();
  const colors = FOCUS_COLORS[state] || FOCUS_COLORS.idle;
  return (
    <div className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${colors.bg} ${colors.text} ${colors.border} ${className}`}>
      <span className={`inline-block size-1.5 rounded-full ${state === 'focused' ? 'bg-emerald-400 animate-pulse' : state === 'warning' ? 'bg-amber-400 animate-pulse' : 'bg-zinc-500'}`} />
      {state === 'focused' ? t('live.leaderboardFocused') : state === 'warning' ? '⚠️' : '—'}
      {ear > 0 && <span className="opacity-70">{ear.toFixed(2)}</span>}
    </div>
  );
}

// ─── Video tile with focus overlay ────────────────────────────────────────────
function VideoTile({ stream, clientId, userName, focusInfo, isLocal, isHost, isHandUp, micOn, camOn, onToggleCamera, onRequestCamera, cameraError, t }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current) {
      if (stream) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(console.error);
      } else {
        videoRef.current.srcObject = null;
      }
    }
  }, [stream]);

  const handleClick = () => {
    if (isLocal && !stream && onRequestCamera) {
      onRequestCamera();
    }
  };

  const colors = focusInfo ? (FOCUS_COLORS[focusInfo.focus_state] || FOCUS_COLORS.idle) : FOCUS_COLORS.idle;
  const ear = focusInfo?.ear || 0;

  return (
    <div
      className={`group relative flex min-h-[160px] flex-col overflow-hidden rounded-2xl border shadow-xl transition-shadow ${isLocal ? 'cursor-pointer' : ''} ${
        isHandUp
          ? 'border-amber-400/60 shadow-amber-500/10 ring-2 ring-amber-400/30'
          : focusInfo?.focus_state === 'focused'
          ? 'border-emerald-500/30'
          : 'border-white/10'
      }`}
      onClick={handleClick}
    >
      {/* Video */}
      {stream && camOn ? (
        <video
          ref={videoRef}
          autoPlay
          muted={isLocal}
          playsInline
          className="size-full flex-1 object-cover"
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-zinc-900/80 py-8">
          <div className="flex size-14 items-center justify-center rounded-full bg-zinc-800 text-zinc-500">
            <Users className="size-7" />
          </div>
          <span className="text-sm text-white/50">{isLocal ? t('live.camOff') : (userName || clientId?.slice(0, 6) || '—')}</span>
          {!isLocal && !stream && (
            <span className="text-xs text-zinc-600">{t('live.meetingWaitingHost')}</span>
          )}
        </div>
      )}

      {/* Hand raise banner */}
      <AnimatePresence>
        {isHandUp && (
          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 10, opacity: 0 }}
            className="absolute inset-x-0 top-0 flex items-center justify-center gap-1 bg-amber-500/90 py-1 text-xs font-medium text-white"
          >
            <Hand className="size-3.5" />
            {t('live.handRaiseBtn')}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom bar */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {isHost && !isLocal && <Crown className="size-3 shrink-0 text-amber-300" />}
          <span className="truncate text-xs font-medium text-white/90">
            {isLocal ? t('live.meetingYou') : (userName || clientId?.slice(0, 6) || '—')}
          </span>
          {!micOn && <MicOff className="size-3 shrink-0 text-red-400" />}
        </div>

        <FocusBadge state={focusInfo?.focus_state} ear={ear} />
      </div>

      {/* Focus score overlay (bottom right) */}
      {focusInfo && (
        <div className="absolute bottom-9 right-2 flex flex-col items-end gap-0.5">
          {focusInfo.focus_time > 0 && (
            <div className="flex items-center gap-0.5 text-[10px] text-white/60">
              <Clock className="size-2.5" />
              <span>{Math.floor(focusInfo.focus_time / 60)}m</span>
            </div>
          )}
          {focusInfo.points > 0 && (
            <div className="flex items-center gap-0.5 text-[10px] text-amber-300/80">
              <Zap className="size-2.5" />
              <span>{focusInfo.points}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Chat panel ───────────────────────────────────────────────────────────────
function ChatPanel({ messages, onSend, onClose, isOpen }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text);
    setText('');
  };

  const formatTime = (ts) => {
    const d = new Date(ts * 1000);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-80 shrink-0 flex-col rounded-2xl border border-white/10 bg-zinc-900/80 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-primary" />
          <span className="text-sm font-semibold text-white">{t('live.chatTitle')}</span>
        </div>
        <button onClick={onClose} className="rounded-lg p-1 text-white/40 hover:text-white">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
            <MessageSquare className="size-8 text-white/20" />
            <p className="text-xs text-white/40">{t('live.chatEmpty')}</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-primary/80">{msg.user_name || msg.from?.slice(0, 6)}</span>
                <span className="text-[10px] text-white/30">{formatTime(msg.ts)}</span>
              </div>
              <p className="break-all text-xs leading-relaxed text-white/80">{msg.text}</p>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-white/10 px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={t('live.chatPlaceholder')}
            maxLength={500}
            className="flex-1 bg-transparent text-sm text-white placeholder-white/30 outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className="flex size-8 items-center justify-center rounded-lg bg-primary/80 text-primary-foreground transition-colors hover:bg-primary disabled:opacity-40"
          >
            <Send className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Leaderboard sidebar ─────────────────────────────────────────────────────
function LeaderboardSidebar({ focusData, myClientId, isOpen }) {
  const { t } = useI18n();
  const { user } = useAuth();

  if (!isOpen) return null;

  const entries = Object.entries(focusData)
    .map(([cid, data]) => ({
      clientId: cid,
      userName: data.user_name || cid.slice(0, 6),
      focus_time: data.focus_time || 0,
      points: data.points || 0,
      focus_state: data.focus_state || 'idle',
      isMe: cid === myClientId,
    }))
    .sort((a, b) => b.points - a.points || b.focus_time - a.focus_time);

  return (
    <div className="flex h-full w-64 shrink-0 flex-col rounded-2xl border border-white/10 bg-zinc-900/80 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <Trophy className="size-4 text-amber-400" />
        <span className="text-sm font-semibold text-white">{t('live.leaderboardTitle')}</span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {entries.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
            <Trophy className="size-8 text-white/20" />
            <p className="text-xs text-white/40">{t('live.leaderboardEmpty')}</p>
          </div>
        ) : (
          entries.map((entry, i) => {
            const colors = entry.focus_state === 'focused'
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : entry.focus_state === 'warning'
              ? 'border-amber-500/30 bg-amber-500/5'
              : 'border-white/5 bg-white/[0.02]';
            return (
              <motion.div
                key={entry.clientId}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`flex items-center gap-2 rounded-xl border p-2.5 ${colors} ${entry.isMe ? 'ring-1 ring-primary/30' : ''}`}
              >
                <div className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  i === 0 ? 'bg-amber-400/20 text-amber-300' :
                  i === 1 ? 'bg-zinc-400/20 text-zinc-300' :
                  i === 2 ? 'bg-orange-400/20 text-orange-300' :
                  'bg-white/5 text-white/40'
                }`}>
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-white/90">
                    {entry.userName}
                    {entry.isMe && <span className="ml-1 text-primary/70">({t('live.meetingYou')})</span>}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-white/50">
                    <span className="flex items-center gap-0.5"><Clock className="size-2.5" />{Math.floor(entry.focus_time / 60)}m</span>
                    <span className="flex items-center gap-0.5"><Zap className="size-2.5 text-amber-400" />{entry.points}</span>
                  </div>
                </div>
                <div className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                  entry.focus_state === 'focused' ? 'bg-emerald-500/20 text-emerald-300' :
                  entry.focus_state === 'warning' ? 'bg-amber-500/20 text-amber-300' :
                  'bg-zinc-500/20 text-zinc-400'
                }`}>
                  {entry.focus_state === 'focused' ? t('live.leaderboardFocused') :
                   entry.focus_state === 'warning' ? '⚠️' : t('live.leaderboardAway')}
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Reaction popup (floating) ───────────────────────────────────────────────
function ReactionFloat({ reactions }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex flex-wrap items-end gap-2 p-6" style={{ justifyContent: 'flex-end', alignContent: 'flex-end' }}>
      <AnimatePresence>
        {reactions.map((r) => (
          <motion.div
            key={r.ts}
            initial={{ opacity: 1, scale: 1, y: 0 }}
            animate={{ opacity: 0, scale: 1.4, y: -60 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.4, ease: 'easeOut' }}
            className="flex items-center gap-1 rounded-full border border-white/20 bg-black/70 px-3 py-1.5 text-lg backdrop-blur-md"
          >
            <span>{REACTION_EMOJI[r.reaction] || r.reaction}</span>
            <span className="text-[10px] text-white/70">{r.user_name}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Pre-join selection screen ─────────────────────────────────────────────────
function LiveModeSelectScreen({ navigate }) {
  const { t } = useI18n();
  const [selection, setSelection] = useState(null);

  if (selection === 'join') {
    return <JoinRoomScreen navigate={navigate} onBack={() => setSelection(null)} />;
  }
  if (selection === 'host') {
    return <HostScreen navigate={navigate} onBack={() => setSelection(null)} />;
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0b0b10] overflow-hidden">
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
              {' '}{t('live.badgeLive')}
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

  const handleEnterRoom = () => navigate('/live/room');

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#0b0b10]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,80,200,0.12),transparent)]" />
      <header className="relative z-10 flex items-center border-b border-white/10 bg-black/30 px-8 py-5 backdrop-blur-xl">
        <button onClick={onBack} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
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
              <div className="w-full rounded-2xl border border-border/40 bg-card/80 p-8 text-center shadow-xl backdrop-blur-xl">
                <div className="mb-2 text-sm font-medium text-muted-foreground">{t('live.inviteLabel')}</div>
                <div className="mb-4 flex items-center justify-center gap-3">
                  <span className="font-mono text-4xl font-bold tracking-widest text-foreground">{roomId}</span>
                  <button onClick={copyInviteCode} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
                    {copied ? <Check className="size-5 text-green-400" /> : <Copy className="size-5" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{t('live.inviteHint')}</p>
              </div>

              <div className="relative overflow-hidden rounded-2xl border border-border/40 shadow-2xl" style={{ width: 320, height: 240 }}>
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
                <div className={`size-1.5 rounded-full ${signalingState === 'in_room' ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
                {signalingState === 'in_room' ? t('live.roomReady') : t('live.connecting')}
                {' · '}{t('live.waiting')}
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
                <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{cameraError}</div>
              )}
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleGrantCamera}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90"
                >
                  {t('login.allowCamera')}
                </button>
                <button
                  onClick={() => { setShowPermission(false); navigate('/live/room'); }}
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
        <button onClick={onBack} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
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
              <Label htmlFor="roomCode" className="mb-2 block text-sm font-medium">{t('live.codeLabel')}</Label>
              <Input
                id="roomCode"
                value={inputCode}
                onChange={(e) => { setInputCode(e.target.value.toUpperCase()); setLocalError(''); }}
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
  const { user } = useAuth();
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
    chatMessages,
    reactions,
    focusData,
    sendChatMessage,
    sendReaction,
    sendHandRaise,
    sendFocusUpdate,
    toggleCamera,
  } = useWebRTC();

  const [copied, setCopied] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [handUp, setHandUp] = useState(false);
  const [hostToast, setHostToast] = useState(false);
  const [sidebar, setSidebar] = useState('chat'); // 'chat' | 'leaderboard'
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const localVideoRef = useRef(null);

  // Wire local focus data to room (mock for demo; real data comes from backend WS)
  const myFocus = focusData[myClientId] || {};

  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream]);

  useEffect(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((track) => { track.enabled = micOn; });
  }, [localStream, micOn]);

  useEffect(() => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach((track) => { track.enabled = camOn; });
  }, [localStream, camOn]);

  // Sync local focus data to room when it changes
  useEffect(() => {
    if (signalingState === 'in_room' && myClientId) {
      sendFocusUpdate(myFocus.focus_state || 'idle', myFocus.ear || 0, myFocus.focus_time || 0, myFocus.points || 0);
    }
  }, [signalingState, myClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyCode = () => {
    if (!myRoomId) return;
    navigator.clipboard.writeText(myRoomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleLeave = () => { leaveRoom(); navigate('/live'); };

  const handleHostMuteAllReminder = () => {
    setHostToast(true);
    setTimeout(() => setHostToast(false), 3200);
  };

  const handleHandRaise = () => {
    const next = !handUp;
    setHandUp(next);
    sendHandRaise(next);
  };

  const participantIds = Object.keys(remoteStreams);

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#0b0b10]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,80,200,0.12),transparent)]" />

      {/* Top bar */}
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/40 px-4 py-3 backdrop-blur-xl md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/30 to-cyan-500/20 ring-1 ring-white/10">
            <LayoutGrid className="size-5 text-violet-200" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-mono text-base font-semibold tracking-wide text-white md:text-lg">{myRoomId || '—'}</span>
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-500/30">
                {t('live.meetingLive')}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-white/50">
              <span className={`inline-block size-1.5 rounded-full ${signalingState === 'in_room' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
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

      {/* Main content: video grid + sidebar */}
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        {/* Video grid area */}
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4 md:p-6">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 auto-rows-fr">
            {/* Local tile */}
            <VideoTile
              stream={localStream}
              clientId={myClientId}
              userName={user?.name || t('live.meetingYou')}
              focusInfo={myFocus}
              isLocal
              isHost={isHost}
              isHandUp={handUp}
              micOn={micOn}
              camOn={camOn}
              onToggleCamera={toggleCamera}
              onRequestCamera={requestCamera}
              cameraError={cameraError}
              t={t}
            />

            {/* Remote tiles */}
            <AnimatePresence>
              {participantIds.map((cid) => {
                const stream = remoteStreams[cid];
                const p = participants.find((x) => x.client_id === cid);
                const info = focusData[cid];
                return (
                  <motion.div
                    key={cid}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    className="contents"
                  >
                    <VideoTile
                      stream={stream}
                      clientId={cid}
                      userName={p?.user_name}
                      focusInfo={info}
                      isLocal={false}
                      isHost={p?.is_host}
                      isHandUp={info?.hand_up}
                      micOn
                      camOn
                      t={t}
                    />
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
            <div className="pointer-events-none fixed bottom-32 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/10 bg-zinc-900/95 px-4 py-2 text-xs text-white/90 shadow-xl">
              {t('live.meetingMuteAllHint')} ✓
            </div>
          )}
        </main>

        {/* Right sidebar: chat + leaderboard */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="flex shrink-0 overflow-hidden"
            >
              {sidebar === 'chat' ? (
                <ChatPanel
                  messages={chatMessages}
                  onSend={sendChatMessage}
                  onClose={() => setSidebarOpen(false)}
                  isOpen
                />
              ) : (
                <LeaderboardSidebar
                  focusData={focusData}
                  myClientId={myClientId}
                  isOpen
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Sidebar toggle */}
        <button
          type="button"
          onClick={() => {
            if (sidebarOpen) {
              setSidebarOpen(false);
            } else {
              setSidebarOpen(true);
            }
          }}
          className="absolute right-4 top-4 z-20 flex size-8 items-center justify-center rounded-lg border border-white/10 bg-black/60 text-white/60 backdrop-blur-md transition-colors hover:text-white"
        >
          {sidebarOpen ? <PanelRightClose className="size-3.5" /> : <PanelRightOpen className="size-3.5" />}
        </button>

        {/* Sidebar tab switcher (only when sidebar is open) */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="absolute right-[340px] top-4 z-20 flex gap-1 rounded-xl border border-white/10 bg-black/80 p-1 backdrop-blur-md"
            >
              <button
                type="button"
                onClick={() => setSidebar('chat')}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  sidebar === 'chat' ? 'bg-primary/20 text-primary' : 'text-white/50 hover:text-white'
                }`}
              >
                <MessageSquare className="size-3.5" />
                {t('live.sidebarChat')}
              </button>
              <button
                type="button"
                onClick={() => setSidebar('leaderboard')}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  sidebar === 'leaderboard' ? 'bg-amber-500/20 text-amber-300' : 'text-white/50 hover:text-white'
                }`}
              >
                <Trophy className="size-3.5" />
                {t('live.sidebarLeaderboard')}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Reaction float overlay */}
      <ReactionFloat reactions={reactions} />

      {/* Bottom toolbar */}
      <footer className="relative z-10 border-t border-white/10 bg-black/50 px-4 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-3 md:gap-4">
          {/* Mic */}
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

          {/* Camera */}
          <button
            type="button"
            onClick={() => {
              const next = !camOn;
              setCamOn(next);
              toggleCamera(next);
            }}
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

          {/* Hand raise */}
          <button
            type="button"
            onClick={handleHandRaise}
            className={`flex size-12 items-center justify-center rounded-full border transition-all ${
              handUp
                ? 'border-amber-400 bg-amber-500/20 text-amber-300 shadow-lg shadow-amber-500/20'
                : 'border-white/15 bg-white/10 text-white/70 hover:bg-white/15 hover:text-white'
            }`}
            title={handUp ? t('live.handLowered') : t('live.handRaiseBtn')}
          >
            {handUp ? <ChevronDown className="size-5" /> : <Hand className="size-5" />}
          </button>

          {/* Reactions */}
          <div className="flex items-center gap-1">
            {REACTIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => sendReaction(r)}
                className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg transition-all hover:scale-110 hover:bg-white/10 active:scale-95"
                title={r}
              >
                {REACTION_EMOJI[r]}
              </button>
            ))}
          </div>

          {/* Leave */}
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

// ─── Root ─────────────────────────────────────────────────────────────────────
function LiveModePageInner() {
  const navigate = useNavigate();
  const location = useLocation();
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
