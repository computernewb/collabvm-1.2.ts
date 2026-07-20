export default interface IConfig {
	http: HttpConfig;
	iaos: IaosConfig;
}

export interface HttpConfig {
	host: string;
	port: number;
	cors: boolean;
}

export interface IaosConfig {
	enabled: boolean;
	repository: string;
}
