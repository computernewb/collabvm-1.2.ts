import EventEmitter from "events";
import { Socket } from "net";
import { Mutex } from "async-mutex";

export default class QMPClient extends EventEmitter {
    socketfile : string;
    sockettype: string;
    socket : Socket;
    connected : boolean;
    sentConnected : boolean;
    cmdMutex : Mutex; // So command outputs don't get mixed up
    constructor(socketfile : string, sockettype: string) {
        super();
        this.sockettype = sockettype;
        this.socketfile = socketfile;
        this.socket = new Socket();
        this.connected = false;
        this.sentConnected = false;
        this.cmdMutex = new Mutex();
    }
    connect() : Promise<void> {
        return new Promise((res, rej) => {
            if (this.connected) {res(); return;}
            try {
                if(this.sockettype == "tcp:") {
                    let _sock = this.socketfile.split(':');
                    this.socket.connect(parseInt(_sock[1]), _sock[0]);
                }else{
                    this.socket.connect(this.socketfile);
                }
            } catch (e) {
                this.onClose();
            }
            this.connected = true;
            this.socket.on('error', (err) => console.log(err)); // Disable throwing if QMP errors
            this.socket.on('data', (data) => this.onData(data));
            this.socket.on('close', () => this.onClose());
            this.once('connected', () => {res();});
        })
    }

    disconnect() {
        this.connected = false;
        this.socket.destroy();
    }

    private async onData(data : Buffer) {
        let msgraw = data.toString();
        let msg;

        try {
            msg = JSON.parse(msgraw);
        } catch {
            return;
        }

        if (msg.QMP !== undefined) {
            if (this.sentConnected) 
                return;
                
            await this.execute({ execute: "qmp_capabilities" });

            this.emit('connected');
            this.sentConnected = true;
        }
        if (msg.return !== undefined)
            this.emit("qmpreturn", msg.return);
        else if(msg.event !== undefined) {
            switch(msg.event) {
                case "STOP":
                {
                    console.log("[INFO] Resetting QEMU...");
                    this.reboot();
                    break;
                }
                case "RESET":
                {
                    console.log("[INFO] QEMU reset event occurred");
                    this.resume();
                    break;
                };
                default: {
                    this.emit("qmpreturn", '');
                    break;
                }
            }
        }else
            // for now just return an empty string.
            // This is a giant hack but avoids a deadlock
            this.emit("qmpreturn", '');
    }

    private onClose() {
        this.connected = false;
        this.sentConnected = false;

        if (this.socket.readyState === 'open')
            this.socket.destroy();

        this.cmdMutex.cancel();
        this.cmdMutex.release();
        this.socket = new Socket();
        this.emit('close');
    }

    async reboot() {
        if (!this.connected) 
            return;

        await this.execute({"execute": "system_reset"});
    }

    async resume() {
        if (!this.connected) 
            return;

        await this.execute({"execute": "cont"});
    }

    async ExitQEMU() {
        if (!this.connected) 
            return;

        await this.execute({"execute": "quit"});
    }

    execute(args : object) {
        return new Promise(async (res, rej) => {
            var result:any;
            try {
                result = await this.cmdMutex.runExclusive(() => {
                    // I kinda hate having two promises but IDK how else to do it /shrug
                    return new Promise((reso, reje) => {
                        this.once('qmpreturn', (e) => {
                            reso(e);
                        });
                        this.socket.write(JSON.stringify(args));
                    });
                });
            } catch {
                res({});
            }
            res(result);
        });
    }

    runMonitorCmd(command : string) {
        return new Promise(async (res, rej) => {
            res(await this.execute({execute: "human-monitor-command", arguments: {"command-line": command}}));
        });
    }
}