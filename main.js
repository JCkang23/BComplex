import bcrypt from "bcrypt";
import bodyParser from "body-parser";
import env from "dotenv";
import express from "express";
import session from "express-session";
import passport from "passport";
import { Strategy } from "passport-local";
import pg from "pg";

const app = express();
const port = 4000;
const saltRounds = 10;
env.config();

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: true,
        cookie: {
            maxAge: 1000 * 60 * 60,
        }
    })
);

app.use(passport.initialize());
app.use(passport.session());

const db = new pg.Client({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DB2,
    password: process.env.PG_PSWD,
    port: process.env.PG_PORT,
});

db.connect();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.get('/', (req, res) => { res.render("credential.ejs"); });
app.get('/register', (req, res) =>{
    const role = req.query.role;
    res.render("register.ejs", {
        landlord: role === "landlord",
        renter: role === "renter",
    });
});
app.get('/login', (req, res) => { res.render("login.ejs"); });

app.get('/profile', (req, res) => { res.render("landlord/profile.ejs"); });
app.get('/account', (req, res) => { res.render("landlord/profile.ejs"); });
app.get("/logout", (req, res) => {
    req.logout(function (err) {
        if (err) {
            return next(err);
        }
        return res.redirect("/");
    });
});

app.get('/dashboard', async (req, res) => {
    if (!req.isAuthenticated() || !req.user || req.user.role !== "landlord") {
        return res.redirect('/login');
    }
    try {
        const landlordId = req.user.id;
        const rooms = await db.query(
            "SELECT title, room_details, room_type, room_price, is_available FROM rooms WHERE landlord_id = $1",
            [landlordId]
        );
        const tenants = await db.query(
            "SELECT full_name, preference, budget, activity_desc FROM renters",
        );
        const rentersRooms = await db.query(
            "SELECT renter_id, room_id, renter_details, renter_value, renter_contract_start, renter_contract_end FROM renters_rooms",
        );

        // Dummy contracts array
        const contracts = rentersRooms.rows.map(r => {
            const endDate = new Date(r.renter_contract_end);
            const now = new Date();
            return {
                avatar: '/images/images/wow.JPG',
                room_id: r.room_id,
                tenant_name: r.renter_id || 'Tenant',
                start_date: r.renter_contract_start,
                end_date: r.renter_contract_end,
                status: endDate >= now ? 'Active' : 'Expired'
            };
        });

        // Count only active tenants with contracts
        const tenantsCount = contracts.filter(c => c.status === 'Active').length;

        // Dummy totalPayments for now (sum of all renter_value in rentersRooms)
        let totalPayments = 0;
        if (rentersRooms.rows.length > 0) {
            totalPayments = rentersRooms.rows.reduce((sum, r) => sum + Number(r.renter_value || 0), 0);
        }

        // Dummy payments array (map rentersRooms to payment objects)
        const payments = rentersRooms.rows.map(r => ({
            amount: r.renter_value,
            room_id: r.room_id,
            date: r.renter_contract_end,
        }));
        
        res.render("landlord/dashboard.ejs" , {
            landlordName: req.user.full_name,
            roomsTable: rooms.rows,
            tenantsTable: tenants.rows,
            renterRoomsTable: rentersRooms.rows,
            tenantsCount,
            totalPayments,
            contracts,
            payments
        });
    } catch (err) {
        console.error("Error fetching rooms:", err);
        res.render("landlord/dashboard.ejs", {
            landlordName: req.user ? req.user.full_name : "Landlord",
            roomsTable: [],
            tenantsTable: [],
            renterRoomsTable: [],
            tenantsCount: 0,
            totalPayments: 0,
            contracts: [],
            payments: []
        });
    }
});

