import EventEmitter from 'events';
import { IProcess, IProcessLauncher, ProcessLaunchOptions } from '@wize-logic/superqemu';
import { execaCommand } from 'execa';
import { Readable, Writable } from 'stream';
import { CGroup } from '../util/cgroup.js';

export interface CgroupLimits {
	cpuUsageMax?: number;
	runOnCpus?: number[];
	periodMs?: number;
	limitProcess?: boolean;
}

interface CGroupValue {
	controller: string;
	key: string;
	value: string;
}

function MakeValuesFromLimits(limits: CgroupLimits): CGroupValue[] {
	let option_array = [];

	// The default period is 100 ms, which matches cgroups2 defaults.
	let periodUs = 100 * 1000;

	// Convert a user-configured period to us, since that's what cgroups2 expects.
	if(limits.periodMs)
		periodUs = limits.periodMs * 1000;

	if (limits.cpuUsageMax) {
		// cpu.max
		option_array.push({
			controller: 'cpu',
			key: 'max',
			value: `${(limits.cpuUsageMax / 100) * periodUs} ${periodUs}`
		});
	}

	if(limits.runOnCpus) {
		// Make sure a CPU is not specified more than once. Bit hacky but oh well
		let unique = [...new Set(limits.runOnCpus)];
		option_array.push({
			controller: 'cpuset',
			key: 'cpus',
			value: `${unique.join(',')}`
		});
	}

	return option_array;
}

// A process automatically placed in a given cgroup.
class CGroupLimitedProcess extends EventEmitter implements IProcess {
	private process;
	stdin: Writable | null = null;
	stdout: Readable | null = null;
	stderr: Readable | null = null;
	private root_cgroup: CGroup;
	private cgroup: CGroup;
	private id;
	private limits;

	constructor(cgroup_root: CGroup, id: string, limits: CgroupLimits, command: string, opts?: ProcessLaunchOptions) {
		super();
		this.root_cgroup = cgroup_root;
		this.cgroup = cgroup_root.GetSubgroup(id);
		this.id = id;
		this.limits = limits;

		if(!this.limits.limitProcess)
			this.limits.limitProcess = false;

		this.process = execaCommand(command, opts);

		this.stdin = this.process.stdin;
		this.stdout = this.process.stdout;
		this.stderr = this.process.stderr;

		let self = this;
		this.process.on('spawn', () => {
			self.initCgroup();

			if(self.limits.limitProcess) {
				// it should have one!
				self.cgroup.AttachProcess(self.process.pid!);
			}
			self.emit('spawn');
		});

		this.process.on('exit', (code) => {
			self.emit('exit', code);
		});
	}

	initCgroup() {
		// Set cgroup keys.
		for(const val of MakeValuesFromLimits(this.limits)) {
			let controller = this.cgroup.GetController(val.controller);
			controller.WriteValue(val.key, val.value);
		}
	}

	kill(signal?: number | NodeJS.Signals): boolean {
		return this.process.kill(signal);
	}

	dispose(): void {
		this.stdin = null;
		this.stdout = null;
		this.stderr = null;

		this.root_cgroup.DeleteSubgroup(this.id);
		this.process.removeAllListeners();
		this.removeAllListeners();
	}
}

export class QemuResourceLimitedLauncher implements IProcessLauncher {
	private limits;
	private name;
	private root;
	public group;

	constructor(name: string, limits: CgroupLimits) {
		this.root = CGroup.Self();

		// Make sure
		if(limits.runOnCpus) {
			this.root.InitControllers(true);
		} else {
			this.root.InitControllers(false);
		}

		this.name = name;
		this.limits = limits;

		// XXX figure something better out
		this.group = this.root.GetSubgroup(this.name);
	}

	launch(command: string, opts?: ProcessLaunchOptions | undefined): IProcess {
		return new CGroupLimitedProcess(this.root, this.name, this.limits, command, opts);
	}
}
