import { EventEmitter } from "node:events";

enum QmpClientState {
    Handshaking,
    Connected
}

function qmpStringify(obj: any) {
    return JSON.stringify(obj) + '\r\n';
}

// this writer interface is used to poll back to a higher level
// I/O layer that we want to write some data.
export interface IQmpClientWriter {
    writeSome(data: Buffer) : void;
}

export type QmpClientCallback = (err: Error | null, res: any | null) => void;

type QmpClientCallbackEntry = {
    id: number,
    callback: QmpClientCallback | null
};

export enum QmpEvent {
    BlockIOError = 'BLOCK_IO_ERROR',
    Reset = 'RESET',
    Resume = 'RESUME',
    RtcChange = 'RTC_CHANGE',
    Shutdown = 'SHUTDOWN',
    Stop = 'STOP',
    VncConnected = 'VNC_CONNECTED',
    VncDisconnected = 'VNC_DISCONNECTED',
    VncInitalized = 'VNC_INITALIZED',
    Watchdog = 'WATCHDOG'
};


// A QMP client
export class QmpClient extends EventEmitter {
    private state = QmpClientState.Handshaking;
    private capabilities = "";
    private writer: IQmpClientWriter | null = null;

    private lastID = 0;
    private callbacks = new Array<QmpClientCallbackEntry>();

    constructor() {
        super();
    }

    setWriter(writer: IQmpClientWriter) {
        this.writer = writer;
    }

    feed(data: Buffer) : void {
        let str = data.toString();

   /* I don't think this is needed but if it is i'm keeping this for now
        if(!str.endsWith('\r\n')) {
            console.log("incomplete message!");
            return;
        }
    */

        let obj = JSON.parse(str);

        switch(this.state) {
            case QmpClientState.Handshaking:
                if(obj["return"] != undefined) {
                    this.state = QmpClientState.Connected;
                    this.emit('connected');
                    return;
                }

                let capabilities = qmpStringify({
                    execute: "qmp_capabilities"
                });

                this.writer?.writeSome(Buffer.from(capabilities, 'utf8'));
                break;

            case QmpClientState.Connected:
                if(obj["return"] != undefined || obj['error'] != undefined) {
                    if(obj['id'] == null)
                        return;

                    let cb = this.callbacks.find((v) => v.id == obj['id']);
                    if(cb == undefined)
                        return;

                    let error: Error | null = obj.error ? new Error(obj.error.desc) : null;

                    if(cb.callback)
                        cb.callback(error, obj.return);

                    this.callbacks.slice(this.callbacks.indexOf(cb));
                } else if (obj['event']) {
                    this.emit(obj.event, {
                        timestamp: obj.timestamp,
                        data: obj.data
                    });
                }
                break;
        }
    }

    executeSync(command: string, args: any | undefined, callback: QmpClientCallback | null) {
        let entry = {
            callback: callback,
            id: ++this.lastID
        };

        let qmpOut: any = {
            execute: command,
            id: entry.id
        };

        if(args !== undefined)
                qmpOut['arguments'] = args;

        this.callbacks.push(entry);
        this.writer?.writeSome(Buffer.from(qmpStringify(qmpOut), 'utf8'));
    }

    async execute(command: string, args: any | undefined = undefined) : Promise<any> {
        return new Promise((res, rej) => {
            this.executeSync(command, args, (err, result) => {
                if(err)
                    rej(err);
                res(result);
            });
        });
    }

    reset() {
        this.state = QmpClientState.Handshaking;
    }
}
