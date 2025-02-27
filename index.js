require('dotenv').config();
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// Подключаемся к MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('Подключение к MongoDB успешно!');
}).catch(err => {
  console.error('Ошибка подключения к MongoDB:', err);
});

// Инициализируем клиент Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

// Загружаем команды
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if (command.name && command.execute) {
    client.commands.set(command.name, command);
    console.log(`Загружена команда: ${command.name}`);
  }
}

// Загружаем события
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.name && event.execute) {
    client.on(event.name, (...args) => event.execute(...args, client));
    console.log(`Загружено событие: ${event.name}`);
  }
}

client.once('ready', () => {
  console.log(`✅ Бот запущен как ${client.user.tag}!`);
});

client.login(process.env.DISCORD_TOKEN);
