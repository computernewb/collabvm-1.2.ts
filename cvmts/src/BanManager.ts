import { ExecaSyncError, execa, execaCommand } from "execa";
import { BanConfig } from "./IConfig";
import pino from "pino";
import { Database } from "./Database";
import { Address6 } from "ip-address";
import { isIP } from "net";

export class BanManager {
    private cfg: BanConfig;
    private logger: pino.Logger;
    private db: Database | undefined;

    constructor(config: BanConfig, db: Database | undefined) {
        this.cfg = config;
        this.logger = pino({
            name: "CVMTS.BanManager"
        });
        this.db = db;
    }

    private formatIP(ip: string) {
        switch (isIP(ip)) {
            case 4:
                // If IPv4, just return as-is
                return ip;
            case 6: {
                // If IPv6, return the /64 equivalent
                let addr = new Address6(ip);
                addr.subnetMask = 64;
                return addr.startAddress().canonicalForm() + '/64';
            }
            case 0:
            default:
                // Invalid IP
                throw new Error("Invalid IP address (what the hell did you even do???)");
        }
    }

    async BanUser(ip: string, username: string) {
        ip = this.formatIP(ip);
        // If cvmban enabled, write to DB
        if (this.cfg.cvmban) {
            if (!this.db) throw new Error("CVMBAN enabled but Database is undefined");
            await this.db.banIP(ip, username);
        }
        // If ban command enabled, run it
        try {
			if (Array.isArray(this.cfg.bancmd)) {
				let args: string[] = this.cfg.bancmd.map((a: string) => this.banCmdArgs(a, ip, username));
				if (args.length || args[0].length) {
                    this.logger.info(`Running "${JSON.stringify(args)}"`);
					await execa(args.shift()!, args, { stdout: process.stdout, stderr: process.stderr });
				}
			} else if (typeof this.cfg.bancmd == 'string') {
				let cmd: string = this.banCmdArgs(this.cfg.bancmd, ip, username);
				if (cmd.length) {
                    // Run through JSON.stringify for char escaping
                    this.logger.info(`Running ${JSON.stringify(cmd)}`);
					await execaCommand(cmd, { stdout: process.stdout, stderr: process.stderr });
				}
			}
		} catch (e) {
			this.logger.error(`Failed to ban ${ip} (${username}): ${(e as ExecaSyncError).shortMessage}`);
		}
    }

    async isIPBanned(ip: string) {
        ip = this.formatIP(ip);
        if (!this.db) return false;
        if (await this.db.isIPBanned(ip)) {
            this.logger.info(`Banned IP ${ip} tried connecting.`);
            return true;
        }
        return false;
    }

    private banCmdArgs(arg: string, ip: string, username: string): string {
		return arg.replace(/\$IP/g, ip).replace(/\$NAME/g, username);
	}

}