app.get('/lease', async (req, res) => {
    if (!req.isAuthenticated() || !req.user || req.user.role !== "landlord") {
        return res.redirect('/login');
    }
    try {
        const landlordId = req.user.id;
        const roomsCheck = await db.query(
            "SELECT * FROM rooms WHERE landlord_id = $1",
            [landlordId]
        );
        // Fetch renters for these rooms
        const rentersRoomsCheck = await db.query(
            `SELECT rr.*, r.full_name AS renter_name
             FROM renters_rooms rr
             JOIN renters r ON rr.renter_id = r.id
             JOIN rooms ro ON rr.room_id = ro.id
             WHERE ro.landlord_id = $1`,
            [landlordId]
        );
        const existingRenters = await db.query(
            "SELECT full_name, preference, budget, activity_desc FROM renters"
        );
        const roomsTable = roomsCheck.rows;
        const renterRoomsTable = rentersRoomsCheck.rows;
        const tenantsTable = existingRenters.rows;
        res.render('landlord/lease.ejs', { renterRoomsTable, roomsTable, tenantsTable });
    } catch (err) {
        console.error("Error fetching lease data:", err);
        res.render('landlord/lease.ejs', { renterRoomsTable: [], roomsTable: [], tenantsTable: [] });
    }
});

// API route to get available rooms for modal dropdown
app.get('/api/available-rooms', async (req, res) => {
    if (!req.isAuthenticated() || !req.user || req.user.role !== "landlord") {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const landlordId = req.user.id;
        const availableRooms = await db.query(
            "SELECT id, title, room_price FROM rooms WHERE landlord_id = $1 AND is_available = TRUE",
            [landlordId]
        );
        res.json(availableRooms.rows);
    } catch (err) {
        console.error("Error fetching available rooms:", err);
        res.status(500).json({ error: 'Failed to fetch available rooms' });
    }
});

// API route to get renter details when selected
app.get('/api/renter-details/:renterName', async (req, res) => {
    if (!req.isAuthenticated() || !req.user || req.user.role !== "landlord") {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const renterName = req.params.renterName;
        const renterDetails = await db.query(
            "SELECT budget, activity_desc FROM renters WHERE full_name = $1",
            [renterName]
        );
        if (renterDetails.rows.length > 0) {
            res.json(renterDetails.rows[0]);
        } else {
            res.status(404).json({ error: 'Renter not found' });
        }
    } catch (err) {
        console.error("Error fetching renter details:", err);
        res.status(500).json({ error: 'Failed to fetch renter details' });
    }
});

app.get('/contracts', async (req, res) => {
    if (!req.isAuthenticated() || !req.user || req.user.role !== "landlord") {
        return res.redirect('/login');
    }
    const tenants = [
    {
        name: "Emily Johnson",
        period: "Jan. 2023 → Feb. 2024",
        status: "Active",
        photo: ""
    },
    {
        name: "Michael Brown",
        period: "Sep. 2025 → Jun. 14, 2024",
        status: "Paid",
        photo: ""
    },
    {
        name: "Samantha Lee",
        period: "Apr. 2023 → Aug. 2024",
        status: "Ended",
        photo: ""
    },
    ];
    res.render('landlord/contracts.ejs', { tenants });
});

app.get('/messages', async (req, res) => {
    if (!req.isAuthenticated() || !req.user || req.user.role !== "landlord") {
        return res.redirect('/login');
    }
    const tenants = [
        { name: 'Emily Johnson', agent: 'Alex Smith' },
        { name: 'Michael Brown', agent: 'Alex Smith' },
        { name: 'Sarah Davis', agent: 'Anna Lee' }
    ];
    const messages = [
        { from: 'tenant', text: 'Hello, I have a question about the lease agreement.', avatar: '/images/emily.jpg' },
        { from: 'agent', text: 'Sure. I’d be happy to help. What do you need to know?', avatar: '/images/alex.jpg' },
        { from: 'tenant', text: 'I was wondering about the renewal options.', avatar: '/images/emily.jpg' },
        { from: 'agent', text: 'I can provide details about the renewal terms.', avatar: '/images/alex.jpg' }
    ];
    res.render("landlord/messages.ejs", {
    tenants, messages, selectedTenant: 'Emily Johnson'});
});

