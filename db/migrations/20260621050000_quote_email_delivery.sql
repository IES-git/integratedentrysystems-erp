-- Migration: Quote email delivery audit trail
-- Adds sent_at / sent_to_email to quotes and a quote_emails audit log table.

-- ── 1. Extend quotes table ────────────────────────────────────────────────────

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_to_email TEXT;

COMMENT ON COLUMN public.quotes.sent_at IS
  'Timestamp of the first successful email delivery for this quote. NULL means never sent.';
COMMENT ON COLUMN public.quotes.sent_to_email IS
  'Primary recipient email address the quote was last sent to.';

-- ── 2. Quote emails audit log ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.quote_emails (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id            UUID        NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  recipient_email     TEXT        NOT NULL,
  cc_emails           TEXT[]      NOT NULL DEFAULT '{}',
  subject             TEXT        NOT NULL,
  body                TEXT        NOT NULL,
  sent_by_user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  provider_message_id TEXT,
  status              TEXT        NOT NULL CHECK (status IN ('sent', 'failed')),
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.quote_emails IS
  'Audit log of every email send attempt for a quote, including failures.';

CREATE INDEX IF NOT EXISTS idx_quote_emails_quote_id   ON public.quote_emails(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_emails_created_at ON public.quote_emails(created_at DESC);

-- ── 3. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.quote_emails ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read any quote_email record (same policy style as quotes)
CREATE POLICY "Authenticated users can read quote emails"
  ON public.quote_emails
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Inserts are performed by the send-quote-email edge function via service-role key,
-- which bypasses RLS. No client-side INSERT policy needed.
