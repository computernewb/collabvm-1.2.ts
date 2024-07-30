export default interface NetworkClient {
	getIP(): string;
	send(msg: string): Promise<void>;
	sendBinary(msg: Uint8Array): Promise<void>;
	close(): void;
	on(event: string, listener: (...args: any[]) => void): void;
	off(event: string, listener: (...args: any[]) => void): void;
	isOpen(): boolean;
}