app.get('/payments', async (req, res) => {
    if (!req.isAuthenticated() || !req.user || req.user.role !== "landlord") {
        return res.redirect('/login');
    }
    const payments = [
        {
        tenant: 'Michael Brown',
        amount: 1200,
        date: 'Mar. 1',
        photo: ''
        },
        {
        tenant: 'Sara Davis',
        amount: 1300,
        date: 'Feb. 26',
        photo: ''
        },
        {
        tenant: 'Emily Johnson',
        amount: 1250,
        date: 'Feb. 25',
        photo: ''
        },
        {
        tenant: 'Sara Davis',
        amount: 1300,
        date: 'Jan. 28',
        photo: ''
        },
        {
        tenant: 'Michael Brown',
        amount: 1200,
        date: 'Jan. 4',
        photo: ''
        }
    ];
    res.render("landlord/payments.ejs", { payments });
});

app.post('/register', async (req, res) =>{
    const userName = req.body.full_name;
    const userEmail = req.body.email;
    const userPswrd = req.body.password_hash;
    const func = req.body.role;
    const roomsOwned = req.body.rooms_owned;
    const lookingFor = req.body.looking_for;
    const budget = req.body.amount;
    const desc = req.body.desc;

    try {
        const checkResult1 = await db.query(
            "SELECT * FROM landlords WHERE email = $1",
            [userEmail],
            );
        const checkResult2 = await db.query(
            "SELECT * FROM renters WHERE email = $1",
            [userEmail],
        );

        if (checkResult1.rows.length > 0 || checkResult2.rows.length > 0){
            console.log("User already exists. Try loggin in instead!");
            res.send(`<script>alert("User already exists. Try loggin in instead!");
                window.location.href = '/login';
                </script>`);
            return;
        }

        if (func === "landlord"){
            bcrypt.hash(userPswrd, saltRounds, async (err, hash) =>{
                if (err){
                    console.log("Error hashing the password:", err);
                    return res.status(500).send("Error processing the registration. Please try again later.");
                }
                try {
                    const insertResult = await db.query(
                        "INSERT INTO landlords (full_name, email, password_hash, rooms_owned) VALUES ($1, $2, $3, $4) RETURNING *",
                        [userName, userEmail, hash, roomsOwned]
                    );
                    const newUser = insertResult.rows[0];
                    newUser.role = "landlord";
                    // Log in new user using session
                    req.login(newUser, async (err) => {
                        if (err) {
                            console.log("Login error after registration:", err);
                            return res.redirect('/login');
                        }
                        // Fetch rooms data for the landlord dashboard
                        const rooms = await db.query(
                            "SELECT title, room_details, room_type, room_price, is_available FROM rooms WHERE landlord_id = $1",
                            [newUser.id]
                        );
                        const tenants = await db.query(
                            "SELECT full_name, preference, budget, activity_desc FROM renters"
                        );
                        const rentersRooms = await db.query(
                            "SELECT renter_id, room_id, renter_details, renter_value, renter_contract_start, renter_contract_end FROM renters_rooms"
                        );

                        const contracts = rentersRooms.rows.map(r => {
                            const endDate = new Date(r.renter_contract_end);
                            const now = new Date();
                            return {
                                avatar: '/images/images/wow.JPG',
                                room_id: r.room_id,
                                tenant_name: r.renter_id || 'Tenant',
                                start_date: r.renter_contract_start,
                                end_date: r.renter_contract_end,
                                status: endDate >= now ? 'Active' : 'Expired'
                            };
                        });

                        const tenantsCount = contracts.filter(c => c.status === 'Active').length;

                        let totalPayments = 0;
                        if (rentersRooms.rows.length > 0) {
                            totalPayments = rentersRooms.rows.reduce((sum, r) => sum + Number(r.renter_value || 0), 0);
                        }

                        const payments = rentersRooms.rows.map(r => ({
                            amount: r.renter_value,
                            room_id: r.room_id,
                            date: r.renter_contract_end,
                        }));

                        res.render("landlord/dashboard.ejs", {
                            landlordName: newUser.full_name,
                            roomsTable: rooms.rows,
                            tenantsTable: tenants.rows,
                            renterRoomsTable: rentersRooms.rows,
                            tenantsCount,
                            totalPayments,
                            contracts,
                            payments
                        });
                    });
                } catch (err) {
                    console.log("User already exists...");
                        res.send(`<script>
                            alert("User already exists. Try logging in instead!");
                            window.location.href = '/login';
                            </script>`);
                        return;
                }
            });
        } else if (func === "renter"){
            bcrypt.hash(userPswrd, saltRounds, async(err, hash) =>{
                if (err) {
                    console.log("Error Hashing the Password:", err);
                    return res.status(500).send("Error processing the registration. Please try again later.");
                }
                try {
                    const insertResult = await db.query(
                        "INSERT INTO renters (full_name, email, password_hash, preference, budget, activity_desc) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
                        [userName, userEmail, hash, lookingFor, budget, desc]
                    );
                    const newUser = insertResult.rows[0];
                    newUser.role = "renter";

                    req.login(newUser, (err) => {
                        if (err) {
                            console.log("Login error after registration:", err);
                            return res.redirect('/login');
                        }
                        res.render("tenant/tDashboard.ejs", { renterName: newUser.full_name });
                    });
                } catch (err) {
                    console.log("User already exists!");
                        res.send(`<script>
                            alert("User already exists. Try logging in instead!");
                            window.location.href = '/login';
                            </script>`);
                        return;
                }
            });
        }
    } catch (err) {
        console.log(err);
        res.status(500).send("Server error! Try again later ...");
        return;
    }
});

