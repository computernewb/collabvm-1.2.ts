import fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import pino from 'pino';
import { IaosMediaRepository } from './iaos/iaos.js';
import { MetaModule } from './module.js';

// config values
const LISTEN_HOST = process.env['META_HTTP_HOST'] || '127.0.0.1';
const LISTEN_PORT = parseInt(process.env['META_HTTP_PORT'] || '8199');
const REPO_PATH = process.env['META_IAOS_REPO'] || './media.toml';

const logger = pino();

const Modules: Array<{ prefix: string; module: MetaModule }> = [];

const iaos = new IaosMediaRepository(REPO_PATH, logger.child({ module: 'iaos' }));
await iaos.loadRepo();
Modules.push({ prefix: 'iaos', module: iaos });

// reload listener
process.on('SIGUSR1', () => {
	for (let module of Modules) {
		module.module.doReload();
	}
});

const app = fastify({
	loggerInstance: logger.child({ module: 'fastify' })
});

await app.register(fastifyCors, {
	origin: true
});

// Public API
await app.register(
	async (fastify, opts) => {
		for (let module of Modules) {
			await fastify.register(module.module.registerPublic(), { prefix: module.prefix });
		}
	},
	{ prefix: '/public' }
);

// Private API
await app.register(
	async (fastify, opts) => {
		fastify.get('/info', () => {
			return {
				version: 1,
				enabledFeatures: ['iaos']
			};
		});

		for (let module of Modules) {
			await fastify.register(module.module.registerPrivate(), { prefix: module.prefix });
		}
	},
	{ prefix: '/private' }
);

app.listen({ host: LISTEN_HOST, port: LISTEN_PORT });
