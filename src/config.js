require('dotenv').config();

const required = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'DISCORD_CHANNEL_ID',
  'GCP_PROJECT_ID',
  'GCP_ZONE',
  'GCP_INSTANCE_NAME',
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌  Missing required env var: ${key}`);
    process.exit(1);
  }
}

// Set GOOGLE_APPLICATION_CREDENTIALS from SA_KEY if provided
if (process.env.SA_KEY) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.SA_KEY;
}

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID,
    channelId: process.env.DISCORD_CHANNEL_ID,
  },
  gcp: {
    projectId: process.env.GCP_PROJECT_ID,
    zone: process.env.GCP_ZONE,
    instanceName: process.env.GCP_INSTANCE_NAME,
  },
  express: {
    port: parseInt(process.env.EXPRESS_PORT, 10) || 3000,
  },
};
