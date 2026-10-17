import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
    addLandlord,
    addLease,
    addRenter,
    addRoom,
    createTestDb,
    form,
    login,
    makeApp,
} from "./helpers.js";

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
const count = async (table) => (await db.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n;

const LANDLORD_PAGES = ["/dashboard", "/lease", "/contracts", "/messages", "/payments", "/profile", "/account"];

describe("who can open what", () => {
    it.each(LANDLORD_PAGES)("renders %s for a logged-in landlord", async (page) => {
        await addLandlord(db, { email: "lana@example.com" });
        const { app } = makeApp(db);
        const agent = request.agent(app);
        await login(agent, { email: "lana@example.com", role: "landlord" });
        expect((await agent.get(page)).status).toBe(200);
    });

    it.each(["/", "/login", "/register?role=landlord", "/register?role=renter"])("renders the public page %s", async (page) => {
        const { app } = makeApp(db);
        expect((await request(app).get(page)).status).toBe(200);
    });

    it.each(LANDLORD_PAGES)("sends anonymous visitors from %s to /login", async (page) => {
        const { app } = makeApp(db);
        redirectsTo(await request(app).get(page), "/login");
    });

    it("answers anonymous API calls with 401", async () => {
        const { app } = makeApp(db);
        expect((await request(app).get("/api/available-rooms")).status).toBe(401);
        expect((await request(app).get("/api/renter-details/Rita%20Renter")).status).toBe(401);
    });

    it("lets anonymous visitors change nothing", async () => {
        const { app } = makeApp(db);
        redirectsTo(await form(request.agent(app), "post", "/newRoom", { newRoomName: "x" }), "/login");
        redirectsTo(await form(request.agent(app), "post", "/newRenter", { newRenterName: "x" }), "/login");
        expect(await count("rooms")).toBe(0);
    });

    it.each(LANDLORD_PAGES)("keeps a logged-in renter out of %s", async (page) => {
        await addRenter(db, { email: "rita@example.com" });
        const { app } = makeApp(db);
        const agent = request.agent(app);
        await login(agent, { email: "rita@example.com", role: "renter" });
        redirectsTo(await agent.get(page), "/tDashboard"); // bounced to their own home
    });

    it("keeps a landlord out of the renter dashboard", async () => {
        await addLandlord(db, { email: "lana@example.com" });
        const { app } = makeApp(db);
        const agent = request.agent(app);
        await login(agent, { email: "lana@example.com", role: "landlord" });
        redirectsTo(await agent.get("/tDashboard"), "/dashboard"); // bounced to their own home
    });
});

describe("a landlord only sees their own business", () => {
    it("counts only their own contracts and payments on the dashboard", async () => {
        const a = await addLandlord(db, { name: "Landlord A", email: "a@example.com" });
        const b = await addLandlord(db, { name: "Landlord B", email: "b@example.com" });
        const alice = await addRenter(db, { name: "Alice Tenant", email: "alice@example.com" });
        const bob = await addRenter(db, { name: "Bob Tenant", email: "bob@example.com" });
        await addLease(db, { renterId: alice, roomId: await addRoom(db, a, "A1"), value: 1200 });
        await addLease(db, { renterId: bob, roomId: await addRoom(db, b, "B1"), value: 3500 });

        const { app } = makeApp(db);
        const agent = request.agent(app);
        await login(agent, { email: "a@example.com", role: "landlord" });
        const page = (await agent.get("/dashboard")).text;

        expect(page).toContain("Alice Tenant");
        expect(page).not.toContain("Bob Tenant");
        expect(page).toMatch(/<span>\s*1200\s*<\/span>/);
        expect(page).not.toContain("3500");
        expect(page).not.toContain("4700");
    });

    it("lists only their own rooms and contracts on the lease page", async () => {
        const a = await addLandlord(db, { email: "a@example.com" });
        const b = await addLandlord(db, { email: "b@example.com" });
        await addRoom(db, a, "Alpha Room");
        await addRoom(db, b, "Bravo Room");

        const { app } = makeApp(db);
        const agent = request.agent(app);
        await login(agent, { email: "a@example.com", role: "landlord" });
        const page = (await agent.get("/lease")).text;
        expect(page).toContain("Alpha Room");
        expect(page).not.toContain("Bravo Room");
    });

    it("offers only their own free rooms through the API", async () => {
        const a = await addLandlord(db, { email: "a@example.com" });
        const b = await addLandlord(db, { email: "b@example.com" });
        await addRoom(db, a, "Alpha Room");
        await addRoom(db, b, "Bravo Room");

        const { app } = makeApp(db);
        const agent = request.agent(app);
        await login(agent, { email: "a@example.com", role: "landlord" });
        const rooms = (await agent.get("/api/available-rooms")).body;
        expect(rooms.map((r) => r.title)).toEqual(["Alpha Room"]);
    });
});

describe("renter discoverability and consent", () => {
    it("keeps non-consenting renters out of the directory and details API", async () => {
        await addLandlord(db, { email: "a@example.com" });
        await addRenter(db, { name: "Private Renter", email: "private@example.com" });
        const { app } = makeApp(db);
        const agent = await request.agent(app);
        await login(agent, { email: "a@example.com", role: "landlord" });

        const leasePage = await agent.get("/lease");
        expect(leasePage.text).not.toContain("Private Renter");
        expect((await agent.get("/api/renter-details/Private%20Renter")).status).toBe(404);
    });

    it("shows only renters who opted in and exposes only their consented discovery fields", async () => {
        await addLandlord(db, { email: "a@example.com" });
        await addRenter(db, { name: "Public Renter", email: "public@example.com", discoverable: true });
        await addRenter(db, { name: "Private Renter", email: "private@example.com" });
        const { app } = makeApp(db);
        const agent = await request.agent(app);
        await login(agent, { email: "a@example.com", role: "landlord" });

        const leasePage = await agent.get("/lease");
        expect(leasePage.text).toContain("Public Renter");
        expect(leasePage.text).toContain("900");
        expect(leasePage.text).not.toContain("Private Renter");
        expect((await agent.get("/api/renter-details/Public%20Renter")).body).toEqual({
            budget: "900.00",
            activity_desc: "a bakery",
        });
        expect((await agent.get("/api/renter-details/Private%20Renter")).status).toBe(404);
    });

    it("does not allow landlords to assign a renter who did not opt in", async () => {
        const landlordId = await addLandlord(db, { email: "a@example.com" });
        await addRoom(db, landlordId, "Suite 1");
        await addRenter(db, { email: "private@example.com" });
        const { app } = makeApp(db);
        const landlord = request.agent(app);
        await login(landlord, { email: "a@example.com", role: "landlord" });

        const res = await form(landlord, "post", "/newRenter", {
            newRenterName: "Rita Renter",
            newRenterRoom: "Suite 1",
            newRenterActivity: "bakery",
            newRenterValue: "900",
            newRenterContractS: "2026-01-01",
            newRenterContractE: "2027-01-01",
        });
        expect(res.text).toContain("has not opted into discovery");
        expect((await db.query("SELECT COUNT(*)::int AS n FROM renters_rooms")).rows[0].n).toBe(0);
        expect((await db.query("SELECT is_available FROM rooms")).rows[0].is_available).toBe(true);
    });

    it("lets renters withdraw discovery consent through a CSRF-protected setting", async () => {
        await addRenter(db, { email: "rita@example.com", discoverable: true });
        const { app } = makeApp(db);
        const renter = request.agent(app);
        await login(renter, { email: "rita@example.com", role: "renter" });

        expect((await renter.get("/tDashboard")).text).toContain("checked");
        redirectsTo(await form(renter, "post", "/renter/discoverability", {}), "/tDashboard");
        expect((await db.query("SELECT discoverable FROM renters")).rows[0].discoverable).toBe(false);

        await addLandlord(db, { email: "a@example.com" });
        const landlord = request.agent(app);
        await login(landlord, { email: "a@example.com", role: "landlord" });
        expect((await landlord.get("/api/renter-details/Rita%20Renter")).status).toBe(404);
    });
});

describe("POST /newRenter (assigning a renter to a room)", () => {
    const lease = (agent, overrides = {}) =>
        form(agent, "post", "/newRenter", {
            newRenterName: "Rita Renter",
            newRenterRoom: "Suite 1",
            newRenterActivity: "bakery",
            newRenterValue: "1200",
            newRenterContractS: "2026-01-01",
            newRenterContractE: "2027-01-01",
            ...overrides,
        });

    const loginAs = async (app, email) => {
        const agent = request.agent(app);
        await login(agent, { email, role: "landlord" });
        return agent;
    };

    it("creates the lease and marks the room occupied", async () => {
        const a = await addLandlord(db, { email: "a@example.com" });
        const roomId = await addRoom(db, a, "Suite 1");
        const renterId = await addRenter(db, { email: "rita@example.com", discoverable: true });
        const { app } = makeApp(db);

        redirectsTo(await lease(await loginAs(app, "a@example.com")), "/lease");

        const room = (await db.query("SELECT is_available, renter_id FROM rooms WHERE id = $1", [roomId])).rows[0];
        expect(room).toEqual({ is_available: false, renter_id: renterId });
        expect(await count("renters_rooms")).toBe(1);
    });

    it("uses the logged-in landlord's room when two landlords both have a 'Suite 1'", async () => {
        const a = await addLandlord(db, { email: "a@example.com" });
        const b = await addLandlord(db, { email: "b@example.com" });
        const roomA = await addRoom(db, a, "Suite 1");
        const roomB = await addRoom(db, b, "Suite 1");
        await addRenter(db, { email: "rita@example.com", discoverable: true });
        const { app } = makeApp(db);

        redirectsTo(await lease(await loginAs(app, "b@example.com")), "/lease"); // B is the second landlord

        const rooms = (await db.query("SELECT id, is_available FROM rooms ORDER BY id")).rows;
        expect(rooms.find((r) => r.id === roomA).is_available).toBe(true); // A's room untouched
        expect(rooms.find((r) => r.id === roomB).is_available).toBe(false);
    });

    it("refuses to use another landlord's room", async () => {
        const a = await addLandlord(db, { email: "a@example.com" });
        const b = await addLandlord(db, { email: "b@example.com" });
        await addRoom(db, a, "Suite 1");
        const bsRoom = await addRoom(db, b, "Suite 9");
        await addRenter(db, { email: "rita@example.com", discoverable: true });
        const { app } = makeApp(db);

        const res = await lease(await loginAs(app, "a@example.com"), { newRenterRoom: "Suite 9" });
        expect(res.text).toContain("Room not found");
        expect(await count("renters_rooms")).toBe(0);
        const room = (await db.query("SELECT is_available FROM rooms WHERE id = $1", [bsRoom])).rows[0];
        expect(room.is_available).toBe(true);
    });

    it("refuses to double-book a room", async () => {
        const a = await addLandlord(db, { email: "a@example.com" });
        await addRoom(db, a, "Suite 1");
        await addRenter(db, { name: "Rita Renter", email: "rita@example.com", discoverable: true });
        await addRenter(db, { name: "Remy Renter", email: "remy@example.com", discoverable: true });
        const { app } = makeApp(db);
        const agent = await loginAs(app, "a@example.com");

        redirectsTo(await lease(agent), "/lease");
        const second = await lease(agent, { newRenterName: "Remy Renter" });
        expect(second.text).toContain("already occupied");
        expect(await count("renters_rooms")).toBe(1);
    });

    it("refuses when two renters share the chosen name", async () => {
        const a = await addLandlord(db, { email: "a@example.com" });
        const room = await addRoom(db, a, "Suite 1");
        await addRenter(db, { name: "Sam Smith", email: "sam1@example.com", discoverable: true });
        await addRenter(db, { name: "Sam Smith", email: "sam2@example.com", discoverable: true });
        const { app } = makeApp(db);

        const res = await lease(await loginAs(app, "a@example.com"), { newRenterName: "Sam Smith" });
        expect(res.text).toContain("More than one renter");
        expect(await count("renters_rooms")).toBe(0);
        expect((await db.query("SELECT is_available FROM rooms WHERE id = $1", [room])).rows[0].is_available).toBe(true);
    });

    it("undoes everything if the second write fails (all-or-nothing)", async () => {
        const a = await addLandlord(db, { email: "a@example.com" });
        const room = await addRoom(db, a, "Suite 1");
        await addRenter(db, { email: "rita@example.com", discoverable: true });
        // A database whose lease INSERT blows up, to prove the room is released again.
        const flaky = {
            ...db,
            connect: async () => ({
                query: (text, params) =>
                    text.includes("INSERT INTO renters_rooms") ? Promise.reject(new Error("boom")) : db.query(text, params),
                release() {},
            }),
        };
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        const { app } = makeApp(flaky);

        const res = await lease(await loginAs(app, "a@example.com"));
        expect(res.status).toBe(500);
        expect((await db.query("SELECT is_available, renter_id FROM rooms WHERE id = $1", [room])).rows[0]).toEqual({
            is_available: true,
            renter_id: null,
        });
        quiet.mockRestore();
    });

    it.each([
        ["a contract that ends before it starts", { newRenterContractS: "2027-01-01", newRenterContractE: "2026-01-01" }],
        ["a negative rent", { newRenterValue: "-5" }],
        ["a rent that is not a number", { newRenterValue: "lots" }],
        ["an impossible date", { newRenterContractS: "2026-02-30" }],
    ])("answers 400 for %s", async (_label, overrides) => {
        const a = await addLandlord(db, { email: "a@example.com" });
        await addRoom(db, a, "Suite 1");
        await addRenter(db, { email: "rita@example.com", discoverable: true });
        const { app } = makeApp(db);

        const res = await lease(await loginAs(app, "a@example.com"), overrides);
        expect(res.status).toBe(400);
        expect(await count("renters_rooms")).toBe(0);
    });
});

describe("POST /newRoom", () => {
    const room = (agent, overrides = {}) =>
        form(agent, "post", "/newRoom", {
            newRoomName: "Suite 1",
            newPropertyDetails: "Corner unit",
            roomType: "commercial",
            newRoomValue: "1500",
            ...overrides,
        });

    const loginAs = async (app, email) => {
        const agent = request.agent(app);
        await login(agent, { email, role: "landlord" });
        return agent;
    };

    it("adds a room owned by the logged-in landlord", async () => {
        const a = await addLandlord(db, { email: "a@example.com" });
        const { app } = makeApp(db);
        redirectsTo(await room(await loginAs(app, "a@example.com")), "/lease");
        const rows = (await db.query("SELECT landlord_id, title FROM rooms")).rows;
        expect(rows).toEqual([{ landlord_id: a, title: "Suite 1" }]);
    });

    it("enforces the room limit", async () => {
        await addLandlord(db, { email: "a@example.com", rooms_owned: 1 });
        const { app } = makeApp(db);
        const agent = await loginAs(app, "a@example.com");
        await room(agent);
        const second = await room(agent, { newRoomName: "Suite 2" });
        expect(second.text).toContain("room limit");
        expect(await count("rooms")).toBe(1);
    });

    it("refuses a second room with the same name (ignoring letter case)", async () => {
        await addLandlord(db, { email: "a@example.com" });
        const { app } = makeApp(db);
        const agent = await loginAs(app, "a@example.com");
        await room(agent);
        const dup = await room(agent, { newRoomName: "SUITE 1" });
        expect(dup.text).toContain("already have a room");
        expect(await count("rooms")).toBe(1);
    });

    it("is backed by a database rule, not just the check in the route", async () => {
        const a = await addLandlord(db, { email: "a@example.com" });
        await addRoom(db, a, "Suite 1");
        await expect(addRoom(db, a, "suite 1")).rejects.toThrow(/unique/i);
        const b = await addLandlord(db, { email: "b@example.com" });
        await expect(addRoom(db, b, "Suite 1")).resolves.toBeTypeOf("number"); // another landlord may reuse the name
    });

    it("answers 400 for bad input", async () => {
        await addLandlord(db, { email: "a@example.com" });
        const { app } = makeApp(db);
        const agent = await loginAs(app, "a@example.com");
        expect((await room(agent, { newRoomValue: "-1" })).status).toBe(400);
        expect((await room(agent, { roomType: "castle" })).status).toBe(400);
        expect((await room(agent, { newRoomName: "   " })).status).toBe(400);
        expect(await count("rooms")).toBe(0);
    });
});

describe("GET /api/renter-details/:name", () => {
    it("returns details for a unique name, 404 for unknown, 409 for duplicates", async () => {
        await addLandlord(db, { email: "a@example.com" });
        await addRenter(db, { name: "Rita Renter", email: "rita@example.com", discoverable: true });
        await addRenter(db, { name: "Sam Smith", email: "sam1@example.com", discoverable: true });
        await addRenter(db, { name: "Sam Smith", email: "sam2@example.com", discoverable: true });
        const { app } = makeApp(db);
        const agent = request.agent(app);
        await login(agent, { email: "a@example.com", role: "landlord" });

        const ok = await agent.get("/api/renter-details/Rita%20Renter");
        expect(ok.status).toBe(200);
        expect(ok.body.activity_desc).toBe("a bakery");
        expect((await agent.get("/api/renter-details/Nobody")).status).toBe(404);
        expect((await agent.get("/api/renter-details/Sam%20Smith")).status).toBe(409);
    });
});
