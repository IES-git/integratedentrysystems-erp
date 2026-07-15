-- Customer-facing quote acknowledgement plus the first durable operations
-- workflow. Public access is token-scoped through SECURITY DEFINER RPCs; no
-- quote cost/net/margin fields are exposed.

CREATE TABLE IF NOT EXISTS public.quote_approval_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  recipient_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  responded_at TIMESTAMPTZ,
  customer_name TEXT,
  customer_comment TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_approval_quote ON public.quote_approval_request(quote_id, created_at DESC);
ALTER TABLE public.quote_approval_request ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quote_approval_auth_all ON public.quote_approval_request;
CREATE POLICY quote_approval_auth_all ON public.quote_approval_request
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
DROP TRIGGER IF EXISTS set_quote_approval_updated_at ON public.quote_approval_request;
CREATE TRIGGER set_quote_approval_updated_at BEFORE UPDATE ON public.quote_approval_request
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS public.quote_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL UNIQUE REFERENCES public.quotes(id) ON DELETE CASCADE,
  procurement_status TEXT NOT NULL DEFAULT 'not_started',
  receiving_status TEXT NOT NULL DEFAULT 'not_started',
  staging_status TEXT NOT NULL DEFAULT 'not_started',
  fulfillment_status TEXT NOT NULL DEFAULT 'not_started',
  procurement_completed_at TIMESTAMPTZ,
  receiving_completed_at TIMESTAMPTZ,
  staging_completed_at TIMESTAMPTZ,
  fulfillment_completed_at TIMESTAMPTZ,
  notes TEXT,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quote_operations_procurement_check CHECK (procurement_status IN ('not_started', 'in_progress', 'blocked', 'complete')),
  CONSTRAINT quote_operations_receiving_check CHECK (receiving_status IN ('not_started', 'in_progress', 'blocked', 'complete')),
  CONSTRAINT quote_operations_staging_check CHECK (staging_status IN ('not_started', 'in_progress', 'blocked', 'complete')),
  CONSTRAINT quote_operations_fulfillment_check CHECK (fulfillment_status IN ('not_started', 'in_progress', 'blocked', 'complete'))
);

ALTER TABLE public.quote_operations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quote_operations_auth_all ON public.quote_operations;
CREATE POLICY quote_operations_auth_all ON public.quote_operations
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
DROP TRIGGER IF EXISTS set_quote_operations_updated_at ON public.quote_operations;
CREATE TRIGGER set_quote_operations_updated_at BEFORE UPDATE ON public.quote_operations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE FUNCTION public.create_quote_approval_request(
  p_quote_id UUID,
  p_recipient_email TEXT DEFAULT NULL,
  p_expires_days INTEGER DEFAULT 14
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_token UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;
  UPDATE public.quote_approval_request
    SET status = 'revoked'
    WHERE quote_id = p_quote_id AND status = 'pending';
  INSERT INTO public.quote_approval_request(quote_id, recipient_email, expires_at, created_by)
    VALUES (p_quote_id, nullif(trim(p_recipient_email), ''), now() + make_interval(days => greatest(1, least(p_expires_days, 90))), auth.uid())
    RETURNING token INTO v_token;
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_quote_approval(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result JSONB;
BEGIN
  UPDATE public.quote_approval_request SET status = 'expired'
    WHERE token = p_token AND status = 'pending' AND expires_at < now();
  SELECT jsonb_build_object(
    'request_id', request.id,
    'status', request.status,
    'expires_at', request.expires_at,
    'quote_id', quote.id,
    'quote_number', 'Q-' || upper(right(quote.id::text, 8)),
    'currency', quote.currency,
    'total', quote.total,
    'notes', quote.notes,
    'context', quote.context_snapshot,
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'label', item.item_label,
        'code', item.canonical_code,
        'quantity', item.quantity,
        'unit_price', item.unit_price,
        'line_total', item.line_total
      ) ORDER BY item.sort_order)
      FROM public.quote_items item WHERE item.quote_id = quote.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.quote_approval_request request
  JOIN public.quotes quote ON quote.id = request.quote_id
  WHERE request.token = p_token;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_quote_approval(
  p_token UUID,
  p_decision TEXT,
  p_customer_name TEXT,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_request public.quote_approval_request%ROWTYPE;
DECLARE v_status TEXT;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Decision must be approved or rejected'; END IF;
  IF nullif(trim(p_customer_name), '') IS NULL THEN RAISE EXCEPTION 'Customer name is required'; END IF;
  SELECT * INTO v_request FROM public.quote_approval_request WHERE token = p_token FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'Approval request not found'; END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'Approval request is no longer pending'; END IF;
  IF v_request.expires_at < now() THEN
    UPDATE public.quote_approval_request SET status = 'expired' WHERE id = v_request.id;
    RAISE EXCEPTION 'Approval request has expired';
  END IF;
  v_status := p_decision;
  UPDATE public.quote_approval_request SET
    status = v_status, responded_at = now(), customer_name = trim(p_customer_name),
    customer_comment = nullif(trim(p_comment), '')
    WHERE id = v_request.id;
  UPDATE public.quotes SET status = v_status WHERE id = v_request.quote_id;
  IF v_status = 'approved' THEN
    INSERT INTO public.quote_operations(quote_id) VALUES (v_request.quote_id)
      ON CONFLICT (quote_id) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('status', v_status, 'quote_id', v_request.quote_id, 'responded_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.create_quote_approval_request(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_quote_approval_request(UUID, TEXT, INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.get_quote_approval(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_quote_approval(UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.respond_quote_approval(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_quote_approval(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;

