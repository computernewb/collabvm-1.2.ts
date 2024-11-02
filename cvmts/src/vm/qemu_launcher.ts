import EventEmitter from 'events';
import { IProcess, IProcessLauncher, ProcessLaunchOptions } from '@computernewb/superqemu';
import { execaCommand } from 'execa';
import { Readable, Writable } from 'stream';
import { CGroup } from '../util/cgroup.js';

export interface CgroupLimits {
	cpuUsageMax?: number;
	runOnCpus?: number[];
}

interface CGroupValue {
	controller: string;
	key: string;
	value: string;
}

function MakeValuesFromLimits(limits: CgroupLimits): CGroupValue[] {
	let option_array = [];

	if (limits.cpuUsageMax) {
		// cpu.max
		option_array.push({
			controller: 'cpu',
			key: 'max',
			value: `${(limits.cpuUsageMax / 100) * 100000} 100000`
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
	private cgroup: CGroup;

	constructor(cg: CGroup, command: string, opts?: ProcessLaunchOptions) {
		super();
		this.cgroup = cg;

		this.process = execaCommand(command, opts);

		this.stdin = this.process.stdin;
		this.stdout = this.process.stdout;
		this.stderr = this.process.stderr;

		let self = this;
		this.process.on('spawn', () => {
			// it should have one!
			self.cgroup.AttachProcess(self.process.pid!);
			self.emit('spawn');
		});

		this.process.on('exit', (code) => {
			self.emit('exit', code);
		});
	}

	kill(signal?: number | NodeJS.Signals): boolean {
		return this.process.kill(signal);
	}

	dispose(): void {
		this.stdin = null;
		this.stdout = null;
		this.stderr = null;

		this.process.removeAllListeners();
		this.removeAllListeners();
	}
}

export class QemuResourceLimitedLauncher implements IProcessLauncher {
	private group;

	constructor(name: string, limits: CgroupLimits) {
		let root = CGroup.Self();
		this.group = root.GetSubgroup(name);

		// Set cgroup keys.
		for(const val of MakeValuesFromLimits(limits)) {
			let controller = this.group.GetController(val.controller);
			controller.WriteValue(val.key, val.value);
		}
	}

	launch(command: string, opts?: ProcessLaunchOptions | undefined): IProcess {
		return new CGroupLimitedProcess(this.group, command, opts);
	}
}
