const config = require('./config');
const { client } = require('./bot/bot');
const app = require('./server/server');

// ─── Start Discord bot ─────────────────────────────────────────────
client.login(config.discord.token).then(() => {
  // ─── Start Express server after bot is ready ────────────────────
  app.listen(config.express.port, () => {
    console.log(`🌐  Express server listening on port ${config.express.port}`);
    console.log(`📡  Waiting for events from G2 server…`);
  });
});
