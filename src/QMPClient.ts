import EventEmitter from "events";
import { Socket } from "net";
import { Mutex } from "async-mutex";

export default class QMPClient extends EventEmitter {
    socketfile : string;
    socket : Socket;
    connected : boolean;
    sentConnected : boolean;
    cmdMutex : Mutex; // So command outputs don't get mixed up
    constructor(socketfile : string) {
        super();
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
                this.socket.connect(this.socketfile);
            } catch (e) {
                this.onClose();
            }
            this.connected = true;
            this.socket.on('error', (err) => false); // Disable throwing if QMP errors
            this.socket.on('data', (data) => this.onData(data));
            this.socket.on('close', () => this.onClose());
            this.once('connected', () => res());
        })
    }

    disconnect() {
        this.connected = false;
        this.socket.destroy();
    }

    private async onData(data : Buffer) {
        var msgraw = data.toString();
        var msg = JSON.parse(msgraw);
        if (msg.QMP) {
            if (this.sentConnected) return;
            await this.execute({ execute: "qmp_capabilities" });
            this.emit('connected');
            this.sentConnected = true;
        }
        if (msg.return) this.emit("qmpreturn", msg.return);
    }

    private onClose() {
        this.connected = false;
        this.sentConnected = false;
        this.emit('close');
    }

    async reboot() {
        if (!this.connected) return;
        await this.execute({"execute": "system_reset"});
    }

    async ExitQEMU() {
        if (!this.connected) return;
        await this.execute({"execute": "quit"});
    }

    execute(args : object) {
        return new Promise(async (res, rej) => {
            var result:any = await this.cmdMutex.runExclusive(() => {
                // I kinda hate having two promises but IDK how else to do it /shrug
                return new Promise((reso, reje) => {
                    this.once('qmpreturn', (e) => {
                        reso(e);
                    });
                    this.socket.write(JSON.stringify(args));
                });
            });
            res(result);
        });
    }

    runMonitorCmd(command : string) {
        return new Promise(async (res, rej) => {
            var result : any = await this.execute({execute: "human-monitor-command", arguments: {"command-line": command}});
            res(result);
        });
    }
}