import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, User } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n/I18nContext';

function ProfilePage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user } = useAuth();

  if (!user) {
    navigate('/login');
    return null;
  }

  return (
    <div className="min-h-screen bg-background px-6 py-8 sm:px-10">
      <button
        type="button"
        onClick={() => navigate('/personal')}
        className="mb-8 flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('common.backHome')}
      </button>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-lg"
      >
        <div className="mb-8 flex items-center gap-4">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/15">
            <User className="size-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t('profile.title')}</h1>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-border/40 bg-card/60 p-6 backdrop-blur-xl">
          <div className="flex justify-between border-b border-border/30 py-3">
            <span className="text-muted-foreground">{t('profile.email')}</span>
            <span className="font-medium text-foreground">{user.email}</span>
          </div>
          <div className="flex justify-between border-b border-border/30 py-3">
            <span className="text-muted-foreground">{t('profile.level')}</span>
            <span className="font-medium text-foreground">{user.level ?? 1}</span>
          </div>
          <div className="flex justify-between border-b border-border/30 py-3">
            <span className="text-muted-foreground">{t('profile.points')}</span>
            <span className="font-medium text-accent-gold">{user.totalPoints ?? 0}</span>
          </div>
          <div className="flex justify-between py-3">
            <span className="text-muted-foreground">{t('profile.streak')}</span>
            <span className="font-medium text-foreground">{user.streak ?? 0}</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default ProfilePage;
