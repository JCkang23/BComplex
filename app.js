import bcrypt from "bcrypt";
import ejs from "ejs";
import express from "express";
import rateLimit from "express-rate-limit";
import session from "express-session";
import helmet from "helmet";
import crypto from "node:crypto";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { z } from "zod";
import { PostgresRateLimitStore } from "./rate-limit-store.js";

const SALT_ROUNDS = 10;

// Hash of a throwaway string. If an email isn't found we still run bcrypt against
// this, so "no such user" and "wrong password" take the same time and look the same
const DUMMY_HASH = "$2b$10$8toi7AycwOSeQWZFHjjhieq2w5gK5Uv2PqwURi6VyPPdlGyG.Wyk2";

const ROOM_TYPES = ["commercial", "residential", "other"];

const homeFor = (role) => (role === "landlord" ? "/dashboard" : "/tDashboard");

// Pages that answer with a browser alert
// Only ever pass fixed strings here, never user input. JSON.stringify keeps them safe inside <script>
const alertThen = (message, action, nonce) =>
    `<script nonce="${nonce}">alert(${JSON.stringify(message)}); ${action};</script>`;
const goTo = (url) => `window.location.href = ${JSON.stringify(url)}`;
const GO_BACK = "history.back()";

// input validation
const email = z.string().trim().toLowerCase().pipe(z.email().max(100));
// bcrypt only uses the first 72 BYTES of a password, so refuse longer ones instead of silently cutting them
const password = z.string().min(8).refine((p) => Buffer.byteLength(p, "utf8") <= 72, "Password is too long");
const text = (max) => z.string().trim().min(1).max(max);
const money = z.coerce.number().positive().max(1_000_000);

const registerSchema = z.discriminatedUnion("role", [
    z.object({
        role: z.literal("landlord"),
        full_name: text(100),
        email,
        password,
        rooms_owned: z.coerce.number().int().min(1).max(50),
    }),
    z.object({
        role: z.literal("renter"),
        full_name: text(100),
        email,
        password,
        looking_for: z.enum(ROOM_TYPES),
        amount: z.coerce.number().min(0).max(1_000_000),
        desc: z.string().trim().max(1000).default(""),
        discoverable: z.literal("on").optional().transform(Boolean),
    }),
]);

const newRoomSchema = z.object({
    newRoomName: text(100),
    newPropertyDetails: text(2000),
    roomType: z.enum(ROOM_TYPES),
    newRoomValue: money,
});

const newRenterSchema = z
    .object({
        newRenterName: text(100),
        newRenterRoom: text(100),
        newRenterActivity: text(1000),
        newRenterValue: money,
        newRenterContractS: z.iso.date(),
        newRenterContractE: z.iso.date(),
    })
    .refine((d) => d.newRenterContractE > d.newRenterContractS, "The contract must end after it starts");

// Data
// Landlord's dashboard
async function loadDashboard(db, landlord) {
    const { rows } = await db.query(
        `SELECT rr.room_id, rr.renter_value, rr.renter_contract_start, rr.renter_contract_end,
                r.full_name AS renter_name
           FROM renters_rooms rr
           JOIN rooms ro ON ro.id = rr.room_id
           JOIN renters r ON r.id = rr.renter_id
          WHERE ro.landlord_id = $1
          ORDER BY rr.id`,
        [landlord.id]
    );
    const now = new Date();
    const contracts = rows.map((r) => ({
        avatar: "/images/images/wow.JPG",
        room_id: r.room_id,
        tenant_name: r.renter_name,
        start_date: r.renter_contract_start,
        end_date: r.renter_contract_end,
        status: new Date(r.renter_contract_end) >= now ? "Active" : "Expired",
    }));
    return {
        landlordName: landlord.full_name,
        tenantsCount: contracts.filter((c) => c.status === "Active").length,
        totalPayments: rows.reduce((sum, r) => sum + Number(r.renter_value || 0), 0),
        contracts,
    };
}


