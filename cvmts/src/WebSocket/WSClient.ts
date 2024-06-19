import { WebSocket } from "ws";
import NetworkClient from "../NetworkClient.js";
import EventEmitter from "events";
import { Logger } from "@cvmts/shared";

export default class WSClient extends EventEmitter implements NetworkClient {
    socket: WebSocket;
    ip: string;

    constructor(ws: WebSocket, ip: string) {
        super();
        this.socket = ws;
        this.ip = ip;
        this.socket.on('message', (buf: Buffer, isBinary: boolean) => {
			// Close the user's connection if they send a non-string message
			if (isBinary) {
				this.close();
				return;
			}

			this.emit('msg', buf.toString("utf-8"));
		});

        this.socket.on('close', () => {
            this.emit('disconnect');
        });
    }

    isOpen(): boolean {
        return this.socket.readyState === WebSocket.OPEN;
    }

    getIP(): string {
        return this.ip;
    }
    send(msg: string): Promise<void> {
        return new Promise((res,rej) => {
			if(!this.isOpen())
				res();
		
            this.socket.send(msg, (err) => {
                if (err) {
                    rej(err);
                    return;
                }
                res();
            });
        });
    }

    close(): void {
        this.socket.close();
    }

}
