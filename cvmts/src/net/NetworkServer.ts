import { EventEmitter } from "stream";
import { User } from "../User";

interface NetworkServerEvents extends EventEmitter {
	on(event: 'connect', listener: (user: User) => void): this;
}

export interface NetworkServer extends NetworkServerEvents {
	start(): void;
	stop(): void;
}
