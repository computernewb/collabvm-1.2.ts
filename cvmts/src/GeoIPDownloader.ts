import { Reader, ReaderModel } from '@maxmind/geoip2-node';
import * as fs from 'fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
import { finished } from 'node:stream/promises';
import { execa } from 'execa';
import pino from 'pino';

export default class GeoIPDownloader {
	private directory: string;
	private accountID: string;
	private licenseKey: string;
	private logger = pino({ name: 'CVMTS.GeoIPDownloader' });
	constructor(filename: string, accountID: string, licenseKey: string) {
		this.directory = filename;
		if (!this.directory.endsWith('/')) this.directory += '/';
		this.accountID = accountID;
		this.licenseKey = licenseKey;
	}

	private genAuthHeader(): string {
		return `Basic ${Buffer.from(`${this.accountID}:${this.licenseKey}`).toString('base64')}`;
	}

	private async ensureDirectoryExists(): Promise<void> {
		let stat;
		try {
			stat = await fs.stat(this.directory);
		} catch (e) {
			var error = e as NodeJS.ErrnoException;
			if (error.code === 'ENOTDIR') {
				this.logger.warn('File exists at GeoIP directory path, unlinking...');
				await fs.unlink(this.directory.substring(0, this.directory.length - 1));
			} else if (error.code !== 'ENOENT') {
				this.logger.error({ error }, 'Failed to access GeoIP directory');
				process.exit(1);
			}
			this.logger.info({ directory: this.directory }, 'Creating GeoIP directory');
			await fs.mkdir(this.directory, { recursive: true });
			return;
		}
	}

	async getGeoIPReader(): Promise<ReaderModel> {
		await this.ensureDirectoryExists();
		let dbpath = path.join(this.directory, (await this.getLatestVersion()).replace('.tar.gz', ''), 'GeoLite2-Country.mmdb');
		try {
			await fs.access(dbpath, fs.constants.F_OK | fs.constants.R_OK);
			this.logger.info({ database_path: dbpath }, 'Loading cached GeoIP database');
		} catch (ex) {
			var error = ex as NodeJS.ErrnoException;
			if (error.code === 'ENOENT') {
				await this.downloadLatestDatabase();
			} else {
				this.logger.error({ error }, 'Failed to access GeoIP directory');
				process.exit(1);
			}
		}
		return await Reader.open(dbpath);
	}

	async getLatestVersion(): Promise<string> {
		let res = await fetch('https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz', {
			redirect: 'follow',
			method: 'HEAD',
			headers: {
				Authorization: this.genAuthHeader()
			}
		});
		let disposition = res.headers.get('Content-Disposition');
		if (!disposition) {
			this.logger.error('Failed to get latest version of GeoIP database: No Content-Disposition header');
			process.exit(1);
		}
		let filename = disposition.match(/filename=(.*)$/);
		if (!filename) {
			this.logger.error('Failed to get latest version of GeoIP database: Could not parse version from Content-Disposition header');
			process.exit(1);
		}
		return filename[1];
	}

	async downloadLatestDatabase(): Promise<void> {
		let filename = await this.getLatestVersion();
		this.logger.info({ database_filename: filename }, 'Downloading latest GeoIP database');
		let dbpath = path.join(this.directory, filename);
		let file = await fs.open(dbpath, fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_WRONLY);
		let stream = file.createWriteStream();
		let res = await fetch('https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz', {
			redirect: 'follow',
			headers: {
				Authorization: this.genAuthHeader()
			}
		});
		await finished(Readable.fromWeb(res.body as ReadableStream<any>).pipe(stream));
		await file.close();
		this.logger.info({ database_filename: filename }, 'Finished downloading latest GeoIP database');
		this.logger.info({ database_filename: filename }, 'Extracting GeoIP database');
		// yeah whatever
		await execa('tar', ['xzf', filename], { cwd: this.directory });
		this.logger.info('Unlinking GeoIP tarball');
		await fs.unlink(dbpath);
	}
}
