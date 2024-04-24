import { Logger } from '@cvmts/shared';

export class IPData {
	tempMuteExpireTimeout?: NodeJS.Timeout;
	muted: Boolean;
	vote: boolean | null;
	address: string;
	refCount: number = 0;

	constructor(address: string) {
		this.address = address;
		this.muted = false;
		this.vote = null;
	}

	// Call when a connection is closed to "release" the ip data
	Unref() {
		if (this.refCount - 1 < 0) this.refCount = 0;
		this.refCount--;
	}
}

export class IPDataManager {
	static ipDatas = new Map<string, IPData>();
	static logger = new Logger('CVMTS.IPDataManager');

	static GetIPData(address: string) {
		if (IPDataManager.ipDatas.has(address)) {
			// Note: We already check for if it exists, so we use ! here
			// because TypeScript can't exactly tell that in this case,
			// only in explicit null or undefined checks
			let ref = IPDataManager.ipDatas.get(address)!;
			ref.refCount++;
			return ref;
		}

		let data = new IPData(address);
		data.refCount++;
		IPDataManager.ipDatas.set(address, data);
		return data;
	}

	static ForEachIPData(callback: (d: IPData) => void) {
		for (let tuple of IPDataManager.ipDatas) callback(tuple[1]);
	}
}

// Garbage collect unreferenced IPDatas every 15 seconds.
// Strictly speaking this will just allow the v8 GC to finally
// delete the objects, but same difference.
setInterval(() => {
	for (let tuple of IPDataManager.ipDatas) {
		if (tuple[1].refCount == 0) {
			IPDataManager.logger.Info('Deleted ipdata for IP {0}', tuple[0]);
			IPDataManager.ipDatas.delete(tuple[0]);
		}
	}
}, 15000);
