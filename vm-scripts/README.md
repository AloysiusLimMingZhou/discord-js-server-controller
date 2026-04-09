# vm-scripts

Shell scripts that run **on the target VM (AI server)** to push lifecycle notifications to the **bot VM**'s Express server.

## How preemption detection works

GCP exposes a metadata endpoint that changes value right before the target VM (AI server) is forcibly terminated by GCP:

```
http://metadata.google.internal/computeMetadata/v1/instance/maintenance-event
```

| Value | Meaning |
|---|---|
| `NONE` | VM is running normally |
| `TERMINATE` | **GCP is about to preempt this Spot VM** |

This endpoint only changes to `TERMINATE` for **GCP-initiated** preemptions. Manual shutdowns — via `gcloud compute instances stop`, the GCP Console stop button, `sudo shutdown`, or `sudo poweroff` — do **not** trigger this event. This is the key property that lets us distinguish the two cases.

The `preemption-watcher.sh` daemon runs on the **target VM (AI server)** and uses the metadata server's **long-poll** API (`?wait_for_change=true`) — the `curl` call blocks idle until the value actually changes, with negligible CPU overhead.

## Files

| File | Purpose |
|---|---|
| `preemption-watcher.sh` | Daemon. Long-polls metadata; calls `/notify/stopping` on preemption only. |
| `preemption-watcher.service` | systemd unit for the daemon. |
| `startup-notify.sh` | One-shot. Calls `/notify/started` on every VM boot (with retry). |
| `startup-notify.service` | systemd unit for the startup notifier. |
| `install.sh` | Installer. Copies scripts + services, enables and starts them. |

## Requirements

- The **target VM (AI server)** must be able to reach the **bot VM** over the network (TCP on the Express port, default `3000`).
- `curl` must be installed on the target VM (AI server) — present on all standard GCP images.

## Setup

### 1. Copy the scripts to the target VM (AI server)

```bash
# Run this from your local machine — uploads vm-scripts/ to the target VM (AI server)
gcloud compute scp --recurse vm-scripts/ TARGET_VM_NAME:~/vm-scripts \
  --zone YOUR_ZONE
```

### 2. SSH into the target VM (AI server) and run the installer

```bash
gcloud compute ssh TARGET_VM_NAME --zone YOUR_ZONE

# Inside the target VM (AI server):
cd ~/vm-scripts
sudo bash install.sh --bot-url http://BOT_VM_IP:3000
```

That's it. The installer will:
- Copy scripts to `/opt/vm-scripts/`
- Install both systemd service files
- Enable them so they survive reboots
- Start the preemption watcher immediately

### 3. Verify

```bash
# On the target VM (AI server) — watch the preemption watcher logs in real time
sudo journalctl -u preemption-watcher -f

# Check that the startup notifier ran on last boot
sudo journalctl -u startup-notify

# Check service status
sudo systemctl status preemption-watcher
sudo systemctl status startup-notify
```

## What gets notified

| Event | Notification sent? | Endpoint called |
|---|---|---|
| Target VM (AI server) boots | ✅ Yes | `POST /notify/started` |
| GCP preempts target VM (AI server) | ✅ Yes | `POST /notify/stopping` |
| `gcloud compute instances stop` | ❌ No | — |
| GCP Console "Stop" button | ❌ No | — |
| `sudo shutdown` / `sudo poweroff` via SSH | ❌ No | — |

## Troubleshooting

**Watcher exits immediately on start**  
Check that `BOT_URL` in the service file points to the correct bot VM address. Test reachability from the target VM (AI server):
```bash
curl -X POST http://BOT_VM_IP:3000/notify/event \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","description":"reachability test from target VM"}'
```

**Startup notification not received after reboot**  
Check the oneshot service on the target VM (AI server):
```bash
sudo journalctl -u startup-notify --boot -1
```

**Manually test the preemption notification**  
(Does not actually preempt the target VM — only sends the HTTP request to the bot VM.)
```bash
curl -X POST http://BOT_VM_IP:3000/notify/stopping \
  -H "Content-Type: application/json" \
  -d '{}'
```
