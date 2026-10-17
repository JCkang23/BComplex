import "dotenv/config";
import pg from "pg";

// A Pool, not a single Client:
//  - it reconnects on its own if Neon drops an idle connection,
//  - it serves concurrent requests on separate connections,
//  - pool.connect() gives you a dedicated connection for a real transaction
//    (BEGIN ... COMMIT on a shared Client would mix up different users' requests).
export const pool = new pg.Pool({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DB2,
    password: process.env.PG_PSWD,
    port: process.env.PG_PORT,
    // Verify the database's TLS certificate. `rejectUnauthorized: false` turns that
    // check off, which makes man-in-the-middle attacks possible.
    // Set PG_SSL=disable only for a local Postgres that has no TLS.
    ssl: process.env.PG_SSL === "disable" ? false : { rejectUnauthorized: true },
    max: 5,
});

// Without this, an error on an idle connection crashes the whole process.
pool.on("error", (err) => console.error("Unexpected database error:", err.message));
