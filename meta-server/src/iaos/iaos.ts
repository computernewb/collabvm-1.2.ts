import { FastifyInstance } from 'fastify';
import * as fs from 'fs/promises';
import { statSync, realpathSync } from 'fs';
import { join } from 'path';
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
	build_number: string | null;
	architecture: string | null;
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
		let categories: Map<string, MediaRepoCategoryType> = new Map();
		let mediaEntries: Map<string, MediaEntryType> = new Map();
		let realPath = await fs.realpath(this.repoPath);
		let filesLoaded: number;

		let stat = await fs.stat(realPath);

		if (stat.isDirectory()) {
			let dirEntries = await fs.readdir(realPath, { withFileTypes: true, recursive: true });
			let repoFiles = dirEntries
				.filter((e) => e.name.endsWith('.toml') && (e.isFile() || (e.isSymbolicLink() && statSync(realpathSync(e.name)).isFile())))
				.map((e) => join(e.parentPath, e.name));

			for (let repoFile of repoFiles) {
				await this.loadRepoFile(repoFile, categories, mediaEntries);
			}
			filesLoaded = repoFiles.length;
		} else if (stat.isFile()) {
			await this.loadRepoFile(realPath, categories, mediaEntries);
			filesLoaded = 1;
		} else {
			throw new Error(realPath + ' is not a file or directory');
		}

		this.categories = categories;
		this.mediaEntries = mediaEntries;

		this.logger.info({ event: 'repo/loaded', filesLoaded, categories: this.categories.size, entries: this.mediaEntries.size });
	}

	private async loadRepoFile(path: string, categories: Map<string, MediaRepoCategoryType>, mediaEntries: Map<string, MediaEntryType>) {
		let confRaw = await fs.readFile(path, { encoding: 'utf-8' });
		let conf = toml.parse(confRaw) as RepositoryConfigType;

		let totalCategories = 0;
		let totalEntries = 0;

		if (conf.categories) {
			for (let categoryId of Object.keys(conf.categories)) {
				categories.set(categoryId, { name: conf.categories[categoryId] });
				totalCategories++;
			}
		}

		if (conf.media) {
			for (let entryId of Object.keys(conf.media)) {
				mediaEntries.set(entryId, conf.media[entryId]);
				totalEntries++;
			}
		}

		this.logger.info({ event: 'repo/loadedFile', file: path, categories: totalCategories, entries: totalEntries });
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
							image_url: entry.image_url,
							build_number: entry.build_number,
							architecture: entry.architecture
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
