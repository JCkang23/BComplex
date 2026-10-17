export class PostgresRateLimitStore {
    constructor(db, namespace) {
        this.db = db;
        this.namespace = namespace;
        this.cleanupCounter = 0;
    }

    init(options) {
        this.windowMs = options.windowMs;
    }

    async increment(key) {
        const { rows } = await this.db.query(
            `INSERT INTO rate_limit_hits (key, hits, reset_at)
             VALUES ($1, 1, NOW() + ($2 * INTERVAL '1 millisecond'))
             ON CONFLICT (key) DO UPDATE
                SET hits = CASE
                    WHEN rate_limit_hits.reset_at <= NOW() THEN 1
                    ELSE rate_limit_hits.hits + 1
                END,
                    reset_at = CASE
                    WHEN rate_limit_hits.reset_at <= NOW() THEN NOW() + ($2 * INTERVAL '1 millisecond')
                    ELSE rate_limit_hits.reset_at
                END
             RETURNING hits, reset_at`,
            [`${this.namespace}:${key}`, this.windowMs]
        );

        if (++this.cleanupCounter % 100 === 0) {
            await this.db.query("DELETE FROM rate_limit_hits WHERE reset_at <= NOW()");
        }

        return {
            totalHits: Number(rows[0].hits),
            resetTime: new Date(rows[0].reset_at),
        };
    }

    async decrement(key) {
        await this.db.query(
            "UPDATE rate_limit_hits SET hits = GREATEST(hits - 1, 0) WHERE key = $1",
            [`${this.namespace}:${key}`]
        );
    }

    async resetKey(key) {
        await this.db.query("DELETE FROM rate_limit_hits WHERE key = $1", [`${this.namespace}:${key}`]);
    }

    async resetAll() {
        await this.db.query("DELETE FROM rate_limit_hits WHERE key LIKE $1", [`${this.namespace}:%`]);
    }
}
