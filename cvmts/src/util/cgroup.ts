// Cgroup management code
// this sucks, ill mess with it later

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pino from 'pino';

let logger = pino({ name: 'CVMTS/CGroup' });

export class CGroupController {
	private controller;
	private cg: CGroup;

	constructor(controller: string, cg: CGroup) {
		this.controller = controller;
		this.cg = cg;
	}

	WriteValue(key: string, value: string) {
		try {
			writeFileSync(path.join(this.cg.Path(), `${this.controller}.${key}`), value);
		} catch(e) {
			logger.error({error: e, controller_key: `${this.controller}.${key}`, value: value }, 'Failed to set CGroup controller value')
		}
	}
}

export class CGroup {
	private path;

	constructor(path: string) {
		this.path = path;
	}

	InitControllers(wants_cpuset: boolean) {
		// Configure this "root" cgroup to provide cpu and cpuset controllers to the leaf
		// QEMU cgroups. A bit iffy but whatever.
		if(wants_cpuset) {
			try {
				writeFileSync(path.join(this.path, 'cgroup.subtree_control'), '+cpu +cpuset');
			} catch(err) {
				logger.error({error: err}, 'Could not provide cpuset controller to subtree');
				// just give up if this fails
				writeFileSync(path.join(this.path, 'cgroup.subtree_control'), '+cpu');
			}
		} else {
			writeFileSync(path.join(this.path, 'cgroup.subtree_control'), '+cpu');
		}
	}

	GetController(controller: string) {
		return new CGroupController(controller, this);
	}

	Path(): string {
		return this.path;
	}

	HasSubgroup(name: string): boolean {
		let subgroup_root = path.join(this.path, name);
		if (existsSync(subgroup_root)) return true;
		return false;
	}

	DeleteSubgroup(name: string): void {
		let subgroup_root = path.join(this.path, name);
		if (!this.HasSubgroup(name)) {
			throw new Error(`Subgroup ${name} does not exist`);
		}

		//console.log("Deleting subgroup", name);
		rmdirSync(subgroup_root);
	}

	// Gets a CGroup inside of this cgroup.
	GetSubgroup(name: string): CGroup {
		// make the subgroup if it doesn't already exist
		let subgroup_root = path.join(this.path, name);
		if (!this.HasSubgroup(name)) {
			mkdirSync(subgroup_root);
			// We need to make the subgroup threaded before we can attach a process to it.
			// It's a bit weird, but oh well. Blame linux people, not me.
			writeFileSync(path.join(subgroup_root, 'cgroup.type'), 'threaded');
		}
		return new CGroup(subgroup_root);
	}

	// Attaches a process to this cgroup.
	AttachProcess(pid: number) {
		appendFileSync(path.join(this.path, 'cgroup.procs'), pid.toString());
	}

	// Attaches a thread to this cgroup. (The CGroup is a threaded one. See above)
	AttachThread(tid: number) {
		appendFileSync(path.join(this.path, 'cgroup.threads'), tid.toString());
	}

	// Returns a CGroup instance for the process' current cgroup, prepared for subgroup usage.
	// This will only fail if you are not using systemd or elogind,
	// since even logind user sessions are run inside of a user@[UID] slice.
	// NOTE: This only supports cgroups2-only systems. Systemd practically enforces that so /shrug
	static Self(): CGroup {
		const kCgroupSelfPath = '/proc/self/cgroup';
		if (!existsSync(kCgroupSelfPath)) throw new Error('This process is not in a CGroup.');
		let res = readFileSync(kCgroupSelfPath, { encoding: 'utf-8' });

		// Make sure the first/only line is a cgroups2 0::/path/to/cgroup entry.
		// Legacy cgroups1 is not supported.
		if (res[0] != '0') throw new Error('CGroup.Self() does not work with cgroups 1 systems. Please do not the cgroups 1.');
		let cg_path = res.substring(3, res.indexOf('\n'));

		let cg = new CGroup(path.join('/sys/fs/cgroup', cg_path));

		return cg;
	}
}
