# CollabVM1.2.ts

## Prerequisites

You'll need:

- A machine with decent specs (8GB of RAM and a modern CPU, probably)
- A Linux distribution; You can pick any mainstream distro, for the purposes of this guide I recommend either Debian or Arch, or their OpenRC counterparts if you prefer OpenRC. Yes, Ubuntu will work, it's terrible though
**If you REALLY want to run CollabVM on Windows, there is an unofficial and unsupported guide for that at [[UserVM Handbook/Windows]]**
- A decently fast network that allows you to forward a port. We will not accept UserVMs behind services like ngrok. Cloudflare tunnels are fine. You must also have a URL that stays persistent. If your IP is dynamic, you can use services like NOIP or setup a script to auto-update your domain using cloudflare.
- Basic knowledge of how computers and Linux systems work. We aren't going to hold your hand, you need to be comfortable with a command line
**IF YOU DO NOT UNDERSTAND HOW TO FOLLOW THE INSTRUCTIONS IN THIS GUIDE, DO NOT HOST PUBLIC INTERNET CONNECTED VMS ON THE INTERNET THAT ANYONE CAN ACCESS**
- A few hours

## Handbook: How to setup your own CVM server

### Install Dependencies

First up make sure you have git, nasm, cmake, and a C(++) compiler installed

```sh
user@myownserver:~$ sudo pacman --needed --noconfirm -Sy git nasm base-devel cmake # Arch
user@myownserver:~$ sudo apt install -y git nasm build-essential cmake # On Debian/Ubuntu
```

Next, we need to install Node.js.

First, we'll install node. On arch, you can just run the following command:

```sh
user@myownserver:~$ sudo pacman --needed -S npm nodejs
```

On Debian/Ubuntu, the packaged node version is too old to run CollabVM, so we'll add the nodesource repository.

```sh
user@myownserver:~$ sudo apt install -y curl
user@myownserver:~$ curl -fsSL https://deb.nodesource.com/setup_21.x | sudo bash -
user@myownserver:~$ sudo apt install nodejs -y
```

Enable Corepack:

```sh
user@myownserver:~$ sudo corepack enable
```

### Prepare the server

Now let's get the server ready. First, we'll create a dedicated CollabVM user to run the server from `/srv/collabvm`:

```sh
user@myownserver:~$ sudo useradd -rmd /srv/collabvm collabvm
user@myownserver:~$ sudo usermod -aG kvm collabvm # Give the CollabVM user permission to use KVM hypervision
```

Now, we can shell in as the CollabVM user. For the remainder of this guide, any line that starts with `(collabvm) $` indicates that this should be run as the `collabvm` user.

```sh
user@myownserver:~$ sudo -iu collabvm
(collabvm) $ pwd # This should output /srv/collabvm
/srv/collabvm
```

Install the Rustup toolchain for the CollabVM user:

```sh
(collabvm) $ curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Restart the shell to apply changes
(collabvm) $ exit
user@myownserver:~$ sudo -iu collabvm
(collabvm) $ 
```

Now, we can clone the CollabVM Server source code:

```sh
(collabvm) $ git clone https://github.com/computernewb/collabvm-1.2.ts.git /srv/collabvm/collab-vm-1.2-server-bettetweak --depth 1 --recursive
(collabvm) $ cd /srv/collabvm/collab-vm-1.2-server-bettetweak
```

Then install dependencies

```sh
(collabvm) $ yarn
```

