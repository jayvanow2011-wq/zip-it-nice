# Veltrix Build Server

Standalone Python build server that compiles Rust agents into `.exe` files.

## Setup

```bash
pip install -r requirements.txt
rustup target add x86_64-pc-windows-gnu
# On Ubuntu/Debian: sudo apt install gcc-mingw-w64-x86-64
```

## Usage

```bash
# Connect to local panel
python3 app.py

# Connect to remote panel
python3 app.py --url https://your-panel.com --key hc-builder-f7a92c3d1e8b4506

# Or use environment variables
HC_PANEL_URL=https://your-panel.com HC_BUILDER_KEY=your-key python3 app.py
```

## How it works

1. On startup, syncs Rust agent source files from the panel
2. Polls the panel every 5 seconds for new build jobs
3. When a job arrives: writes source, runs `cargo build`, uploads the `.exe`
4. Re-syncs source files every 5 minutes to pick up updates
