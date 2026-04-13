const cron = require('node-cron');
const { getVMStatus } = require('./vmService');

let hourlyTask = null;
let thirtyMinTask = null;
let isVMRunning = false;
let notificationCallback = null;

/**
 * Initialize the scheduler with a callback to send notifications.
 * @param {Function} sendNotif Callback function to send notifications.
 */
function initScheduler(sendNotif) {
  notificationCallback = sendNotif;
  
  // Start hourly task by default
  startHourlyTask();
  console.log('📅  Scheduler initialized. Default mode: Hourly.');
}

/**
 * Start the hourly cron job (Every hour at minute 0).
 */
function startHourlyTask() {
  if (hourlyTask) return;
  
  hourlyTask = cron.schedule('0 * * * *', async () => {
    console.log('⏰  Executing hourly status notification...');
    await sendStatusNotification();
  }, {
    timezone: "Asia/Kuala_Lumpur"
  });
  
  if (thirtyMinTask) {
    thirtyMinTask.stop();
    thirtyMinTask = null;
  }
}

/**
 * Start the 30-minute cron job (Every 30 minutes).
 */
function startThirtyMinTask() {
  if (thirtyMinTask) return;
  
  thirtyMinTask = cron.schedule('0,30 * * * *', async () => {
    console.log('⏰  Executing 30-minute status notification...');
    await sendStatusNotification();
  }, {
    timezone: "Asia/Kuala_Lumpur"
  });
  
  if (hourlyTask) {
    hourlyTask.stop();
    hourlyTask = null;
  }
}

/**
 * Update the VM mode based on status.
 * @param {string} status The VM status (e.g., 'RUNNING', 'STOPPED').
 */
function updateVMMode(status) {
  const running = status === 'RUNNING';
  
  if (running && !isVMRunning) {
    console.log('🚀  VM detected as RUNNING. Switching to 30-minute notification mode.');
    isVMRunning = true;
    startThirtyMinTask();
  } else if (!running && isVMRunning) {
    console.log('🛑  VM detected as NOT RUNNING. Reverting to hourly notification mode.');
    isVMRunning = false;
    startHourlyTask();
  }
}

/**
 * Fetch VM status and send a notification via the callback.
 */
async function sendStatusNotification() {
  if (!notificationCallback) return;
  
  try {
    const info = await getVMStatus();
    
    // Update mode in case it changed out-of-band
    updateVMMode(info.status);

    const STATUS_COLORS = {
      RUNNING: 0x00c853,
      STOPPED: 0xd50000,
      STOPPING: 0xff6d00,
      STAGING: 0xffab00,
      PROVISIONING: 0x2979ff,
    };

    let description = `**Status:** ${info.status}\n**External IP:** ${info.externalIp}`;
    
    if (info.status === 'RUNNING' && info.lastStartTimestamp) {
        const uptimeMs = Date.now() - new Date(info.lastStartTimestamp).getTime();
        description += `\n**Uptime:** ${formatDuration(uptimeMs)}`;
    }

    await notificationCallback({
      title: '📊  Scheduled VM Status Update',
      description,
      color: STATUS_COLORS[info.status] ?? 0x607d8b,
    });
  } catch (err) {
    console.error('❌  Failed to send scheduled notification:', err);
  }
}

/**
 * Helper to format duration. Copied from bot.js or moved to a shared utility?
 * For now, I'll include it here to avoid complex refactoring.
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

module.exports = { initScheduler, updateVMMode };
