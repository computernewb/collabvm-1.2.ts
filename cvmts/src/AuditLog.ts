import pino from 'pino';
import { Rank, User } from './User.js';

// Staff audit log.
// TODO: 
//	- Hook this up to a db or something instead of misusing pino
export class AuditLog {
	private auditLogger = pino({
		name: 'AuditLog',
		transport: {
			target: 'pino/file',
			options: {
				destination: './audit.log'
			}
		}
	});

	private static StaffHonorFromRank(user: User, uppercase: boolean) {
		switch (user.rank) {
			case Rank.Moderator:
				if (uppercase) return 'Moderator';
				else return 'moderator';

			case Rank.Admin:
				if (uppercase) return 'Administrator';
				else return 'administrator';

			default:
				throw new Error("input user is not staff.. how'd you even get here?");
		}
	}

	onReset(callingUser: User) {
		this.auditLogger.info({ staffUsername: callingUser.username }, `${AuditLog.StaffHonorFromRank(callingUser, true)} reset the virtual machine.`);
	}

	onReboot(callingUser: User) {
		this.auditLogger.info({ staffUsername: callingUser.username }, `${AuditLog.StaffHonorFromRank(callingUser, true)} rebooted the virtual machine.`);
	}

	onMute(callingUser: User, target: User, perm: boolean) {
		this.auditLogger.info({ staffUsername: callingUser.username, targetUsername: target.username, perm: perm }, `${AuditLog.StaffHonorFromRank(callingUser, true)} muted user.`);
	}

	onUnmute(callingUser: User, target: User) {
		this.auditLogger.info({ staffUsername: callingUser.username, targetUsername: target.username }, `${AuditLog.StaffHonorFromRank(callingUser, true)} unmuted user.`);
	}

	onKick(callingUser: User, target: User) {
		this.auditLogger.info({ staffUsername: callingUser.username, targetUsername: target.username }, `${AuditLog.StaffHonorFromRank(callingUser, true)} kicked user.`);
	}

	onBan(callingUser: User, target: User) {
		this.auditLogger.info({ staffUsername: callingUser.username, targetUsername: target.username }, `${AuditLog.StaffHonorFromRank(callingUser, true)} banned user.`);
	}

	onMonitorCommand(callingUser: User, command: string) {
		this.auditLogger.info({ staffUsername: callingUser.username, commandLine: command }, `${AuditLog.StaffHonorFromRank(callingUser, true)} executed monitor command.`);
	}
}

export let TheAuditLog = new AuditLog();
