import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Mail } from 'lucide-react';
import { useI18n } from '@/i18n/I18nContext';
import { AnimatedCharacters } from '@/components/AnimatedCharacters';

function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    // TODO: connect to backend reset password API
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setSent(true);
    setIsLoading(false);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <AnimatedCharacters
        isTyping={email.length > 0}
        brandLabel={t('login.brand')}
        footerLinks={[
          { text: t('register.privacyPolicy'), onClick: () => {} },
          { text: t('register.terms'), onClick: () => {} },
          { text: t('register.contact'), onClick: () => {} },
        ]}
      />

      <div className="flex items-center justify-center bg-background p-8">
        <div className="w-full max-w-[420px]">
          <div className="mb-12 flex items-center justify-center gap-2 text-lg font-semibold lg:hidden">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/80 to-pink-500/80">
              <Mail className="size-6 text-white" />
            </div>
            <span>{t('login.brand')}</span>
          </div>

          <div className="mb-10 text-center">
            <h1 className="mb-2 text-3xl font-bold tracking-tight">{t('forgotPassword.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('forgotPassword.subtitle')}</p>
          </div>

          {sent ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
              <p className="mb-2 text-sm font-medium text-emerald-300">
                {t('forgotPassword.sendBtn')} ✓
              </p>
              <p className="text-xs text-emerald-400/70">{email}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  {t('forgotPassword.email')}
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="alex@focusisland.com"
                  value={email}
                  autoComplete="email"
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12 border-border/60 bg-background focus:border-primary"
                />
              </div>

              <Button
                type="submit"
                className="h-12 w-full text-base font-medium"
                size="lg"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {t('forgotPassword.sending')}
                  </>
                ) : (
                  t('forgotPassword.sendBtn')
                )}
              </Button>
            </form>
          )}

          <div className="mt-8 text-center">
            <Link
              to="/login"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {t('forgotPassword.backToLogin')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ForgotPasswordPage;
