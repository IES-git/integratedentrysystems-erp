import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import iesLogo from '@/assets/ies-logo.png';

type PageState = 'waiting' | 'ready' | 'success' | 'invalid';

export default function AcceptInvitePage() {
  const [pageState, setPageState] = useState<PageState>('waiting');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Supabase embeds the invite token in the URL hash and fires SIGNED_IN
    // (with type=invite) after exchanging the token automatically.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setPageState('ready');
      }
    });

    // If the user lands here already authenticated via the invite link
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setPageState('ready');
      else if (pageState === 'waiting') {
        // Give the URL hash token a moment to be consumed
        setTimeout(() => {
          supabase.auth.getSession().then(({ data: { session: s } }) => {
            if (!s) setPageState('invalid');
          });
        }, 2000);
      }
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast({ title: 'Failed to set password', description: error.message, variant: 'destructive' });
        return;
      }
      setPageState('success');
      toast({ title: 'Password set!', description: 'Welcome to IES.' });
      setTimeout(() => navigate('/app', { replace: true }), 1500);
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
            <h1 className="text-2xl font-semibold">Welcome to IES</h1>
            <CardDescription className="mt-2">
              {pageState === 'waiting' && 'Verifying your invitation...'}
              {pageState === 'ready' && 'Create your password to get started.'}
              {pageState === 'success' && 'All set! Redirecting you now...'}
              {pageState === 'invalid' && 'This invite link is invalid or has expired.'}
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
                <Label htmlFor="password">Password</Label>
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
                {isSubmitting ? 'Setting password...' : 'Set Password & Sign In'}
              </Button>
            </form>
          )}

          {pageState === 'invalid' && (
            <div className="py-4 text-center">
              <p className="mb-4 text-sm text-muted-foreground">
                Please ask an administrator to resend your invitation.
              </p>
              <Button variant="outline" onClick={() => navigate('/login')}>
                Go to Login
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
