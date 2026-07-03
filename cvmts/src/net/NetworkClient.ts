import { EventEmitter } from 'events';

interface NetworkClientEvents extends EventEmitter {
	on(event: 'msg', listener: (buf: Buffer, binary: boolean) => void): this;
	on(event: 'disconnect', listener: () => void): this;
}

export interface NetworkClient extends NetworkClientEvents {
	getIP(): string;
	send(msg: string): Promise<void>;
	sendBinary(msg: Buffer): Promise<void>;
	close(): void;
	isOpen(): boolean;
}
