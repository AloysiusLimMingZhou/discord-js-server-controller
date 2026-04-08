# Discord Bot — GCP VM Controller

A Discord bot built with [Discord.js v14](https://discord.js.org/) that lets you **start**, **stop**, and **check the status** of a Google Cloud Compute Engine G2 VM instance via slash commands. The bot runs on an **EC2 instance** and receives **push-based notifications** from the **G2 ML training server** via Express endpoints — posting real-time lifecycle events and CPU/GPU utilization alerts to a dedicated Discord notifications channel.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
  - [1. Clone & Install](#1-clone--install)
  - [2. Create a Discord Bot](#2-create-a-discord-bot)
  - [3. Configure Environment Variables](#3-configure-environment-variables)
  - [4. GCP Authentication](#4-gcp-authentication)
  - [5. Register Slash Commands](#5-register-slash-commands)
  - [6. Start the Bot](#6-start-the-bot)
- [Using the Launch Script](#using-the-launch-script)
- [Discord Slash Commands](#discord-slash-commands)
- [Express Notification API](#express-notification-api)
  - [Endpoints](#endpoints)
  - [Example Requests](#example-requests)
- [Monitoring & Alerting](#monitoring--alerting)
  - [How It Works](#how-it-works)
  - [CPU / GPU Utilization Alerts](#cpu--gpu-utilization-alerts)
  - [Monitoring API Endpoints](#monitoring-api-endpoints)
  - [Monitoring Example Requests](#monitoring-example-requests)
- [CI/CD — GitHub Actions](#cicd--github-actions)
- [Running as a systemd Service](#running-as-a-systemd-service)
- [Troubleshooting](#troubleshooting)
- [Tech Stack](#tech-stack)

---

## Features

| Category | Details |
|---|---|
| **VM Control** | Start, stop, and check status of the G2 GCP VM directly from Discord |
| **Push-Based Notifications** | G2 server pushes lifecycle events (started/stopped/starting/stopping) to the bot |
| **Slash Command Notifications** | `/vm-start` and `/vm-stop` also post to the notifications channel (with who triggered it) |
| **CPU/GPU Alerting** | G2 server pushes utilization metrics; bot alerts on configurable thresholds |
| **Rich Embeds** | Colour-coded status embeds (🟢 Running, 🔴 Stopped, 🟠 Stopping/Staging, 🔵 Provisioning) |
| **Status Details** | Displays instance name, status, machine type, zone, and external IP |
| **Custom Events** | Generic `/notify/event` endpoint for arbitrary notifications |
| **Health Check** | `GET /health` endpoint for uptime and liveness monitoring |
| **Monitoring API** | REST endpoints to report CPU/GPU metrics and check monitoring status |
| **Env Validation** | Startup-time validation of all required environment variables with clear error messages |
| **GCP SA Key Support** | `SA_KEY` env var auto-maps to `GOOGLE_APPLICATION_CREDENTIALS` |
| **CI/CD** | GitHub Actions workflow for automated deployment via SSH |
| **Launch Script** | `start.sh` with pre-flight checks, dependency install, and multiple run modes |

---

## Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │           G2 Server (GCP)                    │
                    │           ML Training VM                     │
                    │                                              │
                    │  ┌──────────────────────────────────┐       │
                    │  │  GCP startup/shutdown scripts     │       │
                    │  │  → POST /notify/started           │       │
                    │  │  → POST /notify/stopping          │       │
                    │  └──────────────────────────────────┘       │
                    │  ┌──────────────────────────────────┐       │
                    │  │  cron: report-cpu.sh              │       │
                    │  │  → POST /monitor/cpu              │       │
                    │  │  cron: report-gpu.sh              │       │
                    │  │  → POST /monitor/gpu              │       │
                    │  └──────────────────────────────────┘       │
                    └──────────────┬───────────────────────────────┘
                                  │ HTTP push events
                                  ▼
┌─────────────────┐   ┌───────────────────────────────────────────┐
│  Discord User   │   │        EC2 Instance (AWS)                 │
│  /vm-start      │   │        Hosts the Discord Bot              │
│  /vm-stop       │   │                                           │
│  /vm-status     │   │  ┌───────────────────┐  ┌──────────────┐  │
└────────┬────────┘   │  │ Discord.js Client │  │ Express :3000│  │
         │            │  │ (bot/bot.js)      │◄─│ /notify/*    │  │
         └───────────►│  │                   │  │ /monitor/*   │  │
                      │  └──────┬────────────┘  └──────────────┘  │
                      │         │ sendNotification()              │
                      │         ▼                                 │
                      │  ┌───────────────────┐  ┌──────────────┐  │
                      │  │ VM Service        │  │ Monitoring   │  │
                      │  │ (vmService.js)    │  │ Service      │  │
                      │  │ start/stop/status │  │ CPU/GPU      │  │
                      │  └──────┬────────────┘  │ alerts       │  │
                      │         │               └──────────────┘  │
                      └─────────┼──────────────────────────────────┘
                                │ @google-cloud/compute
                                ▼
                       ┌────────────────────┐
                       │  Google Cloud       │
                       │  Compute Engine API │
                       └────────────────────┘

                                ▼ Notifications go to ▼
                       ┌────────────────────────────────┐
                       │  Discord #notifications channel │
                       └────────────────────────────────┘
```

---

## Project Structure

```
discordjs/
├── .env.example                 # Environment variable template
├── .gitignore                   # Git ignore rules (.env, node_modules, SA keys)
├── .github/
│   └── workflows/
│       └── main.yml             # GitHub Actions CI/CD deploy pipeline
├── start.sh                     # Bash launch script with pre-flight checks
├── package.json                 # npm config, scripts, and dependencies
├── README.md                    # This file
└── src/
    ├── index.js                 # Entry point — boots bot + Express server
    ├── config.js                # Loads .env, validates required vars, exports config
    ├── bot/
    │   ├── bot.js               # Discord client, interaction handler, notifications
    │   ├── commands.js          # Slash command definitions (/vm-start, /vm-stop, /vm-status)
    │   └── deploy-commands.js   # One-time script to register commands with Discord API
    ├── server/
    │   └── server.js            # Express app — receives push events from G2 server
    └── services/
        ├── vmService.js         # GCP Compute Engine SDK wrapper (start/stop/status)
        └── monitoringService.js # CPU/GPU threshold alerting (push-based)
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js** | v18 or later ([download](https://nodejs.org/)) |
| **npm** | Comes bundled with Node.js |
| **Discord Bot** | Create one at the [Discord Developer Portal](https://discord.com/developers/applications) |
| **Google Cloud Project** | With a Compute Engine VM instance |
| **GCP Authentication** | One of the two options below |

### GCP Authentication Options

| Method | When to use |
|---|---|
| `gcloud auth application-default login` | Local development / personal machine |
| Service account key JSON (`SA_KEY` in `.env`) | Headless servers, CI/CD, containers |

---

## Setup

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd discordjs
npm install
```

### 2. Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Under **Bot** → **Token** → **Reset Token** → copy the token.
3. Under **OAuth2** → **URL Generator**:
   - **Scopes**: `bot`, `applications.commands`
   - **Bot Permissions**: `Send Messages`, `Embed Links`
4. Open the generated URL to invite the bot to your server.
5. Note down your **Application ID** (= Client ID) and your **Guild ID** (right-click your server → Copy Server ID; requires Developer Mode in Discord settings).

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and fill in every value:

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Bot token from step 2 |
| `DISCORD_CLIENT_ID` | ✅ | Application (Client) ID |
| `DISCORD_GUILD_ID` | ✅ | Server (guild) where commands are registered |
| `DISCORD_CHANNEL_ID` | ✅ | **Notifications channel** ID where all alerts and lifecycle events are posted |
| `GCP_PROJECT_ID` | ✅ | Your Google Cloud project ID (for the G2 server) |
| `GCP_ZONE` | ✅ | Zone of the G2 VM (e.g. `asia-southeast1-c`) |
| `GCP_INSTANCE_NAME` | ✅ | Name of the G2 Compute Engine VM instance |
| `SA_KEY` | ✅ | Path to a GCP service account key JSON file |
| `EXPRESS_PORT` | ✅ | Port for the Express server (default: `3000`) |
| `MONITOR_CPU_THRESHOLD` | ❌ | CPU % to trigger alert (default: `80`) |
| `MONITOR_GPU_THRESHOLD` | ❌ | GPU % to trigger alert (default: `80`) |
| `MONITOR_ALERT_COOLDOWN` | ❌ | Cooldown between repeated alerts in ms (default: `300000` = 5 min) |

### 4. GCP Authentication

**Option A — Application Default Credentials (local dev)**

```bash
gcloud auth application-default login
```

**Option B — Service Account Key (production / headless)**

1. In the GCP Console → **IAM & Admin** → **Service Accounts** → create a key (JSON).
2. Save the file (e.g. `gcp-sa-key.json`) in the project root (it's git-ignored).
3. Set `SA_KEY=./gcp-sa-key.json` in `.env`.

> The service account needs at minimum the **Compute Instance Admin (v1)** role (`roles/compute.instanceAdmin.v1`).

### 5. Register Slash Commands

This step only needs to be run **once**, or whenever you add/change slash command definitions:

```bash
npm run deploy-commands
```

You should see:

```
🔄  Registering 3 slash command(s)…
✅  Slash commands registered successfully.
```

### 6. Start the Bot

```bash
npm start
```

Expected output:

```
🤖  Discord bot logged in as YourBot#1234
🌐  Express server listening on port 3000
📡  Waiting for events from G2 server…
```

---

## Using the Launch Script

The provided `start.sh` automates pre-flight validation and startup. Make it executable first:

```bash
chmod +x start.sh
```

| Command | What it does |
|---|---|
| `./start.sh` | Validates environment → starts the bot |
| `./start.sh --deploy` | Validates → deploys slash commands → starts the bot |
| `./start.sh --deploy-only` | Validates → deploys slash commands → exits |
| `./start.sh --check` | Validates environment and dependencies only (dry run) |
| `./start.sh --help` | Shows usage information |

### Pre-flight checks performed

- ✅ Node.js v18+ is installed
- ✅ npm is available
- ✅ `node_modules/` exists (auto-runs `npm install` if missing)
- ✅ `.env` file exists
- ✅ All required environment variables are set and not placeholders
- ✅ GCP authentication is configured

---

## Discord Slash Commands

All three commands use deferred replies and colour-coded rich embeds. `/vm-start` and `/vm-stop` also post notifications to the **#notifications** channel (including who triggered the action).

| Command | Description | Embed Colour | Notifies Channel? |
|---|---|---|---|
| `/vm-start` | Starts the G2 server, waits for completion, confirms | 🔵 → 🟢 | ✅ Starting + Started |
| `/vm-stop` | Stops the G2 server, waits for completion, confirms | 🟠 → 🔴 | ✅ Stopping + Stopped |
| `/vm-status` | Queries GCP and displays current status, name, machine type, zone, external IP | Status-dependent | ❌ |

### Status Colour Map

| VM Status | Colour | Hex |
|---|---|---|
| `RUNNING` | 🟢 Green | `#00C853` |
| `STOPPED` | 🔴 Red | `#D50000` |
| `STOPPING` | 🟠 Orange | `#FF6D00` |
| `STAGING` | 🟡 Amber | `#FFAB00` |
| `PROVISIONING` | 🔵 Blue | `#2979FF` |
| `SUSPENDING` | 🟠 Orange | `#FF6D00` |
| `SUSPENDED` | ⚪ Grey | `#9E9E9E` |
| `TERMINATED` | ⚫ Dark Grey | `#616161` |

---

## Express Notification API

The Express server (default port `3000`) receives push events from the G2 ML training server and posts them to the Discord **#notifications** channel as rich embeds.

### Endpoints

| Method | Path | Request Body | Embed Title | Embed Colour |
|---|---|---|---|---|
| `GET` | `/health` | — | _(returns JSON: `{ status, uptime }`)_ | — |
| `POST` | `/notify/started` | — | ✅  G2 Server Started | 🟢 `#00C853` |
| `POST` | `/notify/stopped` | — | ⛔  G2 Server Stopped | 🔴 `#D50000` |
| `POST` | `/notify/stopping` | — | 🛑  G2 Server Stopping | 🟠 `#FF6D00` |
| `POST` | `/notify/starting` | — | 🚀  G2 Server Starting | 🔵 `#2979FF` |
| `POST` | `/notify/event` | `{ title, description, color? }` | _(custom)_ | _(custom or default grey)_ |

### Example Requests

These would be called **from the G2 server** targeting the EC2 bot's IP:

```bash
BOT_HOST="<ec2-ip-or-hostname>:3000"

# Health check
curl http://$BOT_HOST/health

# Lifecycle events
curl -X POST http://$BOT_HOST/notify/started
curl -X POST http://$BOT_HOST/notify/stopping

# Custom event
curl -X POST http://$BOT_HOST/notify/event \
  -H "Content-Type: application/json" \
  -d '{"title": "Training Complete", "description": "Model v2.1 finished training in 4h 23m.", "color": 65280}'
```

---

## Monitoring & Alerting

The bot receives **push-based metrics** from the G2 server and alerts the Discord #notifications channel when thresholds are exceeded.

### How It Works

The G2 ML training server sends lifecycle events and resource metrics to the bot's Express API over HTTP. The bot evaluates thresholds and posts alerts to Discord. No polling is involved — the flow is fully event-driven.

| Event Source | How it reaches the bot | Notification |
|---|---|---|
| User runs `/vm-start` or `/vm-stop` | Slash command handler in `bot.js` | Posts starting/started or stopping/stopped to #notifications |
| G2 boots (GCP startup script) | `POST /notify/started` to EC2 bot | "G2 Server Started" embed |
| G2 shuts down (GCP shutdown script) | `POST /notify/stopping` to EC2 bot | "G2 Server Stopping" embed |
| G2 starts via GCP Console / `gcloud` | GCP startup script fires automatically | "G2 Server Started" embed |
| CPU is high (cron on G2) | `POST /monitor/cpu` to EC2 bot | "High CPU Utilization" alert |
| GPU is high (cron on G2) | `POST /monitor/gpu` to EC2 bot | "High GPU Utilization" alert |

### CPU / GPU Utilization Alerts

Scripts on the G2 server periodically push CPU and GPU utilization percentages to the bot. When a reported value exceeds the configured threshold, a Discord alert is fired.

| Condition | Embed Colour |
|---|---|
| Utilization ≥ threshold but < 95% | 🟠 Orange (`#FF6D00`) |
| Utilization ≥ 95% | 🔴 Red (`#D50000`) |

Alerts respect a **cooldown window** (default: 5 minutes) to prevent notification spam.

### Monitoring API Endpoints

| Method | Path | Request Body | Description |
|---|---|---|---|
| `POST` | `/monitor/cpu` | `{ "utilization": 85.5 }` | Report CPU usage; triggers alert if above threshold |
| `POST` | `/monitor/gpu` | `{ "utilization": 92.1, "gpuName?": "nvidia-l4" }` | Report GPU usage; triggers alert if above threshold |
| `GET` | `/monitor/status` | — | Returns thresholds, cooldown config, and last alert times |

### Monitoring Example Requests

All examples below are run **from the G2 server**, targeting the EC2 bot:

```bash
BOT_HOST="<ec2-ip-or-hostname>:3000"
```

**Report CPU utilization:**

```bash
curl -X POST http://$BOT_HOST/monitor/cpu \
  -H "Content-Type: application/json" \
  -d '{"utilization": 87.3}'
# → { "success": true, "alerted": true, "utilization": 87.3, "threshold": 80 }
```

**Report GPU utilization:**

```bash
curl -X POST http://$BOT_HOST/monitor/gpu \
  -H "Content-Type: application/json" \
  -d '{"utilization": 95.8, "gpuName": "nvidia-l4"}'
# → { "success": true, "alerted": true, "utilization": 95.8, "threshold": 80 }
```

**Check monitoring status:**

```bash
curl http://$BOT_HOST/monitor/status
```

### Setting Up the G2 Server to Push Events

#### 1. GCP Startup / Shutdown Scripts (VM metadata)

These run automatically whenever the G2 server starts or stops — even when triggered from the GCP Console or `gcloud` CLI.

```bash
# Set the bot's EC2 address
BOT_HOST="<ec2-ip-or-hostname>:3000"

# Add startup script
gcloud compute instances add-metadata <G2_INSTANCE_NAME> \
  --zone=<ZONE> \
  --metadata startup-script="#!/bin/bash
curl -s -X POST http://${BOT_HOST}/notify/started"

# Add shutdown script
gcloud compute instances add-metadata <G2_INSTANCE_NAME> \
  --zone=<ZONE> \
  --metadata shutdown-script="#!/bin/bash
curl -s -X POST http://${BOT_HOST}/notify/stopping"
```

#### 2. CPU Monitoring (cron on G2)

Create `/opt/scripts/report-cpu.sh` on the G2 server:

```bash
#!/bin/bash
BOT_HOST="<ec2-ip-or-hostname>:3000"
CPU=$(top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'.' -f1)
curl -s -X POST http://$BOT_HOST/monitor/cpu \
  -H "Content-Type: application/json" \
  -d "{\"utilization\": $CPU}"
```

```bash
chmod +x /opt/scripts/report-cpu.sh
# Add to crontab (every minute):
(crontab -l; echo "* * * * * /opt/scripts/report-cpu.sh") | crontab -
```

#### 3. GPU Monitoring with `nvidia-smi` (cron on G2)

Create `/opt/scripts/report-gpu.sh` on the G2 server:

```bash
#!/bin/bash
BOT_HOST="<ec2-ip-or-hostname>:3000"
GPU_UTIL=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits | head -1 | tr -d ' ')
GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)
curl -s -X POST http://$BOT_HOST/monitor/gpu \
  -H "Content-Type: application/json" \
  -d "{\"utilization\": $GPU_UTIL, \"gpuName\": \"$GPU_NAME\"}"
```

```bash
chmod +x /opt/scripts/report-gpu.sh
(crontab -l; echo "* * * * * /opt/scripts/report-gpu.sh") | crontab -
```

---

## CI/CD — GitHub Actions

The repository includes a GitHub Actions workflow (`.github/workflows/main.yml`) that automatically deploys the bot on every push to `main`.

### How it works

1. **Checks out** the repository.
2. **Authenticates** with GCP using a service account key stored in GitHub Secrets.
3. **SSH's into the VM** via `gcloud compute ssh`.
4. On the VM it: pulls the latest code (`git fetch` + `git reset --hard`), runs `npm install`, deploys slash commands, and restarts the systemd service.

### Required GitHub Secrets

| Secret | Description |
|---|---|
| `GCP_SA_KEY` | Full JSON content of the GCP service account key |
| `GCP_VM_NAME` | Name of the target VM |
| `GCP_ZONE` | GCP zone (e.g. `asia-southeast1-c`) |
| `GCP_PROJECT_ID` | GCP project ID |
| `DEPLOY_PATH` | Absolute path on the VM where the bot is deployed |
| `SERVICE_NAME` | systemd service name for the bot |

---

## Running as a systemd Service

To keep the bot running persistently on a Linux VM, create a systemd unit file:

```bash
sudo nano /etc/systemd/system/discord-vm-bot.service
```

```ini
[Unit]
Description=Discord GCP VM Controller Bot
After=network.target

[Service]
Type=simple
User=<your-user>
WorkingDirectory=/path/to/discordjs
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/path/to/discordjs/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable discord-vm-bot
sudo systemctl start discord-vm-bot

# Check status
sudo systemctl status discord-vm-bot

# View logs
sudo journalctl -u discord-vm-bot -f
```

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `❌ Missing required env var: …` | `.env` file is missing or a required variable is empty | Copy `.env.example` to `.env` and fill in all values |
| `DiscordAPIError: Unknown Application` | Wrong `DISCORD_CLIENT_ID` | Verify the client ID in the Discord Developer Portal |
| `DiscordAPIError: Missing Access` | Bot lacks permissions or wrong `GUILD_ID` | Re-invite the bot with correct scopes; verify the guild ID |
| Slash commands don't appear | Commands haven't been registered | Run `npm run deploy-commands` |
| Slash commands appear but don't respond | Bot is offline or crashed | Check `npm start` output for errors |
| `Error: Could not load the default credentials` | No GCP auth configured | Run `gcloud auth application-default login` or set `SA_KEY` in `.env` |
| `Permission 'compute.instances.start' denied` | SA lacks Compute Admin role | Grant `roles/compute.instanceAdmin.v1` to the service account |
| Notifications not posting | Wrong `DISCORD_CHANNEL_ID` | Ensure the channel ID is correct and the bot has send-message access |
| `EADDRINUSE: address already in use` | Port conflict | Change `EXPRESS_PORT` in `.env` or kill the conflicting process |
| CPU/GPU alerts not firing | Utilization below threshold or cooldown active | Check thresholds in `.env`; lower `MONITOR_ALERT_COOLDOWN` for testing |
| G2 events not reaching bot | Network / firewall issue | Ensure EC2 security group allows inbound on `EXPRESS_PORT` from G2's IP |
| G2 started but no notification | Startup script not set | Set GCP instance metadata `startup-script` (see [G2 setup](#setting-up-the-g2-server-to-push-events)) |

---

## Tech Stack

| Dependency | Version | Purpose |
|---|---|---|
| [discord.js](https://discord.js.org/) | ^14.26.2 | Discord API client — slash commands, embeds, gateway |
| [@google-cloud/compute](https://cloud.google.com/nodejs/docs/reference/compute/latest) | ^6.9.0 | GCP Compute Engine SDK — start/stop/status |
| [express](https://expressjs.com/) | ^5.2.1 | HTTP server for notification webhooks |
| [dotenv](https://github.com/motdotla/dotenv) | ^17.4.1 | Load `.env` variables into `process.env` |

### npm Scripts

| Script | Command | Description |
|---|---|---|
| `start` | `npm start` | Run the bot + Express server |
| `deploy-commands` | `npm run deploy-commands` | Register slash commands with the Discord API |

---