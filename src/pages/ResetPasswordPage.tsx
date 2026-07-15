import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import iesLogo from '@/assets/ies-logo.png';

type PageState = 'waiting' | 'ready' | 'success' | 'invalid';

export function hasPasswordRecoverySignal(url: string): boolean {
  const parsed = new URL(url);
  const query = parsed.searchParams;
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  return query.get('type') === 'recovery'
    || hash.get('type') === 'recovery'
    || query.has('code')
    || hash.has('access_token');
}

export default function ResetPasswordPage() {
  const [pageState, setPageState] = useState<PageState>('waiting');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { resetPassword } = useAuth();

  useEffect(() => {
    let active = true;
    const recoverySignal = hasPasswordRecoverySignal(window.location.href);
    // Supabase fires PASSWORD_RECOVERY when the user arrives via the reset link
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (active && event === 'PASSWORD_RECOVERY') {
        setPageState('ready');
      }
    });

    // On slower browsers the global auth provider may process the URL before
    // this page subscribes. Accept an already-established recovery session only
    // when the URL itself carries a recovery/code signal.
    if (recoverySignal) {
      void supabase.auth.getSession().then(({ data }) => {
        if (active && data.session) setPageState('ready');
      });
    }

    // Timeout: if no PASSWORD_RECOVERY event fires, the link is invalid/expired
    const timeout = setTimeout(() => {
      setPageState((current) => (current === 'waiting' ? 'invalid' : current));
    }, 10000);

    return () => {
      active = false;
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    if (password.length < 8) {
      toast({ title: 'Password must be at least 8 characters', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await resetPassword(password);
      if (result.error) {
        toast({ title: 'Failed to reset password', description: result.error, variant: 'destructive' });
        return;
      }
      setPageState('success');
      toast({ title: 'Password updated!', description: 'Redirecting you to login...' });
      setTimeout(() => navigate('/login', { replace: true }), 1500);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4 text-center">
          <div className="flex justify-center">
            <img src={iesLogo} alt="IES Logo" className="h-20 w-auto" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">New Password</h1>
            <CardDescription className="mt-2">
              {pageState === 'waiting' && 'Verifying your reset link...'}
              {pageState === 'ready' && 'Choose a new password for your account.'}
              {pageState === 'success' && 'Password updated! Redirecting...'}
              {pageState === 'invalid' && 'This reset link is invalid or has expired.'}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {pageState === 'waiting' && (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}

          {pageState === 'ready' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Updating...' : 'Update Password'}
              </Button>
            </form>
          )}

          {pageState === 'invalid' && (
            <div className="py-4 text-center">
              <p className="mb-4 text-sm text-muted-foreground">
                Please request a new password reset from the login page.
              </p>
              <Button variant="outline" onClick={() => navigate('/forgot-password')}>
                Request New Link
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
