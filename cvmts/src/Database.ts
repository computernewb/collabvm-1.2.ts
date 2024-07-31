import pino, { Logger } from "pino";
import { MySQLConfig } from "./IConfig";
import * as mysql from 'mysql2/promise';

export class Database {
    cfg: MySQLConfig;
    logger: Logger;
    db: mysql.Pool;
    constructor(config: MySQLConfig) {
        this.cfg = config;
        this.logger = pino({
            name: "CVMTS.Database"
        });
        this.db = mysql.createPool({
            host: this.cfg.host,
            user: this.cfg.username,
            password: this.cfg.password,
            database: this.cfg.database,
            connectionLimit: 5,
            multipleStatements: false,
        });
    }

    async init() {
        // Make sure tables exist
        let conn = await this.db.getConnection();
        await conn.execute("CREATE TABLE IF NOT EXISTS bans (ip VARCHAR(43) PRIMARY KEY NOT NULL, username VARCHAR(20) NOT NULL, reason TEXT DEFAULT NULL, timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);");
        conn.release();
        this.logger.info("MySQL successfully initialized");
    }

    async banIP(ip: string, username: string, reason: string | null = null) {
        let conn = await this.db.getConnection();
        await conn.execute("INSERT INTO bans (ip, username, reason) VALUES (?, ?, ?);", [ip, username, reason]);
        conn.release();
    }

    async isIPBanned(ip: string): Promise<boolean> {
        let conn = await this.db.getConnection();
        let res = (await conn.query('SELECT COUNT(ip) AS cnt FROM bans WHERE ip = ?', [ip])) as mysql.RowDataPacket;
        conn.release();
        return res[0][0]['cnt'] !== 0;
    }
}