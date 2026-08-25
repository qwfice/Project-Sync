// ============================================================
// Supabase Edge Function: discord-interactions
// Discord's "Interactions Endpoint URL" — Discord calls this directly over
// HTTP the moment someone runs /link or /connect-project, so slash commands
// work without any bot process staying online. Replaces the gateway-based
// InteractionCreate handler in discord-bot/index.js.
//
// Deploy with: supabase functions deploy discord-interactions --no-verify-jwt
// (--no-verify-jwt because Discord calls this unauthenticated, same reason
// stripe-webhook needs it)
//
// After deploying, set this function's URL as the "Interactions Endpoint
// URL" in the Discord Developer Portal (General Information page) — Discord
// sends a PING to verify it immediately on save, so the function and its
// secrets must already be live first.
//
// SECRETS (Supabase Dashboard > Edge Functions > Secrets):
// DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN
// (SUPABASE_* vars are auto-populated by Supabase for every edge function.)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 };
const InteractionResponseType = { PONG: 1, CHANNEL_MESSAGE_WITH_SOURCE: 4 };
const EPHEMERAL = 64;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function verifyDiscordRequest(req: Request, rawBody: string, publicKeyHex: string): Promise<boolean> {
  const signature = req.headers.get('X-Signature-Ed25519');
  const timestamp = req.headers.get('X-Signature-Timestamp');
  if (!signature || !timestamp) return false;

  try {
    const key = await crypto.subtle.importKey(
      'raw', hexToBytes(publicKeyHex), { name: 'Ed25519' }, false, ['verify']
    );
    const message = new TextEncoder().encode(timestamp + rawBody);
    return await crypto.subtle.verify('Ed25519', key, hexToBytes(signature), message);
  } catch (err) {
    console.error('[verifyDiscordRequest] failed:', err.message);
    return false;
  }
}

function reply(content: string, ephemeral = true) {
  return new Response(
    JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content, flags: ephemeral ? EPHEMERAL : 0 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function getOption(data: any, name: string): string | undefined {
  return data.options?.find((o: any) => o.name === name)?.value;
}

async function handleLink(supabase: any, discordUserId: string, discordUsername: string, code: string) {
  const { data: codeRow, error: codeError } = await supabase
    .from('platform_link_codes')
    .select('*')
    .eq('code', code)
    .eq('kind', 'user')
    .eq('platform', 'discord')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (codeError || !codeRow) {
    return reply('❌ That code is invalid or has expired. Generate a new one in ProjectSync > Connections.');
  }

  const { error: upsertError } = await supabase.from('platform_connections').upsert({
    scope: 'user',
    user_id: codeRow.user_id,
    platform: 'discord',
    external_id: discordUserId,
    external_label: discordUsername,
    capabilities: ['linking', 'notify'],
    status: 'active',
    created_by: codeRow.user_id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,platform' });

  if (upsertError) {
    console.error('[handleLink] upsert failed:', upsertError.message);
    return reply('❌ Something went wrong linking your account. Try again.');
  }

  await supabase.from('platform_link_codes').update({ used_at: new Date().toISOString() }).eq('id', codeRow.id);

  return reply('✅ Linked! Messages you send in synced channels will now show your ProjectSync profile.');
}

async function handleConnectProject(supabase: any, interaction: any, code: string, botToken: string) {
  const guildId = interaction.guild_id;
  const channelId = interaction.channel_id;
  if (!guildId) {
    return reply('❌ Run this inside the server channel you want to sync, not in a DM.');
  }

  const { data: codeRow, error: codeError } = await supabase
    .from('platform_link_codes')
    .select('*')
    .eq('code', code)
    .eq('kind', 'project')
    .eq('platform', 'discord')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (codeError || !codeRow) {
    return reply('❌ That code is invalid or has expired. Generate a new one in ProjectSync > Connections (project leader only).');
  }

  const { data: existing } = await supabase
    .from('platform_connections')
    .select('capabilities')
    .eq('project_id', codeRow.project_id)
    .eq('platform', 'discord')
    .maybeSingle();

  const capabilities = Array.from(new Set([...(existing?.capabilities || []), 'two_way']));

  let channelName = interaction.channel?.name;
  if (!channelName) {
    try {
      const chRes = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (chRes.ok) channelName = (await chRes.json()).name;
    } catch (err) {
      console.error('[handleConnectProject] channel fetch failed:', err.message);
    }
  }

  const { error: upsertError } = await supabase.from('platform_connections').upsert({
    scope: 'project',
    project_id: codeRow.project_id,
    platform: 'discord',
    external_id: channelId,
    external_label: '#' + (channelName || 'unknown'),
    capabilities,
    status: 'active',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id,platform' });

  if (upsertError) {
    console.error('[handleConnectProject] upsert failed:', upsertError.message);
    return reply('❌ Something went wrong connecting this channel. Try again.');
  }

  await supabase.from('platform_link_codes').update({ used_at: new Date().toISOString() }).eq('id', codeRow.id);

  return reply('✅ This channel is now synced two-way with the project\'s ProjectSync chat.', false);
}

serve(async (req) => {
  const publicKey = Deno.env.get('DISCORD_PUBLIC_KEY');
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!publicKey || !botToken || !supabaseUrl || !supabaseServiceKey) {
    return new Response('Missing required environment variables', { status: 500 });
  }

  const rawBody = await req.text();
  const isValid = await verifyDiscordRequest(req, rawBody, publicKey);
  if (!isValid) {
    return new Response('Invalid request signature', { status: 401 });
  }

  const interaction = JSON.parse(rawBody);

  if (interaction.type === InteractionType.PING) {
    return new Response(JSON.stringify({ type: InteractionResponseType.PONG }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const commandName = interaction.data?.name;
    const discordUserId = interaction.member?.user?.id || interaction.user?.id;
    const discordUsername = interaction.member?.user?.username || interaction.user?.username;

    try {
      if (commandName === 'link') {
        const code = getOption(interaction.data, 'code')?.trim();
        return await handleLink(supabase, discordUserId, discordUsername, code);
      }
      if (commandName === 'connect-project') {
        const code = getOption(interaction.data, 'code')?.trim();
        return await handleConnectProject(supabase, interaction, code, botToken);
      }
      return reply('❌ Unknown command.');
    } catch (err) {
      console.error('[discord-interactions] unhandled error:', err);
      return reply('❌ Unexpected error, please try again.');
    }
  }

  return new Response('Unhandled interaction type', { status: 400 });
});
