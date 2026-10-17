import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addLandlord, addRenter, addRoom, createTestDb, csrfToken, form, login, makeApp, PASSWORD } from "./helpers.js";

let db;
beforeAll(async () => {
    db = await createTestDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

const redirectsTo = (res, url) => {
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(url);
};

describe("login: the server decides who you are, not the form", () => {
    it("lets a landlord in and shows their dashboard", async () => {
        await addLandlord(db, { email: "lana@example.com" });
        const { app } = makeApp(db);
        const agent = request.agent(app);

        redirectsTo(await login(agent, { email: "lana@example.com", role: "landlord" }), "/dashboard");
        const dash = await agent.get("/dashboard");
        expect(dash.status).toBe(200);
        expect(dash.text).toContain("Welcome, Lana Landlord");
    });

    it("does not let a renter become a landlord by picking 'landlord' in the form", async () => {
        await addRenter(db, { email: "rita@example.com" });
        const { app } = makeApp(db);
        const agent = request.agent(app);

        const res = await login(agent, { email: "rita@example.com", role: "landlord" });
        expect(res.status).toBe(401);
        redirectsTo(await agent.get("/dashboard"), "/login");
    });

    it("does not hand a renter landlord #1's rooms just because their numeric ids match", async () => {
        // Landlord #1 and renter #1 both exist (different tables, ids both start at 1).
        // If the app believed the form, renter #1 claiming "landlord" would act as landlord #1.
        const landlordId = await addLandlord(db, { email: "lana@example.com" });
        await addRoom(db, landlordId, "Suite 1");
        await addRenter(db, { email: "rita@example.com" });
        const { app } = makeApp(db);
        const agent = request.agent(app);

        // The renter tries the attack...
        expect((await login(agent, { email: "rita@example.com", role: "landlord" })).status).toBe(401);
        expect((await agent.get("/api/available-rooms")).status).toBe(401);
        redirectsTo(await form(agent, "post", "/newRoom", { newRoomName: "Hacked" }), "/login");
        expect((await db.query("SELECT COUNT(*)::int AS n FROM rooms")).rows[0].n).toBe(1);

        // ...and even when they log in honestly as a renter, landlord pages stay closed.
        redirectsTo(await login(agent, { email: "rita@example.com", role: "renter" }), "/tDashboard");
        redirectsTo(await agent.get("/dashboard"), "/tDashboard"); // bounced to their own home
        expect((await agent.get("/api/available-rooms")).status).toBe(401);
    });

    it("gives the same answer for an unknown email and a wrong password", async () => {
        await addLandlord(db, { email: "lana@example.com" });
        const { app } = makeApp(db);

        const unknown = await login(request.agent(app), { email: "nobody@example.com", role: "landlord" });
        const wrong = await login(request.agent(app), { email: "lana@example.com", role: "landlord", password: "nope-nope-nope" });
        expect(unknown.status).toBe(wrong.status);
        expect(unknown.text.replace(/nonce="[^"]+"/, 'nonce=""')).toBe(wrong.text.replace(/nonce="[^"]+"/, 'nonce=""'));
    });

    it("treats emails case-insensitively", async () => {
        await addLandlord(db, { email: "lana@example.com" });
        const { app } = makeApp(db);
        redirectsTo(await login(request.agent(app), { email: "  LANA@Example.com ", role: "landlord" }), "/dashboard");
    });

    it("refuses nonsense input instead of crashing", async () => {
        const { app } = makeApp(db);
        const noRole = await form(request.agent(app), "post", "/login", { email: "a@b.co", password: PASSWORD });
        expect(noRole.status).toBe(401);
        const agent = request.agent(app);
        const token = await csrfToken(agent);
        const twoEmails = await agent.post("/login").type("form").send(`_csrf=${token}&email=a@b.co&email=c@d.co&password=x&role=renter`);
        expect(twoEmails.status).toBe(401);
        const protoRole = await login(request.agent(app), { email: "a@b.co", role: "constructor" });
        expect(protoRole.status).toBe(401);
    });

    it("locks out repeated failed logins from one address", async () => {
        await addLandlord(db, { email: "lana@example.com" });
        const { app } = makeApp(db);
        for (let i = 0; i < 10; i++) {
            const res = await login(request.agent(app), { email: "lana@example.com", role: "landlord", password: "wrong-password" });
            expect(res.status).toBe(401);
        }
        const blocked = await login(request.agent(app), { email: "lana@example.com", role: "landlord" }); // even the right password
        expect(blocked.status).toBe(429);
    });

    it("shares failed-login limits across separate app instances", async () => {
        await addLandlord(db, { email: "lana@example.com" });
        const instanceA = makeApp(db).app;
        const instanceB = makeApp(db).app;

        for (let i = 0; i < 6; i++) {
            expect((await login(request.agent(instanceA), {
                email: "lana@example.com",
                role: "landlord",
                password: "wrong-password",
            })).status).toBe(401);
        }
        for (let i = 0; i < 4; i++) {
            expect((await login(request.agent(instanceB), {
                email: "lana@example.com",
                role: "landlord",
                password: "wrong-password",
            })).status).toBe(401);
        }
        expect(
            (await login(request.agent(instanceA), {
                email: "lana@example.com",
                role: "landlord",
                password: "wrong-password",
            })).status
        ).toBe(429);
    });
});

describe("sessions", () => {
    it("sets an HttpOnly, SameSite=Lax cookie, plus Secure in production", async () => {
        await addLandlord(db, { email: "lana@example.com" });
        const { app } = makeApp(db, { production: true });
        const https = { "X-Forwarded-Proto": "https" }; // pretend a proxy told us the visitor used HTTPS
        // Secure cookies are never sent back over plain http, so carry the cookie by hand in this one test.
        const page = await request(app).get("/login").set(https);
        const sessionCookie = page.headers["set-cookie"][0].split(";")[0];
        const token = /name="_csrf" value="([^"]+)"/.exec(page.text)[1];
        const res = await request(app)
            .post("/login")
            .set(https)
            .set("Cookie", sessionCookie)
            .type("form")
            .send({ _csrf: token, email: "lana@example.com", password: PASSWORD, role: "landlord" });
        const cookie = res.headers["set-cookie"].join(";");
        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("SameSite=Lax");
        expect(cookie).toContain("Secure");
    });

    it("only creates a session when a page with a form needs a CSRF token", async () => {
        const { app } = makeApp(db);
        expect((await request(app).get("/")).headers["set-cookie"]).toBeUndefined();
        expect((await request(app).get("/login")).headers["set-cookie"].join(";")).toContain("connect.sid");
    });

    it("keeps only id, role and name in the session (no password hash)", async () => {
        await addLandlord(db, { email: "lana@example.com" });
        const { app, store } = makeApp(db);
        await login(request.agent(app), { email: "lana@example.com", role: "landlord" });

        const saved = JSON.stringify(store.sessions);
        expect(saved).toContain('\\"role\\":\\"landlord\\"');
        expect(saved).not.toContain("password_hash");
        expect(saved).not.toContain("$2b$");
    });

    it("logs out", async () => {
        await addLandlord(db, { email: "lana@example.com" });
        const { app } = makeApp(db);
        const agent = request.agent(app);
        await login(agent, { email: "lana@example.com", role: "landlord" });
        expect((await agent.get("/dashboard")).status).toBe(200);

        redirectsTo(await form(agent, "post", "/logout"), "/");
        redirectsTo(await agent.get("/dashboard"), "/login");
    });
});

