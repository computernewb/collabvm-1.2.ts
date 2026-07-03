import { CgroupLimits } from './vm/qemu_launcher';
import VNCVMDef from './vm/vnc/VNCVMDef';

export default interface IConfig {
	http: {
		host: string;
		port: number;
		proxying: boolean;
		proxyAllowedIps: string[];
		origin: boolean;
		originAllowedDomains: string[];
	};
	geoip: {
		enabled: boolean;
		directory: string;
		accountID: string;
		licenseKey: string;
	};
	auth: {
		enabled: boolean;
		apiEndpoint: string;
		secretKey: string;
		guestPermissions: {
			chat: boolean;
			turn: boolean;
			callForReset: boolean;
			vote: boolean;
			iaos: boolean;
		};
	};
	vm: {
		type: 'qemu' | 'vncvm';
	};
	qemu: {
		qemuArgs: string;
		vncPort: number;
		snapshots: boolean;
		resourceLimits?: CgroupLimits;
		mediaDevices: { [key: string]: string };
	};
	vncvm: VNCVMDef;
	mysql: MySQLConfig;
	bans: BanConfig;
	collabvm: {
		node: string;
		displayname: string;
		motd: string;
		maxConnections: number;
		moderatorEnabled: boolean;
		usernameblacklist: string[];
		maxChatLength: number;
		maxChatHistoryLength: number;
		turnlimit: {
			enabled: boolean;
			maximum: number;
		};
		automute: {
			enabled: boolean;
			seconds: number;
			messages: number;
		};
		tempMuteTime: number;
		turnTime: number;
		voteTime: number; // legacy
		voteCooldown: number; // legacy
		adminpass: string;
		modpass: string;
		turnwhitelist: boolean;
		turnpass: string;
		moderatorPermissions: Permissions;
	};
	meta: MetaServerConfig;
	vote: {
		reset: VoteConfig;
		reboot: VoteConfig;
		iaosInsert: VoteConfig;
		iaosEject: VoteConfig;
	};
	iaos: IAOSConfig;
}

export interface MySQLConfig {
	enabled: boolean;
	host: string;
	username: string;
	password: string;
	database: string;
}

export interface BanConfig {
	bancmd: string | string[] | undefined;
	cvmban: boolean;
}

export interface Permissions {
	restore: boolean;
	reboot: boolean;
	ban: boolean;
	forcevote: boolean;
	mute: boolean;
	kick: boolean;
	bypassturn: boolean;
	rename: boolean;
	grabip: boolean;
	xss: boolean;
}

export interface VoteConfig {
	enabled: boolean;
	voteTime: number;
	voteCooldown: number;
}

export interface MetaServerConfig {
	enabled: boolean;
	publicApi: string;
	privateApi: string;
}

export interface IAOSConfig {
	enabled: boolean;
	mediaKindSupported: Array<string>;
}
