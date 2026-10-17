import { PGlite } from "@electric-sql/pglite";
import bcrypt from "bcrypt";
import session from "express-session";
import fs from "node:fs";
import { createApp } from "../app.js";

process.env.SESSION_SECRET ??= "test-secret";

export const PASSWORD = "Password123";

// A real Postgres running inside this process (PGlite), built from your queries.sql.
// It exposes the same two methods the app uses on a pg Pool: query() and connect().
export async function createTestDb() {
    const lite = new PGlite();
    await lite.exec(fs.readFileSync(new URL("../queries.sql", import.meta.url), "utf8"));
    const query = (text, params) => lite.query(text, params);
    return {
        query,
        connect: async () => ({ query, release() {} }),
        // RESTART IDENTITY makes ids start at 1 again, so landlord #1 and renter #1 both exist
        // in every test (that id overlap is what made the old role bug dangerous).
        reset: () => lite.exec("TRUNCATE renters_rooms, rooms, renters, landlords, rate_limit_hits RESTART IDENTITY CASCADE"),
        close: () => lite.close(),
    };
}

export function makeApp(db, options = {}) {
    const store = new session.MemoryStore();
    const app = createApp(db, { sessionStore: store, production: false, ...options });
    return { app, store };
}

const hash = (pw) => bcrypt.hashSync(pw, 4); // cheap cost so tests stay fast

export async function addLandlord(db, { name = "Lana Landlord", email, rooms_owned = 5 }) {
    const { rows } = await db.query(
        "INSERT INTO landlords (full_name, email, password_hash, rooms_owned) VALUES ($1, $2, $3, $4) RETURNING id",
        [name, email, hash(PASSWORD), rooms_owned]
    );
    return rows[0].id;
}

export async function addRenter(db, { name = "Rita Renter", email, discoverable = false }) {
    const { rows } = await db.query(
        "INSERT INTO renters (full_name, email, password_hash, preference, budget, activity_desc, discoverable) VALUES ($1, $2, $3, 'commercial', 900, 'a bakery', $4) RETURNING id",
        [name, email, hash(PASSWORD), discoverable]
    );
    return rows[0].id;
}

export async function addRoom(db, landlordId, title, price = 1000) {
    const { rows } = await db.query(
        "INSERT INTO rooms (title, room_details, room_type, room_price, landlord_id) VALUES ($1, 'details', 'commercial', $2, $3) RETURNING id",
        [title, price, landlordId]
    );
    return rows[0].id;
}

export async function addLease(db, { renterId, roomId, value, end = "2099-01-01" }) {
    await db.query(
        "INSERT INTO renters_rooms (renter_id, room_id, renter_details, renter_value, renter_contract_start, renter_contract_end) VALUES ($1, $2, 'x', $3, '2024-01-01', $4)",
        [renterId, roomId, value, end]
    );
    await db.query("UPDATE rooms SET is_available = FALSE, renter_id = $1 WHERE id = $2", [renterId, roomId]);
}

// Every POST needs the CSRF token that the server prints in its forms. This reads it from a page,
// the same way a browser would, then sends it back as the hidden "_csrf" field.
export async function csrfToken(agent, headers = {}) {
    let req = agent.get("/login");
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    const res = await req;
    const match = /name="_csrf" value="([^"]+)"/.exec(res.text);
    if (!match) throw new Error("No CSRF token found on /login");
    return match[1];
}

// { csrf: false } sends the form WITHOUT a token (what an attacker's page would do).
export async function form(agent, method, url, body = {}, { csrf = true, headers = {} } = {}) {
    const payload = csrf ? { _csrf: await csrfToken(agent, headers), ...body } : body;
    let req = agent[method](url).type("form");
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return req.send(payload);
}

export const login = (agent, { email, role, password = PASSWORD }, options) =>
    form(agent, "post", "/login", { email, password, role }, options);
