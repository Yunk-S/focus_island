import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Copy, Check, User } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n/I18nContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function generateUniqueId() {
  const segments = [4, 4, 4];
  return 'FI-' + segments.map((len) => {
    let result = '';
    for (let i = 0; i < len; i++) {
      result += Math.floor(Math.random() * 10);
    }
    return result;
  }).join('-');
}

function AccountPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user, updateUser, clearLocalAccount } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const uniqueId = useMemo(() => {
    if (user?.uniqueId) return user.uniqueId;
    return generateUniqueId();
  }, [user?.id]);

  if (!user) {
    navigate('/login');
    return null;
  }

  const handleSave = () => {
    updateUser({ name: name.trim() || user.name, email: email.trim() || user.email, uniqueId });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(uniqueId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

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
        className="mx-auto max-w-lg space-y-6"
      >
        <h1 className="text-2xl font-bold text-foreground">{t('account.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('account.hint')}</p>

        <div className="space-y-4 rounded-2xl border border-border/40 bg-card/60 p-6 backdrop-blur-xl">
          <div className="space-y-2">
            <Label htmlFor="acc-name">{t('account.displayName')}</Label>
            <Input
              id="acc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="acc-email">{t('account.email')}</Label>
            <Input
              id="acc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-2 border-t border-border/30 pt-4">
            <Label>{t('account.uniqueId')}</Label>
            <div className="flex items-center gap-3">
              <div className="flex flex-1 items-center gap-3 rounded-xl border border-border/40 bg-muted/30 px-4 py-3">
                <User className="size-4 text-primary shrink-0" />
                <span className="font-mono font-semibold text-foreground tracking-wider">{uniqueId}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyId}
                className="shrink-0 gap-2"
              >
                {copied ? (
                  <>
                    <Check className="size-4 text-green-500" />
                    <span className="text-green-500">{t('account.idCopied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-4" />
                    <span>{t('account.copyId')}</span>
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('account.uniqueIdHint')}</p>
          </div>
          {saved && <p className="text-sm text-green-500">{t('account.saved')}</p>}
          <Button type="button" className="w-full" onClick={handleSave}>
            {t('account.save')}
          </Button>
        </div>

        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
          <h2 className="mb-2 font-semibold text-red-400">{t('account.danger')}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{t('account.deleteHint')}</p>
          <Button
            type="button"
            variant="destructive"
            className="w-full"
            onClick={() => {
              clearLocalAccount();
              navigate('/login');
            }}
          >
            {t('account.deleteBtn')}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

export default AccountPage;
