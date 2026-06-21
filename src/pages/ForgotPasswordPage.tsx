import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import iesLogo from '@/assets/ies-logo.png';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { forgotPassword } = useAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const result = await forgotPassword(email);
      if (result.success) {
        setSent(true);
      } else {
        toast({
          title: 'Something went wrong',
          description: result.error ?? 'Please try again.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="relative space-y-4 text-center">
          <Button variant="ghost" size="icon" className="absolute left-4 top-4" asChild>
            <Link to="/login">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex justify-center">
            <img src={iesLogo} alt="IES Logo" className="h-20 w-auto" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Reset Password</h1>
            <CardDescription className="mt-2">
              {sent
                ? 'Check your email for the reset link.'
                : "Enter your email and we'll send you a reset link."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <CheckCircle className="h-12 w-12 text-green-500" />
              <p className="text-sm text-muted-foreground">
                If an account exists for <strong>{email}</strong>, you'll receive a password reset
                email shortly. Check your spam folder if you don't see it.
              </p>
              <Button variant="outline" asChild>
                <Link to="/login">Back to Login</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@integratedentrysystems.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Sending...' : 'Send Reset Link'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
