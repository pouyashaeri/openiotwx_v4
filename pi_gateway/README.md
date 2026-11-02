# Raspberry Pi gateway to the OpenIoTwx website

The gateway code in `mesonet-siparcs25/edge-servers` (`pi_lora.py`) sends every reading to NCAR's MQTT broker in the old text format. That never reaches an OpenIoTwx website. This folder adds a second path next to it: each reading is also posted to the website with the station's API key. The NCAR path is left exactly as it was.

| File | What it is |
| --- | --- |
| `site_uploader.py` | The uploader. Standard library only, nothing to install on the Pi. |
| `apply_to_pi_lora.py` | Adds three lines to `pi_lora.py` and writes the settings into `pi_config.json`. Keeps a backup. |
| `sim_gateway.py` | Pretends to be the gateway hearing an RP2040, so you can test the website side with no Pi. |
| `test_pi_gateway.py` | Tests. Run: `python -m unittest pi_gateway/test_pi_gateway.py` |

## 1. Test the website side first (no Pi needed)

Start the site (`npm run dev`), register a station, and copy its API key from the station's **Deploy** page. Then:

```
python pi_gateway/sim_gateway.py --url http://localhost:8080 --key THE_KEY_FROM_THE_DEPLOY_PAGE --rounds 3 --every 1
```

Open the station's page. You should see Air temperature, Humidity and Pressure, and the station placed at 40.010, -105.270 with a 1655 m elevation (from the simulated GPS packets).

## 2. Put it on the Pi

The gateway already runs as a service called `lora-gateway` (it starts at every boot). You do not need to stop it by hand or touch the virtual environment. You restart the service after changing the code.

**On your computer** (PowerShell, in the project folder), copy this folder to the Pi:

```
scp -r pi_gateway ncar@openiotwx-pi.local:~/
```

**On the Pi:**

```
cd ~/mesonet-siparcs25/edge-servers
cp ~/pi_gateway/site_uploader.py .
python3 ~/pi_gateway/apply_to_pi_lora.py pi_lora.py --check
```

`--check` only says whether the file can be patched. If it says it can:

```
python3 ~/pi_gateway/apply_to_pi_lora.py pi_lora.py --url http://YOUR_COMPUTER_IP:8080 --key THE_KEY_FROM_THE_DEPLOY_PAGE
sudo systemctl restart lora-gateway
journalctl -u lora-gateway -f
```

In the log you should see `Site upload on: http://...` and then, as stations are heard, `Sent N readings to the site`.

`YOUR_COMPUTER_IP` is the address of the computer running `npm run dev`. The dev server prints it as the Network address (for example `http://192.168.0.2:8080`). The Pi has to be on the same network.

### If the Pi cannot reach the site

On the Pi: `curl -s http://YOUR_COMPUTER_IP:8080/api/health`. If that gives no answer:

- The computer's firewall may block port 8080. On Windows, an administrator can allow it for the private network: `New-NetFirewallRule -DisplayName "OpenIoTwx dev 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private`.
- The computer's address may have changed. Give it a fixed address in your router, or update the `url` in `pi_config.json` and restart the service.

While the site is unreachable, the Pi keeps the readings (up to 5000) and sends them when it is back, oldest first.

## Which station do the readings belong to?

One API key is one station. With `--key`, every radio station the Pi hears is stored under that one station. That is fine for one RP2040. If the Pi hears several, register one station for each on the website and give each its own key by the RP2040's id (it appears in the gateway log as `sid`):

```
python3 ~/pi_gateway/apply_to_pi_lora.py pi_lora.py --url http://YOUR_COMPUTER_IP:8080 \
  --station-key DF643CF0136D5D26=THE_KEY_OF_THAT_STATION \
  --station-key 0A1B2C3D4E5F6071=THE_KEY_OF_THE_OTHER
```

A station with no key is skipped and the log says so (once).

The key must be the real one: `iotwx_` followed by 32 letters and digits, copied from the station's **Deploy** page (**Make a key and show settings**; it is shown only once). The script refuses anything else, such as the example text.

## The settings

They live in a `site` section of `pi_config.json`:

```json
"site": {
  "url": "http://192.168.0.2:8080",
  "api_key": "iotwx_...",
  "station_keys": { "DF643CF0136D5D26": "iotwx_..." },
  "flush_seconds": 5,
  "enabled": true
}
```

Set `"enabled": false` to turn the website upload off without removing anything.

## Undo

```
cd ~/mesonet-siparcs25/edge-servers
cp pi_lora.py.bak pi_lora.py
sudo systemctl restart lora-gateway
```

## Good to know

- **Keep the key private.** `pi_config.json` now holds it. It is a plain file on the Pi, so do not commit it to a repository.
- **The NCAR path keeps working.** The old text format still goes to the broker in `pi_config.json`, as before.
- **A wrong key** is reported in the log and those readings are dropped (not retried for ever). Make a new key on the station's Deploy page.
- **Plain HTTP** is fine on a lab network. Across the internet, put the site behind HTTPS and use an `https://` url.
- **GPS and elevation:** the position packets from the RP2040 move the station on the map and set its elevation. A station that has no GPS keeps whatever location you set on its page.
- **Updating the gateway code:** if you run `git pull` in `mesonet-siparcs25`, it may refuse because `pi_lora.py` was changed. Undo the patch first, pull, and apply it again.
- **Tested:** the uploader and the patcher are tested here, and a simulated gateway was sent to a real website. It has not been run on a real Pi, radio or RP2040 yet.
