import fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import pino from 'pino';
import * as fs from 'fs';
import * as toml from 'toml';
import IConfig from './IConfig.js';
import { IaosMediaRepository } from './iaos/iaos.js';
import { MetaModule } from './module.js';

const logger = pino();

let Config: IConfig;

if (!fs.existsSync('config.toml')) {
	logger.error('Fatal error: config.toml not found. Please copy config.example.toml and fill out fields');
	process.exit(1);
}
try {
	let configRaw = fs.readFileSync('config.toml').toString();
	Config = toml.parse(configRaw);
} catch (e) {
	logger.error({ err: e }, 'Fatal error: Failed to read or parse the config file');
	process.exit(1);
}

const Modules: Array<{ prefix: string; module: MetaModule }> = [];

if (Config.iaos.enabled) {
	const iaos = new IaosMediaRepository(Config.iaos.repository, logger.child({ module: 'iaos' }));
	await iaos.loadRepo();
	Modules.push({ prefix: 'iaos', module: iaos });
}

process.on('SIGUSR1', () => {
	for (let module of Modules) {
		module.module.doReload();
	}
});

const app = fastify({
	loggerInstance: logger.child({ module: 'fastify' })
});

await app.register(fastifyCors, {
	origin: Config.http.cors
});

await app.register(
	async (fastify, opts) => {
		for (let module of Modules) {
			await fastify.register(module.module.registerPublic(), { prefix: module.prefix });
		}
	},
	{ prefix: '/public' }
);

await app.register(
	async (fastify, opts) => {
		fastify.get('/info', () => {
			return {
				version: 1,
				enabledFeatures: Modules.map((module) => module.prefix)
			};
		});

		for (let module of Modules) {
			await fastify.register(module.module.registerPrivate(), { prefix: module.prefix });
		}
	},
	{ prefix: '/private' }
);

app.listen({ host: Config.http.host, port: Config.http.port });
