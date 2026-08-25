// One-off script: registers the bot's two slash commands with Discord.
// Run once after creating the bot (and again any time the commands change):
//   npm run register-commands

import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const { DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID } = process.env;

if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID in .env');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to your ProjectSync profile')
    .addStringOption(opt =>
      opt.setName('code').setDescription('The code shown in ProjectSync > Connections').setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('connect-project')
    .setDescription('Enable two-way chat sync for this channel (run by the project leader)')
    .addStringOption(opt =>
      opt.setName('code').setDescription('The code shown in ProjectSync > Connections').setRequired(true)
    )
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

try {
  console.log('Registering global slash commands...');
  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: commands });
  console.log('Done. Global commands can take up to an hour to appear everywhere — invite the bot to a test server to see them instantly via guild-level propagation, or just wait it out.');
} catch (err) {
  console.error('Failed to register commands:', err);
  process.exit(1);
}