describe("registration", () => {
    const landlord = {
        role: "landlord",
        full_name: "Lana Landlord",
        email: "Lana@Example.com",
        password: "a-long-passphrase",
        rooms_owned: "3",
    };
    const renter = {
        role: "renter",
        full_name: "Rita Renter",
        email: "rita@example.com",
        password: "a-long-passphrase",
        looking_for: "commercial",
        amount: "500",
        desc: "bakery",
    };

    it("creates a landlord, stores a lowercase email and a bcrypt hash, and signs them in", async () => {
        const { app } = makeApp(db);
        const agent = request.agent(app);

        redirectsTo(await form(agent, "post", "/register", landlord), "/dashboard");
        expect((await agent.get("/dashboard")).status).toBe(200);

        const { rows } = await db.query("SELECT email, password_hash FROM landlords");
        expect(rows[0].email).toBe("lana@example.com");
        expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
        expect(rows[0].password_hash).not.toContain("a-long-passphrase");
    });

    it("creates a renter as private by default and sends them to the renter dashboard", async () => {
        const { app } = makeApp(db);
        const agent = request.agent(app);

        redirectsTo(await form(agent, "post", "/register", renter), "/tDashboard");
        const page = await agent.get("/tDashboard");
        expect(page.status).toBe(200);
        expect(page.text).toContain("Rita Renter");
        expect((await db.query("SELECT discoverable FROM renters")).rows[0].discoverable).toBe(false);
    });

    it("stores a renter's explicit discovery consent", async () => {
        const { app } = makeApp(db);
        const consented = await form(request.agent(app), "post", "/register", { ...renter, discoverable: "on" });
        redirectsTo(consented, "/tDashboard");
        expect((await db.query("SELECT discoverable FROM renters")).rows[0].discoverable).toBe(true);
    });

    it("refuses a second account with the same email, in either table and in any letter case", async () => {
        const { app } = makeApp(db);
        await form(request.agent(app), "post", "/register", landlord);

        const again = await form(request.agent(app), "post", "/register", { ...landlord, email: "LANA@EXAMPLE.COM" });
        expect(again.text).toContain("already exists");
        const asRenter = await form(request.agent(app), "post", "/register", { ...renter, email: "lana@example.com" });
        expect(asRenter.text).toContain("already exists");
        const rows = await db.query("SELECT (SELECT COUNT(*) FROM landlords)::int AS l, (SELECT COUNT(*) FROM renters)::int AS r");
        expect(rows.rows[0]).toEqual({ l: 1, r: 0 });
    });

    it.each([
        ["an unknown role", { ...landlord, role: "admin" }],
        ["no role", { ...landlord, role: undefined }],
        ["a short password", { ...landlord, password: "short" }],
        ["a password over bcrypt's 72-byte limit", { ...landlord, password: "a".repeat(73) }],
        ["a bad email", { ...landlord, email: "not-an-email" }],
        ["too many rooms", { ...landlord, rooms_owned: "5000" }],
        ["a renter with an unknown space type", { ...renter, looking_for: "castle" }],
    ])("answers 400 (and creates nothing) for %s", async (_label, body) => {
        const { app } = makeApp(db);
        const res = await form(request.agent(app), "post", "/register", body);
        expect(res.status).toBe(400);
        const rows = await db.query("SELECT (SELECT COUNT(*) FROM landlords)::int + (SELECT COUNT(*) FROM renters)::int AS n");
        expect(rows.rows[0].n).toBe(0);
    });
});
