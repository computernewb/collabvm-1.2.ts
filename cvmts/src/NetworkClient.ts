export default interface NetworkClient {
	getIP(): string;
	send(msg: string): Promise<void>;
	close(): void;
	on(event: string, listener: (...args: any[]) => void): void;
	off(event: string, listener: (...args: any[]) => void): void;
	isOpen(): boolean;
}
