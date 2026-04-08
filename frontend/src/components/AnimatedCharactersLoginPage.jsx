import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Eye, EyeOff, Mail } from 'lucide-react';
import { Palmtree as IslandIcon } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/i18n/I18nContext';
import { AnimatedCharacters } from './AnimatedCharacters';

function LoginPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { login, isLoading, error: authError } = useAuth();

  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const isTyping = email.length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await login(email, password || 'demo');
      navigate('/face-setup');
    } catch {
      /* error surfaced via useAuth */
    }
  };

  const handleDemoLogin = async () => {
    try {
      await login('alex@focusisland.com', 'demo');
      navigate('/face-setup');
    } catch {
      /* error surfaced via useAuth */
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <AnimatedCharacters
        isTyping={isTyping}
        showPassword={showPassword}
      />

      <div className="flex items-center justify-center bg-background p-8">
        <div className="w-full max-w-[420px]">
          <div className="mb-12 flex items-center justify-center gap-2 text-lg font-semibold lg:hidden">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/80 to-pink-500/80">
              <IslandIcon className="size-6 text-white" />
            </div>
            <span>{t('login.brand')}</span>
          </div>

          <div className="mb-10 text-center">
            <h1 className="mb-2 text-3xl font-bold tracking-tight">{t('login.welcome')}</h1>
            <p className="text-sm text-muted-foreground">{t('login.subtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                {t('login.email')}
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
                {t('login.password')}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-12 bg-background pr-10 border-border/60 focus:border-primary"
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

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox id="remember" />
                <Label htmlFor="remember" className="cursor-pointer text-sm font-normal">
                  {t('login.remember')}
                </Label>
              </div>
              <Link to="/forgot-password" className="cursor-default text-sm font-medium text-primary">{t('login.forgot')}</Link>
            </div>

            {authError && (
              <div className="rounded-lg border border-red-900/30 bg-red-950/20 p-3 text-sm text-red-400">
                {authError === 'Invalid credentials' ? t('login.invalidCreds') : authError}
              </div>
            )}

            <Button type="submit" className="h-12 w-full text-base font-medium" size="lg" disabled={isLoading}>
              {isLoading ? t('login.signingIn') : t('login.signIn')}
            </Button>
          </form>

          <div className="mt-6 space-y-3">
            <Button
              variant="outline"
              className="h-12 w-full border-border/60 bg-background hover:bg-accent"
              type="button"
              onClick={handleDemoLogin}
              disabled={isLoading}
            >
              <IslandIcon className="mr-2 size-5" />
              {t('login.demoAccount')}
            </Button>
            <Button
              variant="outline"
              className="h-12 w-full border-border/60 bg-background hover:bg-accent"
              type="button"
              onClick={() => {}}
            >
              <Mail className="mr-2 size-5" />
              {t('login.google')}
            </Button>
          </div>

          <div className="mt-8 text-center text-sm text-muted-foreground">
            {t('login.noAccount')}{' '}
            <Link to="/register" className="cursor-default font-medium text-foreground">{t('login.signUp')}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
export { LoginPage as AnimatedCharactersLoginPage };
