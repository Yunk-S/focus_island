import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Crown,
  Check,
  Star,
  Gift,
  Clock,
  Sparkles,
  MessageSquare,
  Zap,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { Button } from '@/components/ui/button';

const PRICING_PLANS = [
  {
    id: 'monthly',
    nameKey: 'pro.monthly',
    descKey: 'pro.monthlyDesc',
    price: 10,
    period: 'month',
    priceKey: 'pro.perMonth',
  },
  {
    id: 'yearly',
    nameKey: 'pro.yearly',
    descKey: 'pro.yearlyDesc',
    price: 100,
    period: 'year',
    priceKey: 'pro.perYear',
    badge: 'Best Value',
    badgeColor: 'bg-accent-gold/20 text-accent-gold',
  },
  {
    id: 'monthly_sub',
    nameKey: 'pro.monthlySub',
    descKey: 'pro.monthlySubDesc',
    price: 8,
    period: 'month',
    priceKey: 'pro.perMonth',
    tag: 'Auto-renew',
    tagColor: 'bg-primary/15 text-primary',
  },
  {
    id: 'yearly_sub',
    nameKey: 'pro.yearlySub',
    descKey: 'pro.yearlySubDesc',
    price: 90,
    period: 'year',
    priceKey: 'pro.perYear',
    tag: 'Auto-renew',
    tagColor: 'bg-accent-mint/15 text-accent-mint',
  },
];

const BENEFITS = [
  {
    icon: Clock,
    iconBg: 'bg-blue-500/15',
    iconColor: 'text-blue-400',
    titleKey: 'pro.benefitExtended',
    descKey: 'pro.benefitExtendedDesc',
  },
  {
    icon: Sparkles,
    iconBg: 'bg-pink-500/15',
    iconColor: 'text-pink-400',
    titleKey: 'pro.benefitBanner',
    descKey: 'pro.benefitBannerDesc',
  },
  {
    icon: Gift,
    iconBg: 'bg-accent-gold/15',
    iconColor: 'text-accent-gold',
    titleKey: 'pro.benefitCheckin',
    descKey: 'pro.benefitCheckinDesc',
  },
  {
    icon: MessageSquare,
    iconBg: 'bg-gradient-to-br from-primary/15 to-pink-500/15',
    iconColor: 'text-primary',
    titleKey: 'pro.benefitBubble',
    descKey: 'pro.benefitBubbleDesc',
  },
];

function ProPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [isPro] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [points] = useState(580);

  const handleSubscribe = (plan) => {
    setSelectedPlan(plan.id);
    // In real app, trigger payment flow
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-border/30">
        <button
          type="button"
          onClick={() => navigate('/personal')}
          className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t('common.backHome')}
        </button>
        <h1 className="text-xl font-bold text-foreground">{t('pro.title')}</h1>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 space-y-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-3"
        >
          <div className="inline-flex items-center justify-center size-16 rounded-2xl bg-gradient-to-br from-accent-gold/20 to-orange-500/20 mb-2">
            <Crown className="size-8 text-accent-gold" />
          </div>
          <h2 className="text-2xl font-bold text-foreground">{t('pro.title')}</h2>
          <p className="text-muted-foreground">{t('pro.subtitle')}</p>
        </motion.div>

        {isPro ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-accent-gold/30 bg-gradient-to-br from-accent-gold/10 to-orange-500/10 p-8 text-center"
          >
            <div className="inline-flex items-center gap-2 mb-4">
              <Crown className="size-6 text-accent-gold" />
              <span className="text-xl font-bold text-accent-gold">{t('pro.membership')}</span>
            </div>
            <p className="text-muted-foreground mb-6">{t('pro.thankYou')}</p>
            <div className="flex items-center justify-center gap-8">
              <div className="text-center">
                <Star className="size-6 text-accent-gold mx-auto mb-1" />
                <p className="text-2xl font-bold text-foreground">{points}</p>
                <p className="text-xs text-muted-foreground">{t('pro.points')}</p>
              </div>
              <div className="text-center">
                <Gift className="size-6 text-accent-mint mx-auto mb-1" />
                <Button type="button" variant="outline" className="mt-1 gap-2">
                  <Gift className="size-4" />
                  {t('pro.redeem')}
                </Button>
              </div>
            </div>
          </motion.div>
        ) : (
          <>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.1 } }}
              className="space-y-4"
            >
              <h3 className="text-lg font-semibold text-foreground">{t('pro.pricing')}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {PRICING_PLANS.map((plan, i) => (
                  <motion.div
                    key={plan.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: 0.1 + i * 0.05 } }}
                    className={`relative rounded-2xl border p-5 transition-all cursor-pointer ${
                      selectedPlan === plan.id
                        ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
                        : 'border-border/40 bg-card/60 hover:border-primary/40 hover:bg-card/80'
                    }`}
                    onClick={() => setSelectedPlan(plan.id)}
                  >
                    {plan.badge && (
                      <span className={`absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-xs font-medium ${plan.badgeColor}`}>
                        {plan.badge}
                      </span>
                    )}
                    {plan.tag && (
                      <span className={`absolute -top-2.5 right-2 px-2 py-0.5 rounded-full text-[10px] font-medium ${plan.tagColor}`}>
                        {plan.tag}
                      </span>
                    )}
                    <h4 className="font-semibold text-foreground mb-1">{t(plan.nameKey)}</h4>
                    <p className="text-xs text-muted-foreground mb-3">{t(plan.descKey, { price: plan.id === 'yearly' ? '8.33' : plan.price })}</p>
                    <p className="text-2xl font-bold text-foreground">
                      {t(plan.priceKey, { price: plan.price })}
                    </p>
                    {selectedPlan === plan.id && (
                      <div className="absolute top-3 right-3 size-5 rounded-full bg-primary flex items-center justify-center">
                        <Check className="size-3 text-white" />
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
              <div className="text-center pt-2">
                <Button
                  type="button"
                  size="lg"
                  disabled={!selectedPlan}
                  onClick={() => selectedPlan && handleSubscribe(selectedPlan)}
                  className="px-10 gap-2 bg-gradient-to-r from-accent-gold to-orange-500 hover:from-accent-gold/90 hover:to-orange-500/90"
                >
                  <Crown className="size-5" />
                  {t('pro.subscribe')}
                </Button>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.2 } }}
              className="space-y-4"
            >
              <h3 className="text-lg font-semibold text-foreground">{t('pro.benefits')}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {BENEFITS.map((benefit, i) => (
                  <motion.div
                    key={benefit.titleKey}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: 0.25 + i * 0.05 } }}
                    className="flex items-start gap-4 rounded-2xl border border-border/40 bg-card/60 p-5"
                  >
                    <div className={`size-10 rounded-xl ${benefit.iconBg} flex items-center justify-center shrink-0`}>
                      <benefit.icon className={`size-5 ${benefit.iconColor}`} />
                    </div>
                    <div>
                      <h4 className="font-medium text-foreground mb-1">{t(benefit.titleKey)}</h4>
                      <p className="text-sm text-muted-foreground leading-relaxed">{t(benefit.descKey)}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </main>
    </div>
  );
}

export default ProPage;
