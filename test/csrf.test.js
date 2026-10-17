import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addLandlord, addRenter, createTestDb, csrfToken, form, login, makeApp } from "./helpers.js";

let db;
beforeAll(async () => {
    db = await createTestDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

const newRoom = { newRoomName: "Suite 1", newPropertyDetails: "Corner", roomType: "commercial", newRoomValue: "1000" };

async function loggedInLandlord(app) {
    await addLandlord(db, { email: "lana@example.com" });
    const agent = request.agent(app);
    await login(agent, { email: "lana@example.com", role: "landlord" });
    return agent;
}

describe("CSRF: forms submitted without the secret token are refused", () => {
    it("blocks the real attack: a logged-in landlord's browser posting a forged form", async () => {
        const { app } = makeApp(db);
        const agent = await loggedInLandlord(app);

        // This is what a malicious website's hidden form would send: valid cookie, but no token.
        const forged = await form(agent, "post", "/newRoom", newRoom, { csrf: false });
        expect(forged.status).toBe(403);
        expect((await db.query("SELECT COUNT(*)::int AS n FROM rooms")).rows[0].n).toBe(0);

        // The same request with the token (what our own page sends) works.
        const genuine = await form(agent, "post", "/newRoom", newRoom);
        expect(genuine.status).toBe(302);
        expect((await db.query("SELECT COUNT(*)::int AS n FROM rooms")).rows[0].n).toBe(1);
    });

    it.each(["/login", "/register", "/logout", "/newRoom", "/newRenter"])("refuses POST %s without a token", async (url) => {
        const { app } = makeApp(db);
        const agent = await loggedInLandlord(app);
        expect((await form(agent, "post", url, {}, { csrf: false })).status).toBe(403);
    });

    it("refuses a wrong token, an empty token and a token of the wrong length", async () => {
        const { app } = makeApp(db);
        const agent = await loggedInLandlord(app);
        const real = await csrfToken(agent);
        for (const bad of ["x".repeat(real.length), "", "short", real + "0", real.slice(0, -1)]) {
            const res = await form(agent, "post", "/newRoom", { ...newRoom, _csrf: bad });
            expect(res.status, `token "${bad.slice(0, 8)}..."`).toBe(403);
        }
    });

    it("refuses a token that belongs to someone else's session", async () => {
        const { app } = makeApp(db);
        const victim = await loggedInLandlord(app);
        const victimToken = await csrfToken(victim);

        const attacker = request.agent(app);
        await csrfToken(attacker); // the attacker has a session of their own...
        const res = await form(attacker, "post", "/login", { email: "x@y.co", password: "x", role: "renter", _csrf: victimToken });
        expect(res.status).toBe(403); // ...but the victim's token is not valid there
    });

    it("refuses a POST that has no session at all", async () => {
        const { app } = makeApp(db);
        const res = await request(app).post("/login").type("form").send({ _csrf: "abc", email: "a@b.co", password: "x", role: "renter" });
        expect(res.status).toBe(403);
    });
});

describe("CSRF: the token itself", () => {
    it("is long, random, and stays the same for the whole session", async () => {
        const { app } = makeApp(db);
        const agent = request.agent(app);
        const first = await csrfToken(agent);
        expect(first).toMatch(/^[0-9a-f]{64}$/);
        expect(await csrfToken(agent)).toBe(first);
        expect(await csrfToken(request.agent(app))).not.toBe(first);
    });

    it("changes when you sign in (new session)", async () => {
        await addLandlord(db, { email: "lana@example.com" });
        const { app } = makeApp(db);
        const agent = request.agent(app);
        const before = await csrfToken(agent);
        await login(agent, { email: "lana@example.com", role: "landlord" });
        expect(await csrfToken(agent)).not.toBe(before);
    });

    it("does not affect GET requests", async () => {
        const { app } = makeApp(db);
        expect((await request(app).get("/login")).status).toBe(200);
    });
});

describe("Content Security Policy", () => {
    it("sends a script policy with a fresh nonce and no unsafe-inline script permission", async () => {
        const { app } = makeApp(db);
        const first = await request(app).get("/login");
        const second = await request(app).get("/login");
        const policy = first.headers["content-security-policy"];
        const firstNonce = /nonce-([^';]+)/.exec(policy)?.[1];
        const secondNonce = /nonce-([^';]+)/.exec(second.headers["content-security-policy"])?.[1];

        expect(policy).toContain("script-src 'self'");
        expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
        expect(firstNonce).toBeTruthy();
        expect(secondNonce).toBeTruthy();
        expect(secondNonce).not.toBe(firstNonce);
    });

    it("puts the response nonce on inline scripts and removes inline event handlers", async () => {
        const { app } = makeApp(db);
        const anonymous = request.agent(app);
        const pages = [
            await anonymous.get("/register?role=renter"),
            await anonymous.get("/login"),
        ];
        await addLandlord(db, { email: "lana@example.com" });
        const landlord = request.agent(app);
        await login(landlord, { email: "lana@example.com", role: "landlord" });
        pages.push(await landlord.get("/dashboard"));
        pages.push(await landlord.get("/lease"));
        pages.push(await landlord.get("/payments"));
        const renter = request.agent(app);
        await addRenter(db, { email: "rita@example.com" });
        await login(renter, { email: "rita@example.com", role: "renter" });
        pages.push(await renter.get("/tDashboard"));

        let totalScripts = 0;
        for (const page of pages) {
            const nonce = /nonce-([^';]+)/.exec(page.headers["content-security-policy"])?.[1];
            const scripts = [...page.text.matchAll(/<script\b([^>]*)>/gi)];
            totalScripts += scripts.length;
            expect(scripts.every((script) => script[1].includes(`nonce="${nonce}"`))).toBe(true);
            expect(page.text).not.toMatch(/\son[a-z]+\s*=/i);
        }
        expect(totalScripts).toBeGreaterThan(0);
    });

    it("uses the request nonce for inline scripts in validation errors", async () => {
        const { app } = makeApp(db);
        const agent = request.agent(app);
        const res = await form(agent, "post", "/register", { role: "unknown" });
        const nonce = /nonce-([^';]+)/.exec(res.headers["content-security-policy"])?.[1];
        expect(res.status).toBe(400);
        expect(res.text).toContain(`<script nonce="${nonce}">`);
    });
});

describe("CSRF: every form in the app carries the token", () => {
    const count = (html, re) => (html.match(re) || []).length;

    async function pagesFor(app) {
        const pages = {};
        const anon = request.agent(app);
        for (const url of ["/login", "/register?role=landlord", "/register?role=renter"]) pages[url] = (await anon.get(url)).text;

        const landlord = await loggedInLandlord(app);
        for (const url of ["/dashboard", "/lease", "/contracts", "/payments", "/messages"]) pages[url] = (await landlord.get(url)).text;

        await addRenter(db, { email: "rita@example.com" });
        const renter = request.agent(app);
        await login(renter, { email: "rita@example.com", role: "renter" });
        pages["/tDashboard"] = (await renter.get("/tDashboard")).text;
        return pages;
    }

    it("has one hidden _csrf field per <form method=POST> on every page", async () => {
        const { app } = makeApp(db);
        const pages = await pagesFor(app);
        for (const [url, html] of Object.entries(pages)) {
            const postForms = count(html, /<form[^>]*method="POST"/gi);
            const tokens = count(html, /name="_csrf"/g);
            expect(tokens, `${url}: ${postForms} POST form(s) but ${tokens} token field(s)`).toBe(postForms);
        }
    });

    it("has a logout form (not a link) in the menus", async () => {
        const { app } = makeApp(db);
        const pages = await pagesFor(app);
        for (const url of ["/dashboard", "/lease", "/tDashboard"]) {
            expect(pages[url], url).toContain('action="/logout" method="POST"');
            expect(pages[url], url).not.toContain('href="/logout"');
        }
    });
});

describe("logout", () => {
    it("works with a token and no longer works as a link", async () => {
        const { app } = makeApp(db);
        const agent = await loggedInLandlord(app);

        expect((await agent.get("/logout")).status).toBe(404); // an <img src="/logout"> on another site does nothing
        expect((await agent.get("/dashboard")).status).toBe(200); // still signed in

        const res = await form(agent, "post", "/logout");
        expect(res.status).toBe(302);
        expect((await agent.get("/dashboard")).headers.location).toBe("/login");
    });
});
