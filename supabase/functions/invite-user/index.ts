import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const siteUrl = Deno.env.get('SITE_URL') ?? supabaseUrl;

    // Verify the caller is an authenticated admin using their own JWT
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check that the caller is an admin in public.users
    const { data: callerProfile, error: profileError } = await callerClient
      .from('users')
      .select('role')
      .eq('id', callerUser.id)
      .single();

    if (profileError || !callerProfile || callerProfile.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { email, first_name, last_name, job_title, role } = body as {
      email: string;
      first_name: string;
      last_name: string;
      job_title: string;
      role: 'admin' | 'sales' | 'ops';
    };

    if (!email || !first_name || !last_name || !role) {
      return new Response(JSON.stringify({ error: 'email, first_name, last_name, and role are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!['admin', 'sales', 'ops'].includes(role)) {
      return new Response(JSON.stringify({ error: 'Invalid role. Must be admin, sales, or ops.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use service-role client to invite the user
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { first_name, last_name, job_title: job_title ?? '', role },
      redirectTo: `${siteUrl}/accept-invite`,
    });

    if (error) {
      console.error('Invite error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, user_id: data.user?.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
