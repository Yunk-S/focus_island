import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n/I18nContext';
import {
  Palmtree as IslandIcon,
  LogOut,
  Video,
  Music,
  User,
  KeyRound,
  Settings,
  ChevronRight,
  ScanFace,
  Users,
  Crown,
} from 'lucide-react';

function PersonalPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const quickLinks = [
    {
      icon: <ScanFace className="size-5 text-violet-400" />,
      titleKey: 'personal.faceSetupTitle',
      descKey: 'personal.faceSetupDesc',
      path: '/face-setup',
      color: 'hover:border-violet-500/40',
    },
    {
      icon: <User className="size-5 text-primary" />,
      titleKey: 'personal.profileTitle',
      descKey: 'personal.profileDesc',
      path: '/profile',
      color: 'hover:border-primary/40',
    },
    {
      icon: <KeyRound className="size-5 text-pink-400" />,
      titleKey: 'personal.accountTitle',
      descKey: 'personal.accountDesc',
      path: '/account',
      color: 'hover:border-pink-500/40',
    },
    {
      icon: <Settings className="size-5 text-muted-foreground" />,
      titleKey: 'personal.settingsTitle',
      descKey: 'personal.settingsDesc',
      path: '/settings',
      color: 'hover:border-foreground/20',
    },
  ];

  const socialLinks = [
    {
      icon: <Users className="size-5 text-pink-400" />,
      titleKey: 'personal.friendsTitle',
      descKey: 'personal.friendsDesc',
      path: '/friends',
      color: 'hover:border-pink-500/40',
      bgColor: 'bg-pink-500/10',
    },
    {
      icon: <Crown className="size-5 text-accent-gold" />,
      titleKey: 'personal.proTitle',
      descKey: 'personal.proDesc',
      path: '/pro',
      color: 'hover:border-accent-gold/40',
      bgColor: 'bg-accent-gold/10',
    },
  ];

  const modeCards = [
    {
      icon: <Music className="size-10 text-primary" />,
      titleKey: 'personal.ambientTitle',
      subtitleKey: 'personal.ambientSub',
      descKey: 'personal.ambientDesc',
      color: 'from-purple-600/80 to-indigo-600/80',
      hoverColor: 'from-purple-600 to-indigo-600',
      path: '/ambient',
    },
    {
      icon: <Video className="size-10 text-pink-400" />,
      titleKey: 'personal.liveTitle',
      subtitleKey: 'personal.liveSub',
      descKey: 'personal.liveDesc',
      color: 'from-pink-500/80 to-rose-500/80',
      hoverColor: 'from-pink-500 to-rose-500',
      path: '/live',
    },
  ];

  return (
    <div className="fixed inset-0 flex flex-col overflow-y-auto bg-background">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute right-0 top-0 size-[500px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-0 left-0 size-[400px] rounded-full bg-pink-500/5 blur-3xl" />
      </div>

      <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 px-6 py-5 sm:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/80 to-pink-500/80">
            <IslandIcon className="size-6 text-white" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-foreground">{t('personal.title')}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="flex items-center gap-2 rounded-xl border border-border/50 px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Settings className="size-4" />
            {t('personal.settingsTitle')}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10"
          >
            <LogOut className="size-4" />
            {t('common.logout')}
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-6 pb-20 pt-4 sm:px-10">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mb-10 text-center sm:text-left"
        >
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('personal.greeting')}
            <span className="bg-gradient-to-r from-primary to-pink-400 bg-clip-text text-transparent">
              {user?.name || t('personal.explorer')}
            </span>
          </h1>
          <p className="text-muted-foreground">{t('personal.subtitle')}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.45 }}
          className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          {socialLinks.map((link, i) => (
            <motion.button
              key={link.path}
              type="button"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate(link.path)}
              className={`flex items-center gap-4 rounded-2xl border border-border/40 bg-card/70 p-5 text-left shadow-lg backdrop-blur-xl transition-all ${link.color}`}
            >
              <div className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${link.bgColor}`}>
                {link.icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">{t(link.titleKey)}</p>
                <p className="text-xs text-muted-foreground">{t(link.descKey)}</p>
              </div>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
            </motion.button>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.45 }}
          className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-4"
        >
          {quickLinks.map((link, i) => (
            <motion.button
              key={link.path}
              type="button"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate(link.path)}
              className={`flex items-center gap-4 rounded-2xl border border-border/40 bg-card/70 p-5 text-left shadow-lg backdrop-blur-xl transition-all ${link.color}`}
            >
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted/50">
                {link.icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">{t(link.titleKey)}</p>
                <p className="text-xs text-muted-foreground">{t(link.descKey)}</p>
              </div>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
            </motion.button>
          ))}
        </motion.div>

        <p className="mb-4 text-sm font-medium text-muted-foreground">{t('personal.ambientTitle')} / {t('personal.liveTitle')}</p>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {modeCards.map((card, i) => (
            <motion.button
              key={card.path}
              type="button"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.08 }}
              whileHover={{ scale: 1.02, y: -3 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => navigate(card.path)}
              className="group relative flex flex-col items-start overflow-hidden rounded-2xl border border-border/40 bg-card/60 p-8 text-left shadow-xl backdrop-blur-xl transition-shadow hover:border-primary/30 hover:shadow-2xl"
            >
              <div
                className={`absolute inset-0 bg-gradient-to-br ${card.color} opacity-15 transition-opacity group-hover:opacity-25`}
              />
              <div className="relative mb-5 flex size-16 items-center justify-center rounded-2xl bg-muted/60">
                {card.icon}
              </div>
              <div className="relative mb-1">
                <h2 className="text-2xl font-bold text-foreground">{t(card.titleKey)}</h2>
                <p className="text-sm font-medium text-primary/90">{t(card.subtitleKey)}</p>
              </div>
              <p className="relative text-sm leading-relaxed text-muted-foreground">{t(card.descKey)}</p>
              <div className="relative mt-6 flex items-center gap-2 text-sm font-medium text-primary transition-all group-hover:gap-3">
                <span>{t('personal.enter')}</span>
                <ChevronRight className="size-4" />
              </div>
              <div className={`absolute bottom-0 left-0 h-1 w-0 bg-gradient-to-r ${card.hoverColor} transition-all duration-500 group-hover:w-full`} />
            </motion.button>
          ))}
        </div>

        <p className="mt-12 text-center text-xs text-muted-foreground/70">{t('personal.tip')}</p>
      </main>
    </div>
  );
}

export default PersonalPage;
