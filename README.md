![Banner image](https://raw.githubusercontent.com/HolyNetworkAdapter/collabvm-1.2.ts/master/cvmserver.png "Banner image")
# CollabVM1.ts
This is a drop-in replacement for the dying CollabVM 1.2.11. Currently in beta

## Running
1. Copy config.example.toml to config.toml, and fill out fields
2. Install dependencies: `npm i`
3. Build it: `npm run build`
4. Run it: `npm run serve`

# FAQ
## When I try to access the admin panel, the server crashes!
The server does not support the admin panel. Instead, there is a configuration file you can edit named config.toml.
## Why only QEMU? Why not VMWare, VirtualBox, etc.?
We have stuck with QEMU since 2015, but you could possibly add code to make the server connect to a VNC server (or RDP, if you're using VirtualBox) and display that. Note that vote resets won't work.
## What platforms can this be run on?
If it can run a relatively new version of Node and QEMU, then you can run this. This means modern Linux distributions, modern macOS versions and Windows 10 and above.