// db
export function createApp(
    db,
    {
        sessionStore,
        production = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL),
        rateLimitStore = (namespace) => new PostgresRateLimitStore(db, namespace),
    } = {}
) {
    if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is not set");

    const app = express();
    app.set("view engine", "ejs");
    app.set("views", "./views");
    app.engine("ejs", ejs.renderFile); // keeps `ejs` in Vercel's bundle
    // Proxy on Vercel for Secure cookies and correct client IPs (rate limiting)
    if (production) app.set("trust proxy", 1);

    app.use((req, res, next) => {
        res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
        next();
    });
    app.use(
        helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    imgSrc: ["'self'", "data:"],
                    connectSrc: ["'self'"],
                    objectSrc: ["'none'"],
                    baseUri: ["'self'"],
                    formAction: ["'self'"],
                    frameAncestors: ["'none'"],
                },
            },
        })
    );
    // replaces the separate body-parser package
    app.use(express.urlencoded({ extended: false }));
    app.use(express.static("public"));

    app.use(
        session({
            store: sessionStore, // undefined = in-memory (fine for tests and local dev only)
            secret: process.env.SESSION_SECRET,
            resave: false,
            saveUninitialized: false, // don't create a session for every anonymous visitor
            cookie: {
                httpOnly: true, // JavaScript on the page can't read the cookie
                sameSite: "lax", // not sent on cross-site POSTs (basic CSRF protection)
                secure: production, // HTTPS only in production
                maxAge: 1000 * 60 * 60,
            },
        })
    );

    // A Passport instance per app instead of the global one (no shared state, easier to test).
    const auth = new passport.Passport();
    app.use(auth.initialize());
    app.use(auth.session());

    // CSRF protection

    // Crucial to prevent false requests attached to your cookies
    
    // Views print the token with <%= csrfToken() %>. The session (and its cookie) is only created the
    // first time a page that has a form asks for the token.
    app.use((req, res, next) => {
        res.locals.csrfToken = () => (req.session.csrfToken ??= crypto.randomBytes(32).toString("hex"));

        if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();

        const sent = Buffer.from(String(req.body?._csrf ?? ""));
        const expected = Buffer.from(req.session.csrfToken ?? "");
        // timingSafeEqual needs equal lengths; it also avoids leaking how many characters matched.
        if (expected.length > 0 && sent.length === expected.length && crypto.timingSafeEqual(sent, expected)) {
            return next();
        }
        return res
            .status(403)
            .send(alertThen("Your session expired or the form was not valid. Please sign in again.", goTo("/login"), res.locals.cspNonce));
    });

    // The session holds ONLY these three fields. Before, the whole database row went in,
    // including password_hash.
    auth.serializeUser((user, done) => done(null, { id: user.id, role: user.role, full_name: user.full_name }));
    auth.deserializeUser((user, done) => done(null, user));

    auth.use(
        new LocalStrategy(
            { usernameField: "email", passwordField: "password", passReqToCallback: true },
            async (req, rawEmail, rawPassword, done) => {
                try {
                    const role = req.body.role;
                    if (role !== "landlord" && role !== "renter") return done(null, false);
                    if (typeof rawEmail !== "string" || typeof rawPassword !== "string") return done(null, false);

                    const table = role === "landlord" ? "landlords" : "renters";
                    const { rows } = await db.query(
                        `SELECT id, full_name, password_hash FROM ${table} WHERE email = $1`,
                        [rawEmail.trim().toLowerCase()]
                    );
                    const row = rows[0];
                    const ok = await bcrypt.compare(rawPassword, row ? row.password_hash : DUMMY_HASH);
                    if (!row || !ok) return done(null, false);
                    return done(null, { id: row.id, role, full_name: row.full_name });
                } catch (err) {
                    return done(err);
                }
            }
        )
    );

    // Guards
    const requireRole =
        (role, { json = false } = {}) =>
        (req, res, next) => {
            if (req.isAuthenticated() && req.user.role === role) return next();
            if (json) return res.status(401).json({ error: "Unauthorized" });
            // Wrong kind of user, sent them to home, not login page
            return res.redirect(req.isAuthenticated() ? homeFor(req.user.role) : "/login");
        };
    const landlordOnly = requireRole("landlord");
    const landlordApi = requireRole("landlord", { json: true });
    const renterOnly = requireRole("renter");

    // ratelimit = 10 failed attempts per IP per 15 minutes
    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        store: rateLimitStore("login"),
        skipSuccessfulRequests: true,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        handler: (req, res) =>
            res.status(429).send(alertThen("Too many attempts. Please try again in 15 minutes.", goTo("/login"), res.locals.cspNonce)),
    });
    const registerLimiter = rateLimit({
        windowMs: 60 * 60 * 1000,
        limit: 20,
        store: rateLimitStore("register"),
        standardHeaders: "draft-8",
        legacyHeaders: false,
        handler: (req, res) =>
            res.status(429).send(alertThen("Too many sign-ups from this network. Please try later.", goTo("/"), res.locals.cspNonce)),
    });

    // Pages
    app.get("/", (req, res) => res.render("credential.ejs"));
    app.get("/register", (req, res) => {
        const role = req.query.role;
        res.render("register.ejs", { landlord: role === "landlord", renter: role === "renter" });
    });
    app.get("/login", (req, res) => res.render("login.ejs"));

    app.post("/logout", (req, res, next) => {
        req.logout((err) => (err ? next(err) : res.redirect("/")));
    });

    // Registration
    app.post("/register", registerLimiter, async (req, res, next) => {
        const parsed = registerSchema.safeParse(req.body);
        if (!parsed.success) {
            return res
                .status(400)
                .send(alertThen("Please check your details (valid email, password of at least 8 characters).", GO_BACK, res.locals.cspNonce));
        }
        const data = parsed.data;
        const exists = () => res.send(alertThen("User already exists. Try logging in instead!", goTo("/login"), res.locals.cspNonce));

        try {
            const taken = await db.query(
                "SELECT 1 FROM landlords WHERE email = $1 UNION ALL SELECT 1 FROM renters WHERE email = $1",
                [data.email]
            );
            if (taken.rows.length > 0) return exists();

            const hash = await bcrypt.hash(data.password, SALT_ROUNDS);
            const { rows } =
                data.role === "landlord"
                    ? await db.query(
                          "INSERT INTO landlords (full_name, email, password_hash, rooms_owned) VALUES ($1, $2, $3, $4) RETURNING id, full_name",
                          [data.full_name, data.email, hash, data.rooms_owned]
                      )
                    : await db.query(
                          "INSERT INTO renters (full_name, email, password_hash, preference, budget, activity_desc, discoverable) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, full_name",
                          [data.full_name, data.email, hash, data.looking_for, data.amount, data.desc, data.discoverable]
                      );

            const user = { id: rows[0].id, role: data.role, full_name: rows[0].full_name };
            // refreshing the page does not re-submit the form
            req.login(user, (err) => (err ? next(err) : res.redirect(homeFor(user.role))));
        } catch (err) {
            if (err.code === "23505") return exists();
            next(err);
        }
    });

    app.post("/login", loginLimiter, (req, res, next) => {
        auth.authenticate("local", (err, user) => {
            if (err) return next(err);
            if (!user) {
                return res
                    .status(401)
                    .send(alertThen("User not found or incorrect credentials! Please, try again...", goTo("/login"), res.locals.cspNonce));
            }
            req.logIn(user, (err) => (err ? next(err) : res.redirect(homeFor(user.role))));
        })(req, res, next);
    });

    // Renter pages
    app.get("/tDashboard", renterOnly, async (req, res) => {
        const { rows } = await db.query("SELECT discoverable FROM renters WHERE id = $1", [req.user.id]);
        res.render("tenant/tDashboard.ejs", {
            renterName: req.user.full_name,
            discoverable: rows[0]?.discoverable ?? false,
        });
    });

    app.post("/renter/discoverability", renterOnly, async (req, res) => {
        const discoverable = req.body.discoverable === "on";
        await db.query("UPDATE renters SET discoverable = $1 WHERE id = $2", [discoverable, req.user.id]);
        res.redirect("/tDashboard");
    });

    // Landlord pages
    app.get("/profile", landlordOnly, (req, res) => res.render("landlord/profile.ejs"));
    app.get("/account", landlordOnly, (req, res) => res.render("landlord/profile.ejs"));

    app.get("/dashboard", landlordOnly, async (req, res) => {
        res.render("landlord/dashboard.ejs", await loadDashboard(db, req.user));
    });

    app.get("/lease", landlordOnly, async (req, res) => {
        const landlordId = req.user.id;
        const [rooms, leases, renters] = await Promise.all([
            db.query(
                "SELECT id, title, room_details, room_type, room_price, is_available FROM rooms WHERE landlord_id = $1 ORDER BY id",
                [landlordId]
            ),
            db.query(
                `SELECT rr.*, r.full_name AS renter_name
                   FROM renters_rooms rr
                   JOIN renters r ON rr.renter_id = r.id
                   JOIN rooms ro ON rr.room_id = ro.id
                  WHERE ro.landlord_id = $1
                  ORDER BY rr.id`,
                [landlordId]
            ),
            db.query(
                "SELECT full_name, preference, budget, activity_desc FROM renters WHERE discoverable = TRUE ORDER BY full_name"
            ),
        ]);
        res.render("landlord/lease.ejs", {
            roomsTable: rooms.rows,
            renterRoomsTable: leases.rows,
            tenantsTable: renters.rows,
        });
    });

    app.get("/api/available-rooms", landlordApi, async (req, res) => {
        const { rows } = await db.query(
            "SELECT id, title, room_price FROM rooms WHERE landlord_id = $1 AND is_available = TRUE ORDER BY id",
            [req.user.id]
        );
        res.json(rows);
    });

    app.get("/api/renter-details/:renterName", landlordApi, async (req, res) => {
        const { rows } = await db.query(
            "SELECT budget, activity_desc FROM renters WHERE full_name = $1 AND discoverable = TRUE LIMIT 2",
            [req.params.renterName]
        );
        if (rows.length === 0) return res.status(404).json({ error: "Renter not found" });
        // Names are not unique. Better than guessing: refuse. (Later: send the renter's id instead of the name.)
        if (rows.length > 1) return res.status(409).json({ error: "More than one renter has this name" });
        res.json(rows[0]);
    });

    // Placeholder pages
    app.get("/contracts", landlordOnly, (req, res) => {
        const tenants = [
            { name: "Emily Johnson", period: "Jan. 2023 → Feb. 2024", status: "Active", photo: "" },
            { name: "Michael Brown", period: "Sep. 2025 → Jun. 14, 2024", status: "Paid", photo: "" },
            { name: "Samantha Lee", period: "Apr. 2023 → Aug. 2024", status: "Ended", photo: "" },
        ];
        res.render("landlord/contracts.ejs", { tenants });
    });

    app.get("/messages", landlordOnly, (req, res) => {
        const tenants = [
            { name: "Emily Johnson", agent: "Alex Smith" },
            { name: "Michael Brown", agent: "Alex Smith" },
            { name: "Sarah Davis", agent: "Anna Lee" },
        ];
        const messages = [
            { from: "tenant", text: "Hello!", avatar: "" },
            { from: "agent", text: "Hi...", avatar: "" },
        ];
        res.render("landlord/messages.ejs", { tenants, messages, selectedTenant: "Emily Johnson" });
    });

    app.get("/payments", landlordOnly, (req, res) => {
        const payments = [
            { tenant: "Michael Brown", amount: 1200, date: "Mar. 1", photo: "" },
            { tenant: "Sara Davis", amount: 1300, date: "Feb. 26", photo: "" },
            { tenant: "Emily Johnson", amount: 1250, date: "Feb. 25", photo: "" },
            { tenant: "Sara Davis", amount: 1300, date: "Jan. 28", photo: "" },
            { tenant: "Michael Brown", amount: 1200, date: "Jan. 4", photo: "" },
        ];
        res.render("landlord/payments.ejs", { payments });
    });

    // Landlord features
    app.post("/newRoom", landlordOnly, async (req, res) => {
        const parsed = newRoomSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).send(alertThen("Please check the room details.", goTo("/lease"), res.locals.cspNonce));
        const d = parsed.data;
        const landlordId = req.user.id;

        const client = await db.connect();
        try {
            await client.query("BEGIN");
            const limit = await client.query("SELECT rooms_owned FROM landlords WHERE id = $1 FOR UPDATE", [landlordId]);
            const count = await client.query("SELECT COUNT(*) FROM rooms WHERE landlord_id = $1", [landlordId]);
            const allowed = limit.rows[0]?.rooms_owned ?? 0;
            if (parseInt(count.rows[0].count, 10) >= allowed) {
                await client.query("ROLLBACK");
                return res.send(alertThen(`You have reached your room limit (${allowed}).`, goTo("/lease"), res.locals.cspNonce));
            }

            // Room names identify rooms in the lease form, so they must be unique per landlord
            const duplicate = await client.query(
                "SELECT 1 FROM rooms WHERE landlord_id = $1 AND lower(title) = lower($2)",
                [landlordId, d.newRoomName]
            );
            if (duplicate.rows.length > 0) {
                await client.query("ROLLBACK");
                return res.send(alertThen("You already have a room with this name.", goTo("/lease"), res.locals.cspNonce));
            }

            await client.query(
                "INSERT INTO rooms (title, room_details, room_type, room_price, landlord_id) VALUES ($1, $2, $3, $4, $5)",
                [d.newRoomName, d.newPropertyDetails, d.roomType, d.newRoomValue, landlordId]
            );
            await client.query("COMMIT");
        } catch (err) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Failed to roll back room creation:", rollbackError);
            }
            // The unique index caught a duplicate that slipped past the check above
            if (err.code === "23505")
                return res.send(alertThen("You already have a room with this name.", goTo("/lease"), res.locals.cspNonce));
            throw err;
        } finally {
            client.release();
        }
        res.redirect("/lease");
    });

    app.post("/newRenter", landlordOnly, async (req, res) => {
        const parsed = newRenterSchema.safeParse(req.body);
        if (!parsed.success) {
            return res
                .status(400)
                .send(alertThen("Please check the lease details (dates, rent value).", goTo("/lease"), res.locals.cspNonce));
        }
        const d = parsed.data;
        const stop = (message) => res.send(alertThen(message, goTo("/lease"), res.locals.cspNonce));

        // Two writes that must succeed or fail together => one transaction on ONE connection.
        const client = await db.connect();
        try {
            await client.query("BEGIN");

            const renters = await client.query(
                "SELECT id FROM renters WHERE full_name = $1 AND discoverable = TRUE",
                [d.newRenterName]
            );
            if (renters.rows.length !== 1) {
                await client.query("ROLLBACK");
                return stop(
                    renters.rows.length === 0
                        ? "Renter not found or has not opted into discovery."
                        : "More than one renter has this name. Ask them to register with a distinct name."
                );
            }
            const renterId = renters.rows[0].id;

            // Claim the room in a single statement. It only succeeds if the room belongs to THIS landlord
            // and is still free, so you can't take someone else's room and two clicks can't double-book it
            const claimed = await client.query(
                `UPDATE rooms SET is_available = FALSE, renter_id = $1
                  WHERE id = (SELECT id FROM rooms
                               WHERE title = $2 AND landlord_id = $3 AND is_available = TRUE
                               ORDER BY id LIMIT 1 FOR UPDATE)
              RETURNING id`,
                [renterId, d.newRenterRoom, req.user.id]
            );
            if (claimed.rows.length === 0) {
                await client.query("ROLLBACK");
                return stop("Room not found, or it is already occupied.");
            }

            await client.query(
                `INSERT INTO renters_rooms (renter_id, room_id, renter_details, renter_value, renter_contract_start, renter_contract_end)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [renterId, claimed.rows[0].id, d.newRenterActivity, d.newRenterValue, d.newRenterContractS, d.newRenterContractE]
            );
            await client.query("COMMIT");
            res.redirect("/lease");
        } catch (err) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Failed to roll back lease creation:", rollbackError);
            }
            throw err;
        } finally {
            client.release();
        }
    });

    // Error handling
    app.use((err, req, res, next) => {
        console.error(err);
        if (res.headersSent) return next(err);
        res.status(500).send("Something went wrong. Please try again later.");
    });

    return app;
}