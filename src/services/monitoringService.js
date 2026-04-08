const config = require('../config');
const { sendNotification } = require('../bot/bot');

// ─── Cooldown tracking — prevents spamming alerts ───────────────────
const lastAlertTimestamps = {
  cpu: 0,
  gpu: 0,
};

// ────────────────────────────────────────────────────────────────────
//  CPU / GPU Utilization Alerts (push-based via Express endpoints)
//  The G2 ML training server pushes metrics to the bot's Express API.
// ────────────────────────────────────────────────────────────────────

/**
 * Report CPU utilization. If it exceeds the configured threshold an
 * alert is sent to the Discord notifications channel (respecting the cooldown window).
 *
 * @param {number} utilization  CPU usage percentage (0-100).
 * @returns {{ alerted: boolean, utilization: number, threshold: number }}
 */
async function reportCPUUtilization(utilization) {
  const threshold = config.monitoring.cpuThreshold;
  const result = { alerted: false, utilization, threshold };

  if (utilization >= threshold) {
    const now = Date.now();
    if (now - lastAlertTimestamps.cpu >= config.monitoring.alertCooldown) {
      lastAlertTimestamps.cpu = now;
      result.alerted = true;

      await sendNotification({
        title: '🔥  High CPU Utilization — G2 Server',
        description:
          `CPU usage has reached **${utilization.toFixed(1)}%** (threshold: ${threshold}%).\n\n` +
          `Instance: **${config.gcp.instanceName}** · Zone: **${config.gcp.zone}**`,
        color: utilization >= 95 ? 0xd50000 : 0xff6d00, // red if ≥95%, orange otherwise
      });
    }
  }

  return result;
}

/**
 * Report GPU utilization. If it exceeds the configured threshold an
 * alert is sent to the Discord notifications channel (respecting the cooldown window).
 *
 * @param {number} utilization  GPU usage percentage (0-100).
 * @param {string} [gpuName]    Optional GPU identifier (e.g. "nvidia-l4").
 * @returns {{ alerted: boolean, utilization: number, threshold: number }}
 */
async function reportGPUUtilization(utilization, gpuName) {
  const threshold = config.monitoring.gpuThreshold;
  const result = { alerted: false, utilization, threshold };

  if (utilization >= threshold) {
    const now = Date.now();
    if (now - lastAlertTimestamps.gpu >= config.monitoring.alertCooldown) {
      lastAlertTimestamps.gpu = now;
      result.alerted = true;

      const gpuLabel = gpuName ? ` (${gpuName})` : '';

      await sendNotification({
        title: '🔥  High GPU Utilization — G2 Server',
        description:
          `GPU${gpuLabel} usage has reached **${utilization.toFixed(1)}%** (threshold: ${threshold}%).\n\n` +
          `Instance: **${config.gcp.instanceName}** · Zone: **${config.gcp.zone}**`,
        color: utilization >= 95 ? 0xd50000 : 0xff6d00,
      });
    }
  }

  return result;
}

/**
 * Return a snapshot of the monitoring subsystem's state.
 */
function getMonitoringStatus() {
  return {
    thresholds: {
      cpu: config.monitoring.cpuThreshold,
      gpu: config.monitoring.gpuThreshold,
    },
    alertCooldownMs: config.monitoring.alertCooldown,
    lastAlerts: {
      cpu: lastAlertTimestamps.cpu ? new Date(lastAlertTimestamps.cpu).toISOString() : null,
      gpu: lastAlertTimestamps.gpu ? new Date(lastAlertTimestamps.gpu).toISOString() : null,
    },
  };
}

module.exports = {
  reportCPUUtilization,
  reportGPUUtilization,
  getMonitoringStatus,
};
