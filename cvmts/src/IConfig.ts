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
		};
	};
	
	mysql: MySQLConfig;
	bans: BanConfig;

	collabvm: {
		// Where VMs are located.
		vmsDir: string;

		// all vms to look for.
		// this uses a currently hardcoded `${vmsDir}/${name}/vm.toml` pattern basically
		vms: string[]; 

		motd: string; // default. other tomls can overide this

		// cant override these
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

		// defaults
		turnTime: number;
		voteTime: number;
		voteCooldown: number;

		// CAN NOT OVERRIDE THESE IN A TOML
		adminpass: string;
		modpass: string;
		moderatorPermissions: Permissions;

		// these though you can ig
		turnwhitelist: boolean;
		turnpass: string;
	};
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

/// an individual node's configuration
export interface NodeConfiguration {
	vm: {
		type: 'qemu' | 'vncvm';
		qemu: {
			qemuArgs: string;
			vncPort: number;
			snapshots: boolean;
			resourceLimits?: CgroupLimits
		};
		vncvm: VNCVMDef;
		jpegQuality: number;
	};
	
	// any ? fields can be left undefined,
	// and the CollabVMNode class will handle that
	// by fetching from config.toml
	collabvm: {
		node: string;
		displayname: string;
		
		motd?: string;

		turnTime?: number;
		voteTime?: number;
		voteCooldown?: number;

		turnwhitelist?: boolean;
		turnpass?: string
	};
}