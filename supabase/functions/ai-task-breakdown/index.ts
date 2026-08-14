// ============================================================
// Supabase Edge Function: ai-task-breakdown
// Turns a pasted assignment brief into a suggested task list using Gemini.
// Deploy with: supabase functions deploy ai-task-breakdown
//
// SECRETS (set in Supabase Dashboard > Edge Functions > Secrets):
// GEMINI_API_KEY = your Gemini API key
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const GEMINI_MODEL = 'gemini-2.5-flash';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!geminiApiKey || !supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing required environment variables');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Client authenticated as the calling user, so the RPC check below
    // applies the caller's own RLS-visible identity, not a service role.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { project_id, subject, brief } = body;

    if (!project_id || !brief) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only the project leader (owner) may generate AI task breakdowns —
    // mirrors the DB-level leader-only restriction on inserting tasks, and
    // keeps Gemini usage (which costs money) gated server-side too, not
    // just hidden in the UI.
    const { data: isOwner, error: ownerError } = await supabase.rpc('is_project_owner', {
      p_project_id: project_id,
      p_user_id: user.id
    });

    if (ownerError || !isOwner) {
      return new Response(
        JSON.stringify({ error: 'Only the project leader can use AI task breakdown' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const prompt = `You are helping a student group break down a school assignment into concrete, actionable tasks for their project management board.

Assignment subject: ${subject || 'General'}
Assignment brief:
"""
${brief}
"""

Break this down into 4-10 concrete tasks a student group could assign and track. Keep titles short (under 60 characters) and descriptions to one or two practical sentences. Assign each a priority of "high", "medium", or "low" based on how foundational/urgent it is to the rest of the work.`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiApiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  title: { type: 'STRING' },
                  description: { type: 'STRING' },
                  priority: { type: 'STRING', enum: ['high', 'medium', 'low'] }
                },
                required: ['title', 'description', 'priority']
              }
            }
          }
        })
      }
    );

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error('Gemini API error:', errText);
      return new Response(
        JSON.stringify({ error: 'AI request failed' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const geminiData = await geminiResponse.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return new Response(
        JSON.stringify({ error: 'AI returned no content' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let tasks;
    try {
      tasks = JSON.parse(rawText);
    } catch (e) {
      console.error('Failed to parse Gemini output:', rawText);
      return new Response(
        JSON.stringify({ error: 'AI returned invalid data' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ tasks }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('AI breakdown error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
