export type MetaApiInfo = {
	version: number;
	enabledFeatures: Array<string>;
};

export type IaosMediaEntry = {
	id: string;
	name: string;
	kind: string;
	path: string;
};

const META_VERSION_SUPPORTED = 1;

export class MetaApi {
	private apiBase: string;
	constructor(apiBase: string) {
		this.apiBase = apiBase;
	}

	async getEnabledFeatures(): Promise<Array<string>> {
		let res = await fetch(`${this.apiBase}/info`);

		if (!res.ok) {
			throw new Error(`Meta server returned error status code ${res.status}`);
		}

		let info = (await res.json()) as MetaApiInfo;

		if (info.version !== META_VERSION_SUPPORTED) {
			throw new Error(`Meta API version mismatch: meta server reports version ${info.version} but this server supports version ${META_VERSION_SUPPORTED}`);
		}

		return info.enabledFeatures;
	}

	async iaosGetMediaById(id: string): Promise<IaosMediaEntry | null> {
		let res = await fetch(`${this.apiBase}/iaos/media/${id}`);

		if (!res.ok) {
			return null;
		}

		return (await res.json()) as IaosMediaEntry;
	}
}
