const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { startVM, stopVM, getVMStatus } = require('../services/vmService');
const { initScheduler, updateVMMode } = require('../services/schedulerService');


const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ─── Status colour mapping ──────────────────────────────────────────
const STATUS_COLORS = {
  RUNNING: 0x00c853,     // green
  STOPPED: 0xd50000,     // red
  STOPPING: 0xff6d00,    // orange
  STAGING: 0xffab00,     // amber
  PROVISIONING: 0x2979ff, // blue
  SUSPENDING: 0xff6d00,
  SUSPENDED: 0x9e9e9e,
  TERMINATED: 0x616161,
};

// ─── Interaction handler ────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ── /vm-status ──────────────────────────────────────────────────
  if (commandName === 'vm-status') {
    await interaction.deferReply();
    try {
      const info = await getVMStatus();
      const fields = [
        { name: 'Name', value: info.name, inline: true },
        { name: 'Status', value: info.status, inline: true },
        { name: 'Machine Type', value: info.machineType, inline: true },
        { name: 'Zone', value: info.zone, inline: true },
        { name: 'External IP', value: info.externalIp, inline: true },
      ];

      if (info.status === 'RUNNING' && info.lastStartTimestamp) {
        const uptimeMs = Date.now() - new Date(info.lastStartTimestamp).getTime();
        fields.push({ name: 'Uptime', value: formatDuration(uptimeMs), inline: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('📊  VM Status')
        .setColor(STATUS_COLORS[info.status] ?? 0x607d8b)
        .addFields(fields)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      
      // Update scheduler mode based on status
      updateVMMode(info.status);
    } catch (err) {
      console.error(err);
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌  Failed to get VM status')
        .setDescription(err.message)
        .setColor(0xd50000)
        .setTimestamp();
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }

  // ── /vm-start ───────────────────────────────────────────────────
  if (commandName === 'vm-start') {
    await interaction.deferReply();
    try {
      const embed = new EmbedBuilder()
        .setTitle('🚀  Starting VM…')
        .setDescription('Sending start request to Google Cloud.')
        .setColor(0x2979ff)
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });

      // Notify the notifications channel that the server is starting
      await sendNotification({
        title: '🚀  G2 Server Starting',
        description: `**${interaction.user.tag}** initiated a start request via Discord.\nThe G2 ML training server is **booting up**. Please wait…`,
        color: 0x2979ff,
      });

      const msg = await startVM();

      const doneEmbed = new EmbedBuilder()
        .setTitle('✅  VM Started')
        .setDescription(msg)
        .setColor(0x00c853)
        .setTimestamp();
      await interaction.followUp({ embeds: [doneEmbed] });
      
      // Update scheduler mode to Started
      updateVMMode('RUNNING');


      // Notify the notifications channel that the server has started
      await sendNotification({
        title: '✅  G2 Server Started',
        description: `The G2 ML training server is now **running** and ready to accept connections.\nStarted by **${interaction.user.tag}** via Discord.`,
        color: 0x00c853,
      });
    } catch (err) {
      console.error(err);
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌  Failed to start VM')
        .setDescription(err.message)
        .setColor(0xd50000)
        .setTimestamp();
      await interaction.followUp({ embeds: [errorEmbed] });
      
      // Notify the notifications channel that the start failed
      await sendNotification({
        title: '❌  G2 Server Start Failed',
        description: `Failed to start the VM instance.\n**Error:** ${err.message}\nTriggered by **${interaction.user.tag}**.`,
        color: 0xd50000,
      });
    }
  }

  // ── /vm-stop ────────────────────────────────────────────────────
  if (commandName === 'vm-stop') {
    await interaction.deferReply();
    try {
      const embed = new EmbedBuilder()
        .setTitle('🛑  Stopping VM…')
        .setDescription('Sending stop request to Google Cloud.')
        .setColor(0xff6d00)
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });

      // Notify the notifications channel that the server is stopping
      await sendNotification({
        title: '🛑  G2 Server Stopping',
        description: `**${interaction.user.tag}** initiated a stop request via Discord.\nThe G2 ML training server is **shutting down**.`,
        color: 0xff6d00,
      });

      const msg = await stopVM();

      const doneEmbed = new EmbedBuilder()
        .setTitle('✅  VM Stopped')
        .setDescription(msg)
        .setColor(0xd50000)
        .setTimestamp();
      await interaction.followUp({ embeds: [doneEmbed] });
      
      // Update scheduler mode to Idle
      updateVMMode('TERMINATED'); // Or STOPPED, scheduler checks if it's RUNNING


      // Notify the notifications channel that the server has stopped
      await sendNotification({
        title: '⛔  G2 Server Stopped',
        description: `The G2 ML training server has been **stopped**.\nStopped by **${interaction.user.tag}** via Discord.`,
        color: 0xd50000,
      });
    } catch (err) {
      console.error(err);
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌  Failed to stop VM')
        .setDescription(err.message)
        .setColor(0xd50000)
        .setTimestamp();
      await interaction.followUp({ embeds: [errorEmbed] });

      // Notify the notifications channel that the stop failed
      await sendNotification({
        title: '❌  G2 Server Stop Failed',
        description: `Failed to stop the VM instance.\n**Error:** ${err.message}\nTriggered by **${interaction.user.tag}**.`,
        color: 0xd50000,
      });
    }
  }
});

/**
 * Format milliseconds into a human-readable duration (e.g., 2h 15m).
 * @param {number} ms Duration in milliseconds.
 * @returns {string} Formatted duration.
 */
function formatDuration(ms) {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

client.once('ready', async (c) => {
  console.log(`🤖  Discord bot logged in as ${c.user.tag}`);
  
  // Initialize scheduler
  initScheduler(sendNotification);
  
  // Initial check of VM status to set the correct mode
  try {
    const info = await getVMStatus();
    updateVMMode(info.status);
    console.log(`🔍  Initial VM status: ${info.status}`);
  } catch (err) {
    console.error('❌  Failed to perform initial VM status check:', err);
  }
});


/**
 * Send a rich-embed notification to the configured notifications channel.
 * Used by:
 *  - Slash command handlers (when a user starts/stops the VM via Discord)
 *  - Express endpoints (when the G2 server pushes lifecycle/metric events)
 */
async function sendNotification({ title, description, color = 0x607d8b }) {
  const channel = await client.channels.fetch(config.discord.channelId);
  if (!channel) throw new Error('Notification channel not found.');

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

module.exports = { client, sendNotification };
