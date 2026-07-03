import { FastifyInstance } from 'fastify';

export interface MetaModule {
	registerPublic(): (fastify: FastifyInstance, opts: any) => Promise<void>;
	registerPrivate(): (fastify: FastifyInstance, opts: any) => Promise<void>;
	doReload(): Promise<void>;
}
