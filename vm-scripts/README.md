# vm-scripts

Shell scripts that run **on the target VM (AI server)** to push lifecycle notifications to the **bot VM**'s Express server.

## How it works

### Startup notification

`startup-notify.sh` is a systemd oneshot service that runs automatically on every VM boot. It POSTs to `/notify/started` on the bot VM so Discord is notified whenever the G2 server starts — regardless of how it was started (GCP Console, `gcloud`, reboot, etc.).

### Shutdown notification

`shutdown-notify.sh` uses a systemd `ExecStop=` trick to fire during **any** system shutdown. The service starts as a no-op (`/bin/true`) and stays "active" via `RemainAfterExit=yes`. When the system shuts down, systemd stops all services — which triggers `ExecStop=`, running the shutdown script.

This catches **all** shutdown types:
- GCP Console "Stop" button
- `gcloud compute instances stop`
- `sudo shutdown` / `sudo poweroff` via SSH
- GCP Spot preemption (preemption-watcher also fires — having both is fine)

### Preemption detection

GCP exposes a metadata endpoint that changes value right before the target VM (AI server) is forcibly terminated by GCP:

```
http://metadata.google.internal/computeMetadata/v1/instance/maintenance-event
```

| Value | Meaning |
|---|---|
| `NONE` | VM is running normally |
| `TERMINATE` | **GCP is about to preempt this Spot VM** |

This endpoint only changes to `TERMINATE` for **GCP-initiated** preemptions. The `preemption-watcher.sh` daemon uses the metadata server's **long-poll** API (`?wait_for_change=true`) — the `curl` call blocks idle until the value actually changes, with negligible CPU overhead.

> **Note:** The preemption watcher provides an *additional* early-warning notification specifically for Spot VM preemptions. The shutdown-notify service will also fire during preemptions, so you get two notifications — one identifying it as a preemption, and one as a generic shutdown.

## Files

| File | Purpose |
|---|---|
| `startup-notify.sh` | One-shot. Calls `/notify/started` on every VM boot (with retry). |
| `startup-notify.service` | systemd unit for the startup notifier. |
| `shutdown-notify.sh` | One-shot. Calls `/notify/stopping` on every VM shutdown. |
| `shutdown-notify.service` | systemd unit for the shutdown notifier (uses `ExecStop=` trick). |
| `preemption-watcher.sh` | Daemon. Long-polls metadata; calls `/notify/stopping` on preemption only. |
| `preemption-watcher.service` | systemd unit for the daemon. |
| `install.sh` | Installer. Copies scripts + services, enables and starts them. |

## Requirements

- The **target VM (AI server)** must be able to reach the **bot VM** over the network (TCP on the Express port, default `80` or `443` via reverse proxy).
- `curl` must be installed on the target VM (AI server) — present on all standard GCP images.

## Setup

### 1. Copy the scripts to the target VM (AI server)

> **Windows users:** The `gcloud compute scp` command on Windows uses PuTTY's `pscp.exe`, which does not expand `~`. Use the commands below instead of `~/vm-scripts`.

```bash
# Step 1: Remove any old vm-scripts folder on the AI server
gcloud compute ssh TARGET_VM_NAME --zone YOUR_ZONE --command "rm -rf ~/vm-scripts"

# Step 2: Create a fresh directory on the AI server
gcloud compute ssh TARGET_VM_NAME --zone YOUR_ZONE --command "mkdir -p ~/vm-scripts"

# Step 3: Upload the scripts
gcloud compute scp --recurse vm-scripts/* TARGET_VM_NAME:vm-scripts/ --zone YOUR_ZONE
```

### 2. SSH into the target VM (AI server) and run the installer

```bash
gcloud compute ssh TARGET_VM_NAME --zone YOUR_ZONE

# Inside the target VM (AI server):
cd ~/vm-scripts
sudo bash install.sh --bot-url https://naic-bot.chocorot.net
```

That's it. The installer will:
- Copy scripts to `/opt/vm-scripts/`
- Install all three systemd service files
- Enable them so they survive reboots
- Start the preemption watcher and shutdown notifier immediately

### 3. Verify

```bash
# On the target VM (AI server) — watch the preemption watcher logs in real time
sudo journalctl -u preemption-watcher -f

# Check that the startup notifier ran on last boot
sudo journalctl -u startup-notify

# Check that the shutdown notifier is active (waiting for shutdown)
sudo systemctl status shutdown-notify

# Check all service statuses
sudo systemctl status preemption-watcher
sudo systemctl status startup-notify
sudo systemctl status shutdown-notify
```

## What gets notified

| Event | Notification sent? | Which service | Endpoint called |
|---|---|---|---|
| Target VM (AI server) boots | ✅ Yes | `startup-notify` | `POST /notify/started` |
| GCP preempts target VM (AI server) | ✅ Yes (×2) | `preemption-watcher` + `shutdown-notify` | `POST /notify/stopping` |
| `gcloud compute instances stop` | ✅ Yes | `shutdown-notify` | `POST /notify/stopping` |
| GCP Console "Stop" button | ✅ Yes | `shutdown-notify` | `POST /notify/stopping` |
| `sudo shutdown` / `sudo poweroff` via SSH | ✅ Yes | `shutdown-notify` | `POST /notify/stopping` |

## Troubleshooting

**Watcher exits immediately on start**
Check that `BOT_URL` in the service file points to the correct bot VM address. Test reachability from the target VM (AI server):
```bash
curl -X POST https://naic-bot.chocorot.net/notify/event \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","description":"reachability test from target VM"}'
```

**Startup notification not received after reboot**
Check the oneshot service on the target VM (AI server):
```bash
sudo journalctl -u startup-notify --boot -1
```

**Shutdown notification not received after stopping**
Check the shutdown-notify service logs:
```bash
sudo journalctl -u shutdown-notify
```
Ensure the service was active before shutdown:
```bash
sudo systemctl status shutdown-notify
```
If it shows `inactive`, start it manually:
```bash
sudo systemctl start shutdown-notify
```

**Manually test the preemption notification**
(Does not actually preempt the target VM — only sends the HTTP request to the bot VM.)
```bash
curl -X POST https://naic-bot.chocorot.net/notify/stopping \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Line ending issues (Windows)**
If you get `$'\r': command not found` errors, the scripts have Windows-style (CRLF) line endings. The `.gitattributes` file in this directory should prevent this, but if it happens, convert the files on the VM:
```bash
sed -i 's/\r$//' ~/vm-scripts/*.sh
```
