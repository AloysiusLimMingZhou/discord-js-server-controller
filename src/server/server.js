const express = require('express');
const { sendNotification } = require('../bot/bot');

const app = express();
app.use(express.json());

// ─── Health check ───────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ═══════════════════════════════════════════════════════════════════════
//  VM Lifecycle Notifications (pushed by the G2 server → notifications channel)
//  The G2 ML training server calls these endpoints on startup / shutdown
//  to notify the Discord notifications channel.
// ═══════════════════════════════════════════════════════════════════════

app.post('/notify/started', async (_req, res) => {
  try {
    await sendNotification({
      title: '✅  G2 Server Started',
      description: 'The G2 ML training server is now **running** and ready to accept connections.',
      color: 0x00c853,
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/notify/stopped', async (_req, res) => {
  try {
    await sendNotification({
      title: '⛔  G2 Server Stopped',
      description: 'The G2 ML training server has been **stopped**.',
      color: 0xd50000,
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/notify/stopping', async (_req, res) => {
  try {
    await sendNotification({
      title: '🛑  G2 Server Stopping',
      description: 'The G2 ML training server is **shutting down**. It will be unavailable shortly.',
      color: 0xff6d00,
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/notify/starting', async (_req, res) => {
  try {
    await sendNotification({
      title: '🚀  G2 Server Starting',
      description: 'The G2 ML training server is **booting up**. Please wait…',
      color: 0x2979ff,
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Generic event endpoint ─────────────────────────────────────────
app.post('/notify/event', async (req, res) => {
  const { title, description, color } = req.body;

  if (!title || !description) {
    return res
      .status(400)
      .json({ error: '"title" and "description" are required in the request body.' });
  }

  try {
    await sendNotification({
      title,
      description,
      color: color ?? 0x607d8b,
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  Resource Monitoring (CPU / GPU utilization pushed by the G2 server)
// ═══════════════════════════════════════════════════════════════════════

const {
  reportCPUUtilization,
  reportGPUUtilization,
  getMonitoringStatus,
} = require('../services/monitoringService');

// ─── CPU utilization report ─────────────────────────────────────────
app.post('/monitor/cpu', async (req, res) => {
  const { utilization } = req.body;

  if (utilization === undefined || typeof utilization !== 'number') {
    return res
      .status(400)
      .json({ error: '"utilization" (number, 0-100) is required in the request body.' });
  }

  try {
    const result = await reportCPUUtilization(utilization);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GPU utilization report ─────────────────────────────────────────
app.post('/monitor/gpu', async (req, res) => {
  const { utilization, gpuName } = req.body;

  if (utilization === undefined || typeof utilization !== 'number') {
    return res
      .status(400)
      .json({ error: '"utilization" (number, 0-100) is required in the request body.' });
  }

  try {
    const result = await reportGPUUtilization(utilization, gpuName);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Monitoring status ──────────────────────────────────────────────
app.get('/monitor/status', (_req, res) => {
  res.json(getMonitoringStatus());
});

module.exports = app;
