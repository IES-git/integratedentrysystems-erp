import { describe, expect, it } from 'vitest';
import { hasPasswordRecoverySignal } from '@/pages/ResetPasswordPage';

describe('password recovery URL detection', () => {
  it('recognizes PKCE and hash-based recovery links', () => {
    expect(hasPasswordRecoverySignal('https://app.example/reset-password?code=abc')).toBe(true);
    expect(hasPasswordRecoverySignal('https://app.example/reset-password#type=recovery&access_token=abc')).toBe(true);
  });

  it('does not treat an ordinary reset route as a valid recovery link', () => {
    expect(hasPasswordRecoverySignal('https://app.example/reset-password')).toBe(false);
  });
});
