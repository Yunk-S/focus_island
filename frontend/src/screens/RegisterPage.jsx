import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nContext';
import { AnimatedCharacters } from '@/components/AnimatedCharacters';

function RegisterPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) return;
    setIsLoading(true);
    // TODO: connect to backend registration API
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setIsLoading(false);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <AnimatedCharacters
        isTyping={email.length > 0 || password.length > 0 || confirmPassword.length > 0}
        showPassword={showPassword || password.length > 0}
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
              <span className="text-lg font-bold text-white">R</span>
            </div>
            <span>{t('login.brand')}</span>
          </div>

          <div className="mb-10 text-center">
            <h1 className="mb-2 text-3xl font-bold tracking-tight">{t('register.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('register.subtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                {t('register.email')}
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

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">
                {t('register.password')}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 border-border/60 bg-background pr-10 focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-sm font-medium">
                {t('register.confirmPassword')}
              </Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="h-12 border-border/60 bg-background pr-10 focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showConfirm ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                </button>
              </div>
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
                  {t('register.signingUp')}
                </>
              ) : (
                t('register.signUp')
              )}
            </Button>
          </form>

          <div className="mt-8 text-center text-sm text-muted-foreground">
            {t('register.haveAccount')}{' '}
            <Link to="/login" className="cursor-default font-medium text-foreground">
              {t('register.signIn')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RegisterPage;
