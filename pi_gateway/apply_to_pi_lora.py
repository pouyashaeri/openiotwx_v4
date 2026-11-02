#!/usr/bin/env python3
"""
Adds website upload to the gateway's pi_lora.py, and writes the "site" settings into pi_config.json.

Run it on the Raspberry Pi, in the edge-servers folder, after copying site_uploader.py next to pi_lora.py:

    python3 apply_to_pi_lora.py pi_lora.py --url http://192.168.0.2:8080 --key THE_KEY_FROM_THE_DEPLOY_PAGE

It changes three lines of pi_lora.py (an import, creating the uploader, and handing it each packet), keeps a
copy as pi_lora.py.bak, checks the result still compiles, and puts the old file back if it does not.
Running it twice does nothing the second time.

    --check    only say whether the file can be patched, change nothing
    --station-key SID=KEY   one key per station id (repeat it). Without it, --key is used for every station.

To undo:  cp pi_lora.py.bak pi_lora.py
"""

import argparse
import json
import py_compile
import re
import shutil
import sys
from pathlib import Path

# Each edit: the exact text to find (it must appear once) and what to put in its place.
EDITS = [
    (
        "import math\n",
        "import math\nfrom site_uploader import SiteUploader  # also sends readings to an OpenIoTwx website\n",
    ),
    (
        "    legacy_topic = config.get('mqtt', {}).get('legacy_topic', 'ncar/iotwx/co/boulder/rp2040_test')\n",
        "    legacy_topic = config.get('mqtt', {}).get('legacy_topic', 'ncar/iotwx/co/boulder/rp2040_test')\n"
        "\n"
        "    site = SiteUploader(config)\n"
        "    site.start()\n",
    ),
    (
        "                    publish_legacy_format(mqtt_client, lora_msg, legacy_topic)\n",
        "                    publish_legacy_format(mqtt_client, lora_msg, legacy_topic)\n"
        "                site.offer(lora_msg)\n",
    ),
]


# A station key is iotwx_ and 32 letters, digits, dashes or underscores. Anything else is not a real key.
KEY_SHAPE = re.compile(r"^iotwx_[A-Za-z0-9_-]{32}$")


def patch_code(path, check_only):
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    if "SiteUploader" in text:
        print(f"{path.name} already has the website upload. Nothing to change there.")
        return True
    for find, _ in EDITS:
        found = text.count(find)
        if found != 1:
            print(f"Cannot patch {path.name}: expected to find this exactly once, found {found}:\n    {find.strip()}")
            print("The file differs from the one this patch was written for. Ask for an updated patch.")
            return False
    if check_only:
        print(f"{path.name} can be patched.")
        return True
    for find, put in EDITS:
        text = text.replace(find, put, 1)
    backup = path.with_name(path.name + ".bak")
    if not backup.exists():
        shutil.copy2(path, backup)
    path.write_text(text, encoding="utf-8")
    try:
        py_compile.compile(str(path), doraise=True)
    except py_compile.PyCompileError as error:
        shutil.copy2(backup, path)
        print(f"The patched file did not compile, so the original was put back:\n{error}")
        return False
    print(f"Patched {path.name} (the original is kept as {backup.name}).")
    return True


def write_settings(config_path, url, key, station_keys):
    config = json.loads(config_path.read_text(encoding="utf-8")) if config_path.exists() else {}
    site = config.get("site") or {}
    site["url"] = url.rstrip("/")
    site["enabled"] = True
    if key:
        site["api_key"] = key
    if station_keys:
        site["station_keys"] = {**(site.get("station_keys") or {}), **station_keys}
    site.setdefault("flush_seconds", 5)
    config["site"] = site
    backup = config_path.with_name(config_path.name + ".bak")
    if config_path.exists() and not backup.exists():
        shutil.copy2(config_path, backup)
    config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(f'Wrote the "site" settings into {config_path.name}.')


def main():
    parser = argparse.ArgumentParser(description="Add website upload to the gateway.")
    parser.add_argument("file", nargs="?", default="pi_lora.py", help="the gateway script (default: pi_lora.py)")
    parser.add_argument("--check", action="store_true", help="only check that it can be patched")
    parser.add_argument("--url", help="the website address, e.g. http://192.168.0.2:8080")
    parser.add_argument("--key", help="a station's API key, used for every station the gateway hears")
    parser.add_argument("--station-key", action="append", default=[], metavar="SID=KEY", help="an API key for one station id (repeat for more)")
    parser.add_argument("--config", help="pi_config.json (default: next to the script)")
    args = parser.parse_args()

    script = Path(args.file)
    if not script.exists():
        sys.exit(f"{script} not found. Run this in the edge-servers folder.")
    if not (script.parent / "site_uploader.py").exists() and not args.check:
        sys.exit(f"Copy site_uploader.py next to {script.name} first (cp ~/pi_gateway/site_uploader.py {script.parent}/).")

    station_keys = {}
    for pair in args.station_key:
        sid, _, value = pair.partition("=")
        if not sid or not KEY_SHAPE.match(value):
            sys.exit(f"--station-key wants STATION_ID=the real key, got: {pair}\nThat is not a station key. Copy the key from the station's Deploy page (Make a key and show settings).")
        station_keys[sid] = value
    if args.key and not KEY_SHAPE.match(args.key):
        sys.exit(f"That is not a station key: {args.key}\nA real key looks like iotwx_ followed by 32 letters and digits. Copy it from the station's Deploy page (Make a key and show settings).")

    if not patch_code(script, args.check):
        sys.exit(1)
    if args.check:
        return
    if args.url:
        if not (args.key or station_keys):
            sys.exit("Give --key (or --station-key) along with --url.")
        write_settings(Path(args.config) if args.config else script.with_name("pi_config.json"), args.url, args.key, station_keys)
    else:
        print('Next: add a "site" section to pi_config.json (see README.md), or run this again with --url and --key.')
    print("Then restart the gateway:  sudo systemctl restart lora-gateway")


if __name__ == "__main__":
    main()
