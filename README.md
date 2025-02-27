# CS2 PUG Discord Bot

A **Discord bot** for organizing **Counter-Strike 2 (CS2) pick-up games (PUGs)**. The bot manages team formation, player ready checks, map veto, and automatic match creation on a dedicated CS2 server.

## Features

✅ **Automatic Lobby Management** – Tracks voice channel activity and manages player readiness.  
✅ **SteamID Integration** – Links Discord users to their Steam accounts for authentication.  
✅ **Matchmaking & Team Balancing** – Implements ready checks, captain drafts, and automatic team sorting.  
✅ **Map Veto System** – Supports strategic map elimination to determine the final map.  
✅ **CS2 Server Automation** – Uses **RCON** to configure and launch matches.  
✅ **Statistics Tracking** – Records game data for analysis.  

---

## Installation

### 1️⃣ Clone the Repository
```sh
git clone https://github.com/enoughdrama/cs2-pug-discord-bot.git
cd cs2-pug-bot
```

### 2️⃣ Install Dependencies
```sh
npm install
```

### 3️⃣ Set Up Environment Variables

Create a `.env` file in the root directory with the following variables:

```ini
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_client_id
GUILD_ID=your_discord_guild_id
MONGO_URI=your_mongodb_connection_string
STEAM_ROLE_ID=your_steam_role_id
```

Replace the placeholders with actual values.

### 4️⃣ Deploy Slash Commands
```sh
node deploy-commands.js
```

### 5️⃣ Start the Bot
```sh
node index.js
```

---

## Usage

### 🔹 Start a New Match
Admins can start a match with the `/startgame` command:

```
/startgame players:10
```

This creates a **Lobby** voice channel and a **queue** text channel.

### 🔹 Link Your Steam Account
Users must link their Steam accounts before joining matches:

```
/send_linker
```

This prompts the user to enter their **SteamID**.

### 🔹 Join the Lobby
Simply join the **Lobby** voice channel to be added to the player queue.

### 🔹 Ready Check
Once enough players join, the bot starts a **ready check**. Players confirm their readiness by clicking a **Ready** button.

### 🔹 Draft Phase
Captains are assigned, and they **pick players** alternately.

### 🔹 Map Veto
Captains take turns **banning maps** until one remains.

### 🔹 Match Starts
The bot automatically starts the match on a dedicated **CS2 server** and provides players with a `connect` command.

---

## License

This project is licensed under the **MIT License**.
