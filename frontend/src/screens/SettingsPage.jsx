import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Volume2, Mic } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { Label } from '@/components/ui/label';

function SliderControl({ label, hint, value, onChange, icon: Icon, colorClass }) {
  return (
    <div className="flex items-center gap-4">
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${colorClass}`}>
        <Icon className="size-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex items-center gap-3 w-36">
        <input
          type="range"
          min="0"
          max="100"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 h-2 rounded-full appearance-none bg-muted cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4
            [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-primary
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:shadow-md
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb]:hover:scale-110"
          style={{
            background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${value}%, var(--muted) ${value}%, var(--muted) 100%)`,
          }}
        />
        <span className="w-8 text-right text-sm font-medium text-muted-foreground">{value}</span>
      </div>
    </div>
  );
}

function SettingsPage() {
  const navigate = useNavigate();
  const { t, locale, setLocale } = useI18n();
  const [notifOn, setNotifOn] = useState(true);
  const [soundOn, setSoundOn] = useState(false);
  const [masterVolume, setMasterVolume] = useState(80);
  const [micVolume, setMicVolume] = useState(70);

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
        className="mx-auto max-w-lg space-y-8"
      >
        <h1 className="text-2xl font-bold text-foreground">{t('settings.title')}</h1>

        <div className="space-y-3 rounded-2xl border border-border/40 bg-card/60 p-6 backdrop-blur-xl">
          <Label className="text-base font-medium">{t('settings.language')}</Label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setLocale('zh')}
              className={`flex-1 rounded-xl border py-3 text-sm font-medium transition-colors ${
                locale === 'zh'
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border/60 text-muted-foreground hover:bg-muted'
              }`}
            >
              {t('settings.zh')}
            </button>
            <button
              type="button"
              onClick={() => setLocale('en')}
              className={`flex-1 rounded-xl border py-3 text-sm font-medium transition-colors ${
                locale === 'en'
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border/60 text-muted-foreground hover:bg-muted'
              }`}
            >
              {t('settings.en')}
            </button>
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-border/40 bg-card/60 p-6 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-foreground">{t('settings.notifications')}</p>
              <p className="text-xs text-muted-foreground">{t('settings.notificationsHint')}</p>
            </div>
            <button
              type="button"
              onClick={() => setNotifOn(!notifOn)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${notifOn ? 'bg-primary' : 'bg-muted'}`}
            >
              <span
                className={`absolute top-1 size-5 rounded-full bg-white transition-all ${notifOn ? 'right-1' : 'left-1'}`}
              />
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border/30 pt-4">
            <div>
              <p className="font-medium text-foreground">{t('settings.sound')}</p>
              <p className="text-xs text-muted-foreground">{t('settings.soundHint')}</p>
            </div>
            <button
              type="button"
              onClick={() => setSoundOn(!soundOn)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${soundOn ? 'bg-primary' : 'bg-muted'}`}
            >
              <span
                className={`absolute top-1 size-5 rounded-full bg-white transition-all ${soundOn ? 'right-1' : 'left-1'}`}
              />
            </button>
          </div>
        </div>

        <div className="space-y-5 rounded-2xl border border-border/40 bg-card/60 p-6 backdrop-blur-xl">
          <Label className="text-base font-medium">{t('settings.volume')}</Label>
          <div className="space-y-5">
            <SliderControl
              label={t('settings.volume')}
              hint={t('settings.volumeHint')}
              value={masterVolume}
              onChange={setMasterVolume}
              icon={Volume2}
              colorClass="bg-primary/15 text-primary"
            />
            <div className="border-t border-border/30" />
            <SliderControl
              label={t('settings.microphone')}
              hint={t('settings.microphoneHint')}
              value={micVolume}
              onChange={setMicVolume}
              icon={Mic}
              colorClass="bg-accent-mint/15 text-accent-mint"
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default SettingsPage;
