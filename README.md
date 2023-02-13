![Banner image](https://raw.githubusercontent.com/HolyNetworkAdapter/collabvm-1.2.ts/master/cvmserver.png "Banner image")
# CollabVM1.ts
This is a drop-in replacement for the dying CollabVM 1.2.11. Currently in beta

## Running
1. Copy config.example.toml to config.toml, and fill out fields
2. Install dependencies: `npm i`
3. Build it: `npm run build`
4. Run it: `npm run serve`

## FAQ
### When I try to access the admin panel, the server crashes!
The server does not support the admin panel. Instead, there is a configuration file you can edit named config.toml.
### Why only QEMU? Why not VMWare, VirtualBox, etc.?
This server was written very quickly to replace CollabVM Server 1.2.11, and so only QEMU support exists. There are plans to support VMWare when CollabVM Server 3 releases.
### What platforms can this be run on?
If it can run a relatively new version of Node and QEMU, then you can run this. This means modern Linux distributions, modern macOS versions and Windows 10 and above.
### When the VM shuts off, instead of restarting, it freezes.
This has been fixed already, you are running a copy of the code before February 11th, 2023.
