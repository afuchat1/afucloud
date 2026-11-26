import { useEffect, useState } from 'react';
import { Link, useLocation } from '@/lib/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { useToast } from '@/hooks/use-toast';
import { AlertCircle, CheckCircle2, MailCheck } from 'lucide-react';
import { AuthHeader } from '@/components/auth-header';
import { authHrefWithCurrentIntent, dashboardSessionRequest, postAuthDestination } from '@/lib/auth-session';

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [canResendConfirmation, setCanResendConfirmation] = useState(false);
  const [isResendingConfirmation, setIsResendingConfirmation] = useState(false);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [registerHref, setRegisterHref] = useState('/register');

  useEffect(() => {
    setRegisterHref(authHrefWithCurrentIntent('/register'));
    setEmailConfirmed(new URLSearchParams(window.location.search).get('confirmed') === '1');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    setIsSubmitting(true);
    setLoginError(null);
    setCanResendConfirmation(false);
    try {
      await dashboardSessionRequest('login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      queryClient.clear();
      toast({ title: 'Welcome back', description: 'Successfully logged in' });
      setLocation(postAuthDestination());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid email or password';
      setLoginError(message);
      setCanResendConfirmation(/confirm your email address/i.test(message));
      toast({
        title: 'Login failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendConfirmation = async () => {
    setIsResendingConfirmation(true);
    try {
      await dashboardSessionRequest('resend-confirmation', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      toast({
        title: 'Confirmation email requested',
        description: 'If this account needs verification, a new email is on its way.',
      });
    } catch (error) {
      toast({
        title: 'Could not resend email',
        description: error instanceof Error ? error.message : 'Please try again shortly.',
        variant: 'destructive',
      });
    } finally {
      setIsResendingConfirmation(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col lg:flex-row">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary p-12 flex-col justify-center">
        <div className="space-y-4 max-w-md">
          <h2 className="text-3xl font-semibold text-primary-foreground">
            Image delivery for developers
          </h2>
          <p className="text-base text-primary-foreground/80">
            Upload, manage, and deliver images through one API.
          </p>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-sm space-y-6">
          <AuthHeader />
          <div className="space-y-2 text-center lg:text-left">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in to your account</h1>
            <p className="text-sm text-muted-foreground">
              Enter your credentials to access the platform
            </p>
          </div>

          {emailConfirmed && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-foreground" role="status">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>Your email is confirmed. Sign in to continue to AfuCloud.</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isSubmitting}
                data-testid="input-email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isSubmitting}
                data-testid="input-password"
              />
            </div>

            {loginError && (
              <div className="space-y-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{loginError}</span>
                </div>
                {canResendConfirmation && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={handleResendConfirmation}
                    disabled={isResendingConfirmation || !email}
                  >
                    <MailCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                    {isResendingConfirmation ? 'Sending email...' : 'Resend confirmation email'}
                  </Button>
                )}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting}
              data-testid="button-submit"
            >
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <div className="text-center text-sm">
            <span className="text-muted-foreground">Don't have an account? </span>
            <Link href={registerHref} className="font-medium text-primary hover:underline" data-testid="link-register">
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
