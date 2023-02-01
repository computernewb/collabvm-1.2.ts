import EventEmitter from "events";
import { Socket } from "net";

export default class QMPClient extends EventEmitter {
    socketfile : string;
    socket : Socket;
    connected : boolean;
    sentConnected : boolean;
    constructor(socketfile : string) {
        super();
        this.socketfile = socketfile;
        this.socket = new Socket();
        this.connected = false;
        this.sentConnected = false;
    }
    connect() {
        if (this.connected) return;
        try {
            this.socket.connect(this.socketfile);
        } catch (e) {
            this.emit("")
        }
        this.connected = true;
        this.socket.on('data', (data) => this.onData(data));
        this.socket.on('close', () => this.onClose());
    }

    private onData(data : Buffer) {
        var msgraw = data.toString();
        var msg = JSON.parse(msgraw);
        console.log(msg);
        if (msg.QMP) {
            if (this.sentConnected) return;
            this.socket.write(JSON.stringify({ execute: "qmp_capabilities" }));
            this.emit('connected');
            this.sentConnected = true;
        }
    }

    private onClose() {
        this.connected = false;
        this.sentConnected = false;
        this.emit('close');
    }
}