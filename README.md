# CollabVM1.ts
This is a drop-in replacement for the dying CollabVM 1.2.11. Currently in beta

## Compatibility

The CollabVM server will run on any Operating System that can run Node.JS and Rust. This means modern Linux distributions and Windows versions.

We do not recommend or support running CollabVM Server on Windows due to very poor support for QEMU on that platform.

## Dependencies

The CollabVM server requires the following to be installed on your server:

1. Node.js (obviously)
2. QEMU (Unless you just want to use a VNC Connection as your VM)
3. A Rust toolchain (e.g: [rustup](https://rustup.rs))
4. NASM assembler

### Installing dependencies on Arch

1. Install dependencies: `sudo pacman --needed --noconfirm -Sy nodejs nasm rust`
2. Enable corepack: `sudo corepack enable`

### Installing dependencies on Debian

1. Install dependencies: `sudo apt-get install -y git nasm build-essential cmake curl`
2. Install nodeJS: `curl -fsSL https://deb.nodesource.com/setup_21.x | sudo bash - && sudo apt-get install nodejs -y`
3. Install Rust toolchain: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` then logout and relogin
4. Enable corepack: `sudo corepack enable`

## Running

**TODO**: These instructions are not finished for the refactor branch.

1. Copy config.example.toml to config.toml, and fill out fields
2. Install dependencies: `yarn`
3. Build it: `yarn build`
4. Run it: `yarn serve`
