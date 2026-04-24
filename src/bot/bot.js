const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const { startVM, stopVM, getVMStatus } = require('../services/vmService');
const { initScheduler, updateVMMode } = require('../services/schedulerService');

// Track active retry jobs
const activeRetries = new Map();


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
  if (interaction.isButton()) {
    if (interaction.customId === 'stop-vm-retry') {
      const retryId = `${interaction.guildId}-${config.gcp.instanceName}`;
      if (activeRetries.has(retryId)) {
        activeRetries.delete(retryId);
        const embed = new EmbedBuilder()
          .setTitle('🛑  Retry Cancelled')
          .setDescription('The VM start retry job has been stopped manually.')
          .setColor(0xd50000)
          .setTimestamp();
        await interaction.update({ embeds: [embed], components: [] });
      } else {
        await interaction.reply({ content: 'No active retry job found to stop.', ephemeral: true });
      }
    }
    return;
  }

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
    const shouldRetry = interaction.options.getBoolean('retry') ?? false;
    const retryId = `${interaction.guildId}-${config.gcp.instanceName}`;

    await interaction.deferReply();
    
    if (shouldRetry && activeRetries.has(retryId)) {
      return interaction.editReply('A retry job is already running for this VM.');
    }

    try {
      const embed = new EmbedBuilder()
        .setTitle('🚀  Starting VM…')
        .setDescription('Sending start request to Google Cloud.')
        .setColor(0x2979ff)
        .setTimestamp();
      
      const components = [];
      if (shouldRetry) {
        embed.setFooter({ text: 'Retry mode enabled' });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('stop-vm-retry')
            .setLabel('Stop Retry')
            .setStyle(ButtonStyle.Danger)
        );
        components.push(row);
      }

      await interaction.editReply({ embeds: [embed], components });

      // Notify the notifications channel that the server is starting
      await sendNotification({
        title: '🚀  G2 Server Starting',
        description: `**${interaction.user.tag}** initiated a start request via Discord.\nThe G2 ML training server is **booting up**. Please wait…`,
        color: 0x2979ff,
      });

      if (shouldRetry) {
        activeRetries.set(retryId, true);
        let attempts = 0;
        
        while (activeRetries.has(retryId)) {
          attempts++;
          try {
            const msg = await startVM();
            activeRetries.delete(retryId);

            const doneEmbed = new EmbedBuilder()
              .setTitle('✅  VM Started')
              .setDescription(msg)
              .setColor(0x00c853)
              .setTimestamp();
            await interaction.editReply({ embeds: [doneEmbed], components: [] });
            
            updateVMMode('RUNNING');

            await sendNotification({
              title: '✅  G2 Server Started',
              description: `The G2 ML training server is now **running**.\nStarted after ${attempts} attempt(s) by **${interaction.user.tag}**.`,
              color: 0x00c853,
            });
            break;
          } catch (err) {
            const isResourceError = err.message.includes('ZONE_RESOURCE_POOL_EXHAUSTED_WITH_DETAILS');
            
            if (isResourceError && activeRetries.has(retryId)) {
              console.log(`[Retry] Attempt ${attempts} failed: Resource exhaustion. Retrying in 1 minute...`);
              
              const retryEmbed = new EmbedBuilder()
                .setTitle('⏳  Retrying VM Start…')
                .setDescription(`Attempt **#${attempts}** failed: Zone resource pool exhausted.\nWaiting 1 minute before next attempt...`)
                .setColor(0xffab00)
                .setFooter({ text: 'Keep retrying is ACTIVE' })
                .setTimestamp();
              
              await interaction.editReply({ embeds: [retryEmbed] });

              await sendNotification({
                title: '⚠️  G2 Server Start Retrying',
                description: `Attempt **#${attempts}** failed: Zone resource pool exhausted.\nRetrying automatically...`,
                color: 0xffab00,
              });

              // Wait 1 minute
              await new Promise(resolve => setTimeout(resolve, 60000));
            } else {
              activeRetries.delete(retryId);
              throw err; // Re-throw if it's a different error or we stopped retrying
            }
          }
        }
      } else {
        // Normal non-retry start
        const msg = await startVM();
        const doneEmbed = new EmbedBuilder()
          .setTitle('✅  VM Started')
          .setDescription(msg)
          .setColor(0x00c853)
          .setTimestamp();
        await interaction.editReply({ embeds: [doneEmbed] });
        
        updateVMMode('RUNNING');

        await sendNotification({
          title: '✅  G2 Server Started',
          description: `The G2 ML training server is now **running** and ready to accept connections.\nStarted by **${interaction.user.tag}** via Discord.`,
          color: 0x00c853,
        });
      }
    } catch (err) {
      console.error(err);
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌  Failed to start VM')
        .setDescription(err.message)
        .setColor(0xd50000)
        .setTimestamp();
      
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [errorEmbed], components: [] });
      } else {
        await interaction.reply({ embeds: [errorEmbed] });
      }
      
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
async function sendNotification({ title, description, color = 0x607d8b, content = '' }) {
  const channel = await client.channels.fetch(config.discord.channelId);
  if (!channel) throw new Error('Notification channel not found.');

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();

  await channel.send({ content, embeds: [embed] });
}

module.exports = { client, sendNotification };
