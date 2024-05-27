export default interface NetworkServer {
    start() : void;
    stop() : void;
    on(event: string, listener: (...args: any[]) => void) : void;
    off(event: string, listener: (...args: any[]) => void) : void;
}