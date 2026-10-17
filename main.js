import connectPgSimple from "connect-pg-simple";
import "dotenv/config";
import session from "express-session";
import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";
import { pool } from "./db.js";

const PgStore = connectPgSimple(session);
const app = createApp(pool, {
    sessionStore: new PgStore({ pool, createTableIfMissing: true }),
});

export default app;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
}
