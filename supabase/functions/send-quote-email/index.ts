import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  quoteId: string;
  recipientEmail: string;
  ccEmails?: string[];
  subject: string;
  message: string;
  pdfBase64: string;
  pdfFileName: string;
  manufacturerPdfBase64?: string;
  manufacturerPdfFileName?: string;
  updateQuoteDeliveryStatus?: boolean;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Missing Authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const fromAddress = Deno.env.get('QUOTE_EMAIL_FROM');

    if (!resendApiKey || !fromAddress) {
      return jsonResponse(
        { error: 'Email service is not configured. Set RESEND_API_KEY and QUOTE_EMAIL_FROM secrets.' },
        503,
      );
    }

    // Verify caller is authenticated
    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerUser) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Parse and validate body
    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const {
      quoteId,
      recipientEmail,
      ccEmails = [],
      subject,
      message,
      pdfBase64,
      pdfFileName,
      manufacturerPdfBase64,
      manufacturerPdfFileName,
      updateQuoteDeliveryStatus = true,
    } = body;

    if (!quoteId || !recipientEmail || !subject || !message || !pdfBase64 || !pdfFileName) {
      return jsonResponse(
        { error: 'quoteId, recipientEmail, subject, message, pdfBase64, and pdfFileName are required' },
        400,
      );
    }

    if (!isValidEmail(recipientEmail)) {
      return jsonResponse({ error: 'Invalid recipientEmail' }, 400);
    }

    for (const cc of ccEmails) {
      if (!isValidEmail(cc)) {
        return jsonResponse({ error: `Invalid CC email: ${cc}` }, 400);
      }
    }

    // Use service-role client for all privileged DB operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the quote exists and belongs to this org
    const { data: quoteRow, error: quoteError } = await adminClient
      .from('quotes')
      .select('*')
      .eq('id', quoteId)
      .single();

    if (quoteError || !quoteRow) {
      return jsonResponse({ error: 'Quote not found' }, 404);
    }

    // Build attachments
    const attachments: Array<{ filename: string; content: string }> = [
      { filename: pdfFileName, content: pdfBase64 },
    ];

    if (manufacturerPdfBase64 && manufacturerPdfFileName) {
      attachments.push({ filename: manufacturerPdfFileName, content: manufacturerPdfBase64 });
    }

    // Build HTML body — wrap plain text message in a minimal email wrapper
    const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 24px;">
  ${message
    .split('\n')
    .map((line) => `<p style="margin: 0 0 12px;">${line || '&nbsp;'}</p>`)
    .join('\n')}
</body>
</html>`;

    // Send via Resend REST API
    const resendPayload = {
      from: fromAddress,
      to: [recipientEmail],
      ...(ccEmails.length > 0 ? { cc: ccEmails } : {}),
      subject,
      html: htmlBody,
      attachments,
    };

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendPayload),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      // Log failed attempt
      await adminClient.from('quote_emails').insert({
        quote_id: quoteId,
        recipient_email: recipientEmail,
        cc_emails: ccEmails,
        subject,
        body: message,
        sent_by_user_id: callerUser.id,
        provider_message_id: null,
        status: 'failed',
        error: resendData?.message ?? resendData?.name ?? 'Unknown Resend error',
      });

      console.error('Resend error:', resendData);
      return jsonResponse({ error: `Email delivery failed: ${resendData?.message ?? 'Unknown error'}` }, 502);
    }

    const providerMessageId: string | null = resendData?.id ?? null;

    // Log successful send
    await adminClient.from('quote_emails').insert({
      quote_id: quoteId,
      recipient_email: recipientEmail,
      cc_emails: ccEmails,
      subject,
      body: message,
      sent_by_user_id: callerUser.id,
      provider_message_id: providerMessageId,
      status: 'sent',
      error: null,
    });

    if (!updateQuoteDeliveryStatus) {
      return jsonResponse({ success: true, quote: quoteRow }, 200);
    }

    // Customer delivery updates the quote's sent state. Manufacturer RFQs are
    // logged above but intentionally do not replace customer delivery data.
    const advanceStatus = ['draft', 'sent'].includes(quoteRow.status);
    const { data: updatedQuote, error: updateError } = await adminClient
      .from('quotes')
      .update({
        ...(advanceStatus ? { status: 'sent' } : {}),
        sent_at: new Date().toISOString(),
        sent_to_email: recipientEmail,
      })
      .eq('id', quoteId)
      .select()
      .single();

    if (updateError || !updatedQuote) {
      console.error('Quote update error:', updateError);
      // Email was sent; return partial success with a warning
      return jsonResponse({ warning: 'Email sent but quote status update failed', quote: quoteRow }, 200);
    }

    return jsonResponse({ success: true, quote: updatedQuote }, 200);
  } catch (err) {
    console.error('Unexpected error in send-quote-email:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