app.post('/login', (req, res, next) =>{
    passport.use(
        new Strategy(
            { usernameField: 'email', passwordField: 'password_hash', passReqToCallback: true},
            async function identification(req, email, password_hash, cb) {
                const func = req.body.role;
            try{
                const checkLandlords = await db.query(
                    "SELECT * FROM landlords WHERE (email) = ($1)",
                    [email],
                );
                const checkRenters = await db.query(
                    "SELECT * FROM renters WHERE (email) = ($1)",
                    [email],
                );

                if (checkLandlords.rows.length > 0 || checkRenters.rows.length > 0){
                    // console.log(checkLandlords); console.log(checkRenters);
                    const user = checkLandlords.rows[0] || checkRenters.rows[0];
                    const storedPassword = user.password_hash;
                    bcrypt.compare(password_hash, storedPassword, async (err, passwordMatches) =>{
                        if (err){
                            return cb(err);
                        } else if (passwordMatches) {
                            user.role = func;
                            return cb(null, user);
                        } else {
                            return cb(null, false, { message: "Incorrect password" });
                        }
                    });
                } else {
                    return cb(null, false, { message: "User not found" });
                }
            } catch (err){
                return cb(err);
            }
        })
    );
    passport.authenticate('local', (err, user, info) => {
        if (err) { return next(err); }
        if (!user) {
            return res.send(`<script>
                alert("User not found or incorrect credentials! Please, try again...");
                window.location.href = '/login';
                </script>`);
        }
        req.logIn(user, async function(err) {
            if (err) { return next(err); }
            if (user.role === "landlord") {
                // Fetch data for the display
                const rooms = await db.query(
                    "SELECT title, room_details, room_type, room_price, is_available FROM rooms WHERE landlord_id = $1",
                    [user.id]
                );
                const tenants = await db.query(
                    "SELECT full_name, preference, budget, activity_desc FROM renters"
                );
                const rentersRooms = await db.query(
                    "SELECT renter_id, room_id, renter_details, renter_value, renter_contract_start, renter_contract_end FROM renters_rooms"
                );
                
                const contracts = rentersRooms.rows.map(r => {
                    const endDate = new Date(r.renter_contract_end);
                    const now = new Date();
                    return {
                        avatar: '/images/images/wow.JPG',
                        room_id: r.room_id,
                        tenant_name: r.renter_id || 'Tenant',
                        start_date: r.renter_contract_start,
                        end_date: r.renter_contract_end,
                        status: endDate >= now ? 'Active' : 'Expired'
                    };
                });
                
                const tenantsCount = contracts.filter(c => c.status === 'Active').length;
                
                let totalPayments = 0;
                if (rentersRooms.rows.length > 0) {
                    totalPayments = rentersRooms.rows.reduce((sum, r) => sum + Number(r.renter_value || 0), 0);
                }
                
                const payments = rentersRooms.rows.map(r => ({
                    amount: r.renter_value,
                    room_id: r.room_id,
                    date: r.renter_contract_end,
                }));

                return res.render("landlord/dashboard.ejs", {
                    landlordName: user.full_name,
                    roomsTable: rooms.rows,
                    tenantsTable: tenants.rows,
                    renterRoomsTable: rentersRooms.rows,
                    tenantsCount,
                    totalPayments,
                    contracts,
                    payments
                });
            } else if (user.role === "renter") {
                return res.render("tenant/tDashboard.ejs", { renterName: user.full_name });
            } else {
                return res.redirect('/login');
            }
        });
    })(req, res, next);
});

