import { FastifyInstance } from 'fastify';
import * as fs from 'fs/promises';
import * as toml from 'toml';
import { MetaModule } from '../module';
import { Logger } from 'pino';

export type RepositoryConfigType = {
	categories: { [id: string]: string };
	media: { [id: string]: MediaEntryType };
};

export type MediaKind = 'iso' | 'flp';

export type MediaEntryType = {
	kind: MediaKind;
	path: string;
	category: string;
	name: string;
	description: string | null;
	year: string | null;
	image_url: string | null;
};

export type MediaListEntryType = MediaEntryType & { id: string };

export type MediaRepoCategoryType = { name: string };
export type MediaRepoCategoryListType = { [id: string]: MediaRepoCategoryType };

export class IaosMediaRepository implements MetaModule {
	private repoPath: string;
	private categories: Map<string, MediaRepoCategoryType>;
	private mediaEntries: Map<string, MediaEntryType>;
	private logger: Logger;

	constructor(repoPath: string, logger: Logger) {
		this.repoPath = repoPath;
		this.categories = new Map();
		this.mediaEntries = new Map();
		this.logger = logger;
	}

	async loadRepo() {
		let confRaw = await fs.readFile(this.repoPath, { encoding: 'utf-8' });
		let conf = toml.parse(confRaw) as RepositoryConfigType;

		let categories: Map<string, MediaRepoCategoryType> = new Map();
		let mediaEntries: Map<string, MediaEntryType> = new Map();

		for (let categoryId of Object.keys(conf.categories)) {
			categories.set(categoryId, { name: conf.categories[categoryId] });
		}

		for (let entryId of Object.keys(conf.media)) {
			mediaEntries.set(entryId, conf.media[entryId]);
		}

		this.categories = categories;
		this.mediaEntries = mediaEntries;

		this.logger.info({ event: 'repo/loaded', categories: this.categories.size, entries: this.mediaEntries.size });
	}

	getCategories() {
		let categories: MediaRepoCategoryListType = {};

		for (let [id, cat] of this.categories) {
			categories[id] = cat;
		}

		return categories;
	}

	getMediaEntries() {
		let result: Array<MediaListEntryType> = [];

		for (let [id, entry] of this.mediaEntries.entries()) {
			result.push({ id, ...entry });
		}

		return result;
	}

	getMediaEntry(id: string) {
		return this.mediaEntries.get(id) ?? null;
	}

	registerPublic() {
		return async (fastify: FastifyInstance, opts: any) => {
			fastify.get('/media', async (request, reply) => {
				return {
					categories: this.getCategories(),
					media: this.getMediaEntries().map((entry) => {
						return {
							id: entry.id,
							kind: entry.kind,
							category: entry.category,
							name: entry.name,
							description: entry.description,
							year: entry.year,
							image_url: entry.image_url
						};
					})
				};
			});
		};
	}

	registerPrivate() {
		return async (fastify: FastifyInstance, opts: any) => {
			fastify.get('/media/:id', (request, reply) => {
				let { id } = request.params as { id: string };

				let entry = this.getMediaEntry(id);

				if (!entry) {
					reply.code(404);
					return { error: 'entry not found' };
				}

				return {
					id,
					name: entry.name,
					kind: entry.kind,
					path: entry.path
				};
			});
		};
	}

	async doReload(): Promise<void> {
		this.logger.info({ event: 'repo/reload' });
		await this.loadRepo();
	}
}
