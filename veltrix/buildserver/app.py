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
import re
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

DEFAULT_URL = os.environ.get("VELTRIX_PANEL_URL", "http://localhost:3001")
DEFAULT_KEY = os.environ.get("VELTRIX_BUILDER_KEY", "")   # must match VELTRIX_BUILDER_KEY in server.js .env
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
                # Support nested paths like "src/main.rs" or ".cargo/config.toml"
                safe = name.replace("\\", "/").lstrip("/")
                dest = SOURCES_DIR / safe
                dest.parent.mkdir(parents=True, exist_ok=True)
                existing = dest.read_text() if dest.exists() else ""
                if existing != content:
                    dest.write_text(content)
                    changed += 1
                    log("info", f"  Updated: {safe}")
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
            # 1) Seed build dir with the entire synced source tree (main.rs,
            #    Cargo.toml, all modules, .cargo/config.toml, everything).
            if SOURCES_DIR.exists():
                for root, dirs, filenames in os.walk(SOURCES_DIR):
                    # skip anything cargo-generated
                    dirs[:] = [d for d in dirs if d != "target"]
                    for fname in filenames:
                        src_abs = Path(root) / fname
                        rel = src_abs.relative_to(SOURCES_DIR)
                        dst_abs = build_dir / rel
                        dst_abs.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(src_abs, dst_abs)

            # 2) Overlay per-job generated files (main.rs, Cargo.toml, etc.).
            #    Bare filenames land in src/ unless they're project-root files.
            ROOT_FILES = {"Cargo.toml", "Cargo.lock", "build.rs", "rust-toolchain", "rust-toolchain.toml"}
            for name, content in sources.items():
                safe = name.replace("\\", "/").lstrip("/")
                if "/" in safe:
                    dest = build_dir / safe
                elif safe in ROOT_FILES or safe.startswith("."):
                    dest = build_dir / safe
                else:
                    dest = src_dir / safe
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(content)

            # 3) On Linux/macOS hosts, write the mingw linker config for
            #    cross-compile. On Windows we build natively — no config needed.
            if sys.platform != "win32":
                cargo_cfg = build_dir / ".cargo" / "config.toml"
                cargo_cfg.parent.mkdir(parents=True, exist_ok=True)
                cargo_cfg.write_text(
                    '[target.x86_64-pc-windows-gnu]\n'
                    'linker = "x86_64-w64-mingw32-gcc"\n'
                    'ar = "x86_64-w64-mingw32-ar"\n'
                    'dlltool = "x86_64-w64-mingw32-dlltool"\n'
                )

            # 4) Preflight: every `mod X;` declared in main.rs must have a
            #    matching src/X.rs — fail fast with a clear message otherwise.
            main_rs = src_dir / "main.rs"
            if main_rs.exists():
                declared = re.findall(r"^\s*mod\s+([A-Za-z0-9_]+)\s*;", main_rs.read_text(encoding="utf-8", errors="replace"), re.M)
                missing = [m for m in declared if not (src_dir / f"{m}.rs").exists() and not (src_dir / m / "mod.rs").exists()]
                if missing:
                    msg = f"Missing module file(s): {', '.join('src/' + m + '.rs' for m in missing)}"
                    log("err", f"  {msg}")
                    return False, msg, None

            # Run cargo build — native target on Windows, cross-compile elsewhere
            if sys.platform == "win32":
                log("info", "  cargo build --release ... (native Windows)")
                result = subprocess.run(
                    ["cargo", "build", "--release"],
                    cwd=str(build_dir),
                    capture_output=True,
                    text=True,
                    timeout=600,
                    shell=False,
                )
            else:
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

            # Find exe (native vs cross-compile target dir)
            if sys.platform == "win32":
                exe_path = build_dir / "target" / "release" / f"{build_name}.exe"
            else:
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

    def preflight(self):
        """Verify toolchain. On Windows: cargo + MSVC build tools. Elsewhere: cargo + windows-gnu target + mingw."""
        # cargo
        if not shutil.which("cargo"):
            log("err", "cargo not found in PATH — install Rust from https://rustup.rs")
            return False

        # On Windows we build natively — nothing else required.
        if sys.platform == "win32":
            log("ok", "Toolchain OK (cargo, native Windows build)")
            return True

        # Windows GNU std target — this is what caused `can't find crate for std`
        try:
            r = subprocess.run(["rustup", "target", "list", "--installed"],
                               capture_output=True, text=True, timeout=30)
            installed = r.stdout.split() if r.returncode == 0 else []
        except Exception:
            installed = []

        if "x86_64-pc-windows-gnu" not in installed:
            log("warn", "Windows GNU target missing — installing x86_64-pc-windows-gnu ...")
            try:
                r = subprocess.run(
                    ["rustup", "target", "add", "x86_64-pc-windows-gnu"],
                    capture_output=True, text=True, timeout=300,
                )
                if r.returncode == 0:
                    log("ok", "Installed target x86_64-pc-windows-gnu")
                else:
                    log("err", f"Failed to add target: {r.stderr[-300:]}")
                    return False
            except FileNotFoundError:
                log("err", "rustup not found — install Rust via rustup so the Windows target can be added")
                return False

        # mingw linker (needed on Linux/macOS hosts)
        missing = [t for t in ("x86_64-w64-mingw32-gcc", "x86_64-w64-mingw32-dlltool") if not shutil.which(t)]
        if missing:
            log("err", f"Missing mingw tools: {', '.join(missing)}. Install mingw-w64:")
            log("err", "  Debian/Ubuntu: sudo apt install mingw-w64")
            log("err", "  Fedora:        sudo dnf install mingw64-gcc mingw64-binutils")
            log("err", "  Arch:          sudo pacman -S mingw-w64-gcc mingw-w64-binutils")
            log("err", "  macOS:         brew install mingw-w64")
            return False


        log("ok", "Toolchain OK (cargo + x86_64-pc-windows-gnu + mingw linker)")
        return True

    def run(self):
        log("info", f"Veltrix Build Server starting")
        log("info", f"Panel: {self.url}")
        log("info", f"Poll interval: {POLL_INTERVAL}s")
        print()

        if not self.preflight():
            log("err", "Preflight failed — fix the toolchain above, then re-run.")
            sys.exit(1)

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
    parser.add_argument("--url", default=DEFAULT_URL,
                        help="Panel URL (default: %(default)s or $VELTRIX_PANEL_URL)")
    parser.add_argument("--key", default=DEFAULT_KEY,
                        help="Builder secret key (default: $VELTRIX_BUILDER_KEY)")
    parser.add_argument("--interval", type=int, default=POLL_INTERVAL,
                        help="Poll interval in seconds (default: %(default)s)")
    args = parser.parse_args()

    POLL_INTERVAL = args.interval
    server = BuildServer(args.url, args.key)
    server.run()