app.post('/newRenter', async (req, res) =>{
    if (!req.isAuthenticated() || !req.user || req.user.role !== "landlord") {
        return res.redirect('/login');
    }
    try {
        const {
            newRenterName,
            newRenterActivity,
            newRenterRoom,
            newRenterValue,
            newRenterContractS,
            newRenterContractE
        } = req.body;

        // Find the renter by name
        const renter = await db.query(
            "SELECT id FROM renters WHERE full_name = $1",
            [newRenterName]
        );
        if (!renter.rows.length) {
            return res.send(`<script>alert("Renter not found!"); window.location.href = '/lease';</script>`);
        }
        const renterId = renter.rows[0].id;

        // Check for existing and room availability
        const roomCheck = await db.query(
            "SELECT id, is_available FROM rooms WHERE title = $1",
            [newRenterRoom]
        );
        if (!roomCheck.rows.length) {
            return res.send(`<script>alert("Room does not exist!"); window.location.href = '/lease';</script>`);
        }
        const room = roomCheck.rows[0];
        if (!room.is_available) {
            return res.send(`<script>alert("This room is already occupied! Please choose another room."); window.location.href = '/lease';</script>`);
        }
        const roomId = room.id;
        
        // Insert data into renters_rooms table
        await db.query(
            "INSERT INTO renters_rooms (renter_id, room_id, renter_details, renter_value, renter_contract_start, renter_contract_end) VALUES ($1, $2, $3, $4, $5, $6)",
            [renterId, roomId, newRenterActivity, newRenterValue, newRenterContractS, newRenterContractE]
        );
        // Update room availability
        await db.query(
            "UPDATE rooms SET is_available = FALSE, renter_id = $1 WHERE id = $2",
            [renterId, roomId]
        );
        res.redirect('/lease');
    } catch (err) {
        console.error("Error inserting new renter:", err);
        return res.status(500).send("Error adding new renter. Please try again later.");
    }
});

app.post('/newRoom', async(req, res)=>{
    if (!req.isAuthenticated() || !req.user || req.user.role !== "landlord") {
        return res.redirect('/login');
    }
    const roomName = req.body.newRoomName;
    const roomDetails = req.body.newPropertyDetails;
    const roomType = req.body.roomType;
    const roomValue = req.body.newRoomValue;
    const landlordId = req.user.id;

    try {
        // Get the allowed room count
        const landlordResult = await db.query(
            "SELECT rooms_owned FROM landlords WHERE id = $1",
            [landlordId]
        );
        const allowedRooms = landlordResult.rows[0].rooms_owned;

        // Get the current number of rooms added
        const roomsResult = await db.query(
            "SELECT COUNT(*) FROM rooms WHERE landlord_id = $1",
            [landlordId]
        );
        const currentRooms = parseInt(roomsResult.rows[0].count, 10);

        // Check limit
        if (currentRooms >= allowedRooms) {
            return res.send(`<script>
                alert("You have reached your room limit (${allowedRooms}).");
                window.location.href = '/lease';
            </script>`);
        }
        
        // Add room as usual if limit is not reached
        await db.query(
            "INSERT INTO rooms (title, room_details, room_type, room_price, landlord_id) VALUES ($1, $2, $3, $4, $5)",
            [roomName, roomDetails, roomType, roomValue, landlordId]
        );

        res.redirect('/lease');
        return;

    } catch (err) {
        console.error("Error adding new room:", err);
        return res.status(500).send("Error adding new room. Please try again later.");
    }
});

passport.serializeUser((user, cb) =>{ cb(null, user); });
passport.deserializeUser((user, cb) =>{ cb(null, user); });

app.listen(port, ()=>{
    console.log(`Server running on http://localhost:${port}`);
});