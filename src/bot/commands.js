const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('vm-start')
    .setDescription('Start the Google Cloud VM instance')
    .addBooleanOption(option =>
      option.setName('retry')
        .setDescription('Keep retrying if the zone is out of resources')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('vm-stop')
    .setDescription('Stop the Google Cloud VM instance'),

  new SlashCommandBuilder()
    .setName('vm-status')
    .setDescription('Get the current status of the Google Cloud VM instance'),
];

module.exports = commands.map((cmd) => cmd.toJSON());