Now, make sure to get CVM Protocol (because when you clone it, it doesn't clone it...):

```sh
(collabvm) $ git clone https://github.com/computernewb/collab-vm-1.2-binary-protocol /srv/collabvm/collab-vm-1.2-server-bettetweak/collab-vm-1.2-binary-protocol --recursive
```

Finally, build the server

```sh
(collabvm) $ yarn build
```

## Set up your VM

Now is a good time to get your VM set up. Currently, the only supported hypervisor is QEMU. We have many guides on this wiki for setting up different OSes in QEMU, [[QEMU/Guests|check them out here.]]

Here are some ideas to make your VM interesting:

- A cool wallpaper
- Preinstalled apps (Games, Browser)
- A custom bot (like for anyos vm, utility, CDs, ect..)

We recommend setting up your VM as the collabvm user to make sure permissions are set correctly, but this is not a requirement.

## Setting up a Virtual Network

QEMU's user-mode networking used by default isn't very customizable and lacks the ability to block certain abuse vectors. For this reason we very strongly recommend setting up a Virtual Network using the [[CollabNet Guide]]. Depending on the full situation we may refuse to add VMs that use QEMU user-mode networking.

It's also VERY important that mail ports are BLOCKED on your VM (the CollabNet guide config includes this). If you do not block them, your IP effectively becomes an open relay which will very likely get you suspended by your ISP or hosting provider. We will not add VMs with accessible mail ports

## Configuration

Now we need to fill out the config file for your VM. Copy config.example.toml to config.toml, and open it in an editor. It is well commented so each value should be self-explanatory. If you have questions, feel free to ask in our Discord server.

### QEMU Args

With BetteTweak (known as reTweak), you can configure VM specs by yourself! For nerd, we added a additional arguments, because of limitation reason.

## Running your VM

Now that everything is set up, you can bring your VM online. To run the server right from your terminal, run the following command:

```sh
(collabvm) $ yarn serve
```

Or alternatively, to run it directly:

```sh
(collabvm) $ node cvmts/dist/index.js
```

## Running a local webapp

You'll probably want to test it out for yourself. For that, we'll throw up a test webapp. Start by cloning the source:

```sh
user@myownserver:~$ git clone https://github.com/computernewb/collab-vm-1.2-webapp.git --recursive
user@myownserver:~$ cd collab-vm-1.2-webapp
```

Then, copy `config.example.json` to `config.json`, and replace ServerAddresses with your server address:

```json
    "ServerAddresses": [
        "ws://127.0.0.1:6004", # If you're not using proxying
        "wss://example.com/collab-vm/vm1" # If you are using proxying. Remove one of these lines.
    ],
```

Now you can build the webapp, and serve it:

```sh
user@myownserver:~$ yarn
user@myownserver:~$ yarn build
user@myownserver:~$ yarn serve
```

This will run the webapp at `127.0.0.1:1234`, which you can navigate to in your browser. If all went well, your VM should show up. If not, and you don't know why, join our discord and ask for help there!

## Setting up a service

While it's useful and convenient to run your VM from the console while debugging, we **strongly** recommend you set it up as a service once you're ready to leave it on for extended periods of time. This is done differently depending on what init system your distro uses (Probably systemd, if you're not sure)

## SystemD

To make your VM a systemd service, you can put the following into `/etc/systemd/system/collabvm.service` ()

```ini
[Unit]
Description=CollabVM Autostartup

[Service]
Type=simple
User=collabvm
Group=collabvm

KillMode=mixed
Restart=always
RestartSec=5

# Make sure to change the following two lines according to where you put your server.
# If you have multiple VMs, it's possible to make your service file a template unit file (by making the file name, for example, "collabvm@.service"), and use %i in WorkingDirectory
# to automatically set WorkingDirectory to a different directory for each VM, allowing you to use the same server for all your VMs.
WorkingDirectory=/srv/collabvm/collab-vm-1.2-server/
ExecStart=/bin/node /srv/collabvm/collab-vm-1.2-server/cvmts/dist/index.js

# Tell systemd that we manage our own cgroup hierarchy, and delegate
# all controllers that are either implicitly or explicitly enabled.
#
# This is used for resource limits (in your VM's config.toml).
# Can be omitted if you are not using it. (It's probably a good idea to however!)
Delegate=yes

# Hardening
PrivateTmp=yes
NoNewPrivileges=true
RestrictNamespaces=uts ipc pid user cgroup

ProtectKernelTunables=yes
ProtectKernelModules=yes
PrivateDevices=no
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
```

Reload the daemon cache:

```sh
user@myownserver:~$ sudo systemctl daemon-reload
```

Then you can start your VM with:

```sh
user@myownserver:~$ sudo systemctl start collabvm
```

And make it automatically run on startup with:

```sh
user@myownserver:~$ sudo systemctl enable collabvm
```

### OpenRC

Put the following into /etc/init.d/collabvm to make your VM an OpenRC service (change filename as appropriate):

```sh
#!/sbin/openrc-run
supervisor="supervise-daemon"
name="collabvm"
command="/bin/node"
command_args="/srv/collabvm/collab-vm-1.2-server/cvmts/dist/index.js"
# If you have multiple VMs, you can change --chdir to a different directory on each VM, to use different config files on the same server
supervise_daemon_args="--user collabvm --group collabvm --chdir /srv/collabvm/collab-vm-1.2-server --stdout /srv/collabvm/out.log --stderr /srv/collabvm/error.log"
```

Make it executable:

```sh
user@myownserver:~$ sudo chmod +x /etc/init.d/collabvm
```

Now you can start your VM with:

```sh
user@myownserver:~$ sudo rc-service collabvm start
```

And make it run on startup with:

```sh
user@myownserver:~$ sudo rc-update add collabvm
```

## Setting up reverse proxying

We strongly recommend you proxy your VM behind Nginx, to provide additional security and allow things like TLS. It also makes your VM look a lot cleaner, allowing people to access it on your main HTTP(s) port and on a subdirectory, like `https://example.com/collab-vm/` rather than `http://example.com:6004`. Here's a brief description of how to set that up on the Nginx side. This assumes you already have your site set up with Nginx, and if not there are numerous guides for that around the internet.

First, you'll want to save [https://computernewb.com/~elijah/wsproxy_params wsproxy_params] to your Nginx directory, which enables WebSocket proxying. Here's a one-liner to do that:

```sh
user@myownserver:~$ sudo curl https://computernewb.com/~elijah/wsproxy_params -o /etc/nginx/wsproxy_params
```

Next, you can add the following to your Nginx server block:

```conf
location /collab-vm/vm1 {
    include wsproxy_params;
    proxy_pass http://127.0.0.1:6004/; # Replace 6004 if you changed the HTTP port in the config file.
}
```

If you get an error about `connection_upgrade`, edit `/etc/nginx/nginx.conf` and add the following to your http block:

```conf
map $http_upgrade $connection_upgrade {  
    default upgrade;
    ''      close;
}
```

If you have multiple VMs running, you can have them all proxied like so:

```conf
location /collab-vm/vm1 {
    include wsproxy_params;
    proxy_pass http://127.0.0.1:6004/; 
}
location /collab-vm/vm2 {
    include wsproxy_params;
    proxy_pass http://127.0.0.1:6005/; 
}
# ...etc
```

## Permanently host the webapp

If you want to host the webapp on your website, you can build it as follows:

```sh
user@myownserver:~$ yarn build
```

Then, copy the contents of the `dist` directory to your website. For example, if your webroot is at `/var/www/example.com`, and you want your webapp at example.com/best-vm/:

```sh
user@myownserver:~$ cp -r dist/. /var/www/example.com/collab-vm/
```

The webapp should now be accessible at your website.

## Logging in as an admin (or mod)

Logging in is very simple. Just join the VM, and press the "Login" button (or triple click on your username). Enter your admin or mod password into the prompt, and you should be authenticated and able to use staff actions.
