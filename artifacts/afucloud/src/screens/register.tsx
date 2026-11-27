import { useEffect, useState } from 'react';
import { Link, useLocation } from '@/lib/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { useToast } from '@/hooks/use-toast';
import { AlertCircle, MailCheck } from 'lucide-react';
import { AuthHeader } from '@/components/auth-header';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { authHrefWithCurrentIntent, dashboardSessionRequest, postAuthDestination } from '@/lib/auth-session';

function confirmationMayHaveBeenSent(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; data?: unknown };
  if (candidate.status !== 503 || !candidate.data || typeof candidate.data !== 'object') return false;
  return (candidate.data as { confirmationMayHaveBeenSent?: unknown }).confirmationMayHaveBeenSent === true;
}

export default function RegisterPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResendingConfirmation, setIsResendingConfirmation] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const [confirmationMayBeSent, setConfirmationMayBeSent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [loginHref, setLoginHref] = useState('/login');

  useEffect(() => {
    setLoginHref(authHrefWithCurrentIntent('/login'));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!turnstileToken) {
      setRegisterError('Complete Cloudflare human verification before creating an account.');
      return;
    }

    if (password.length < 8) {
      toast({
        title: 'Invalid password',
        description: 'Password must be at least 8 characters',
        variant: 'destructive',
      });
      return;
    }
    
    setIsSubmitting(true);
    setRegisterError(null);
    setConfirmationMayBeSent(false);
    try {
      const result = await dashboardSessionRequest<{ confirmationRequired?: boolean; email?: string }>('register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, turnstileToken }),
      });
      queryClient.clear();
      if (result.confirmationRequired) {
        setConfirmationEmail(result.email ?? email.trim().toLowerCase());
        setConfirmationMayBeSent(false);
        return;
      }
      toast({ title: 'Account created', description: 'Welcome to AfuCloud' });
      setLocation(postAuthDestination());
    } catch (error) {
      if (confirmationMayHaveBeenSent(error)) {
        setConfirmationEmail(email.trim().toLowerCase());
        setConfirmationMayBeSent(true);
        toast({
          title: 'Check your email',
          description: 'Your signup may have completed. If no confirmation arrived, request another email below.',
        });
        return;
      }
      const message = error instanceof Error ? error.message : 'Please try again';
      setRegisterError(message);
      toast({ title: 'Registration failed', description: message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
      setTurnstileToken(null);
      setTurnstileResetSignal((signal) => signal + 1);
    }
  };

  const handleResendConfirmation = async () => {
    if (!confirmationEmail || !turnstileToken) return;
    setIsResendingConfirmation(true);
    try {
      await dashboardSessionRequest('resend-confirmation', {
        method: 'POST',
        body: JSON.stringify({ email: confirmationEmail, turnstileToken }),
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
      setTurnstileToken(null);
      setTurnstileResetSignal((signal) => signal + 1);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col lg:flex-row">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary p-12 flex-col justify-center">
        <div className="space-y-4 max-w-md">
          <h2 className="text-3xl font-semibold text-primary-foreground">
            Start with image delivery
          </h2>
          <p className="text-base text-primary-foreground/80">
            Create a project and ship your first upload.
          </p>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-sm space-y-6">
          <AuthHeader />
          {confirmationEmail ? (
            <div className="space-y-5 text-center lg:text-left" role="status" aria-live="polite">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MailCheck className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
                <p className="text-sm leading-6 text-muted-foreground">
                  {confirmationMayBeSent
                    ? 'Your signup may have completed. If you received a confirmation email, follow its link. If not, request another below.'
                    : 'We sent an AfuCloud confirmation link to '}
                  {!confirmationMayBeSent && (
                    <>
                      <strong className="font-medium text-foreground">{confirmationEmail}</strong>.
                      {' '}Confirm your address before signing in.
                    </>
                  )}
                </p>
              </div>
              <TurnstileWidget
                action="afu_resend"
                onToken={setTurnstileToken}
                resetSignal={turnstileResetSignal}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleResendConfirmation}
                disabled={isResendingConfirmation || !turnstileToken}
              >
                {isResendingConfirmation ? 'Sending email...' : 'Resend confirmation email'}
              </Button>
              <p className="text-sm text-muted-foreground">
                Already confirmed?{' '}
                <Link href={loginHref} className="font-medium text-primary hover:underline">
                  Sign in
                </Link>
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2 text-center lg:text-left">
                <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
                <p className="text-sm text-muted-foreground">
                  Get started with AfuCloud today
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                autoComplete="name"
                placeholder="Alex Chen"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={isSubmitting}
                data-testid="input-name"
              />
            </div>

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
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isSubmitting}
                data-testid="input-password"
              />
              <p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
            </div>

            <TurnstileWidget
              action="afu_register"
              onToken={setTurnstileToken}
              resetSignal={turnstileResetSignal}
            />

            {registerError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{registerError}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || !turnstileToken}
              data-testid="button-submit"
            >
              {isSubmitting ? 'Creating account...' : 'Create account'}
            </Button>
              </form>

              <div className="text-center text-sm">
                <span className="text-muted-foreground">Already have an account? </span>
                <Link href={loginHref} className="font-medium text-primary hover:underline" data-testid="link-login">
                  Sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
