import bcrypt from "bcrypt";
import bodyParser from "body-parser";
import env from "dotenv";
import express from "express";
import session from "express-session";
import passport from "passport";
import { Strategy } from "passport-local";
import pg from "pg";

const app = express();
const port = 3000;
const saltRounds = 10;
env.config();

// Session
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
    database: process.env.PG_DB,
    password: process.env.PG_PSWD,
    port: process.env.PG_PORT,
});

db.connect();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.get('/', (req, res) =>{
    res.render("credential.ejs");
});

app.get('/register', (req, res) =>{
    const role = req.query.role;
    res.render("register.ejs", {
        landlord: role === "landlord",
        renter: role === "renter",
    });
});

app.get('/login', (req, res) =>{
    res.render("login.ejs");
});

app.get("/logout", (req, res) => {
    req.logout(function (err) {
        if (err) {
            return next(err);
        }
        res.redirect("/");
    });
});

app.get('/landlord', async (req, res) => {
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

        // Redesigned dashboard
        const tenantsCount = tenants.rows.length;
        // TotalPayments for now
        let totalPayments = 0;
        if (rentersRooms.rows.length > 0) {
            totalPayments = rentersRooms.rows.reduce((sum, r) => sum + Number(r.renter_value || 0), 0);
        }
        // Contracts array
        const contracts = rentersRooms.rows.map(r => ({
            avatar: '',
            room_id: r.room_id,
            tenant_name: r.renter_details || 'Tenant',
            start_date: r.renter_contract_start,
            end_date: r.renter_contract_end,
            status: 'Active'
        }));
        // Payments array (map rentersRooms to payment objects)
        const payments = rentersRooms.rows.map(r => ({
            amount: r.renter_value,
            room_id: r.room_id,
            date: r.renter_contract_end, // Use contract end as payment date for now
        }));

        res.render("landlord.ejs", {
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
        res.render("landlord.ejs", {
            landlordName: "Landlord",
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



app.post('/newRenter', async (req, res) =>{
    const renterName = req.body.newRenterName;
    const renterRoom = req.body.newRenterRoom;
    const renterDetails = req.body.newRenterDetails;
    const renterValue = req.body.newRenterValue;
    const renterContractS = req.body.newRenterContractS;
    const renterContractE = req.body.newRenterContractE;

    try {
        // Check renter by name
        const renterResult = await db.query(
            "SELECT id FROM renters WHERE full_name = $1",
            [renterName]
        );
        if (renterResult.rows.length === 0) {
            console.log("Renter does not exist on this platform! Please, ask them to register...");
            res.redirect('/landlord');
            return;
        }
        const renterId = renterResult.rows[0].id;
        
        // Check room by title
        const roomResult = await db.query(
            "SELECT id FROM rooms WHERE title = $1",
            [renterRoom]
        );
        if (roomResult.rows.length === 0) {
            console.log("Room does not exist! Please, try again...");
            res.redirect('/landlord');
            return;
        }
        const roomId = roomResult.rows[0].id;
        
        // Insert renter
        await db.query(
            "INSERT INTO renters_rooms (renter_id, room_id, renter_details, renter_value, renter_contract_start, renter_contract_end) VALUES ($1, $2, $3, $4, $5, $6)",
            [renterId, roomId, renterDetails, renterValue, renterContractS, renterContractE]
        );
        // Update room availability
        await db.query(
            "UPDATE rooms SET is_available = FALSE, renter_id = $1 WHERE id = $2",
            [renterId, roomId]
        );
        res.redirect('/landlord');
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
        await db.query(
            "INSERT INTO rooms (title, room_details, room_type, room_price, landlord_id) VALUES ($1, $2, $3, $4, $5)",
            [roomName, roomDetails, roomType, roomValue, landlordId]
        );
        res.redirect('/landlord');
    } catch (err) {
        console.error("Error adding new room:", err);
        res.status(500).send("Error adding new room. Please try again later.");
    }
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

                    // Log in
                    req.login(newUser, async (err) => {
                        if (err) {
                            console.log("Login error after registration:", err);
                            return res.redirect('/login');
                        }
                        // Fetching rooms data for the landlord dashboard
                        const rooms = await db.query(
                            "SELECT title, room_details, room_type, room_price, is_available FROM rooms WHERE landlord_id = $1",
                            [newUser.id]
                        );
                        const tenants = await db.query(
                            "SELECT full_name, preference, budget, activity_desc FROM renters"
                        );
                        const renterRooms = await db.query(
                            "SELECT renter_id, room_id, renter_details, renter_value, renter_contract_start, renter_contract_end FROM renters_rooms"
                        );
                        res.render("landlord.ejs", {
                            landlordName: newUser.full_name,
                            roomsTable: rooms.rows,
                            tenantsTable: tenants.rows,
                            renterRoomsTable: renterRooms.rows
                        });
                    });
                } catch (err) {
                    console.log("User already exists...");
                        res.send(`<script>
                            alert("User already exists. Try logging in instead!");
                            window.location.href = '/login';
                            </script>`);
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

                    // Log in new user
                    req.login(newUser, (err) => {
                        if (err) {
                            console.log("Login error after registration:", err);
                            return res.redirect('/login');
                        }
                        res.render("tenant.ejs", { renterName: newUser.full_name });
                    });
                } catch (err) {
                    console.log("User already exists!");
                        res.send(`<script>
                            alert("User already exists. Try logging in instead!");
                            window.location.href = '/login';
                            </script>`);
                }
            });
        }
    } catch (err) {
        console.log(err);
        res.status(500).send("Server error! Try again later ...");
    }
});

app.post('/login', (req, res, next) =>{
    passport.use(
        new Strategy(
            { usernameField: 'email', passwordField: 'password_hash', passReqToCallback: true},
            async function identification(req, email, password_hash, cb) {
                const func = req.body.role;
            try{
                const result1 = await db.query(
                    "SELECT * FROM landlords WHERE (email) = ($1)",
                    [email],
                );

                const result2 = await db.query(
                    "SELECT * FROM renters WHERE (email) = ($1)",
                    [email],
                );

                if (result1.rows.length > 0 || result2.rows.length > 0){
                    // console.log(result1); console.log(result2);
                    const user = result1.rows[0] || result2.rows[0];
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
                // Data Fetching
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
                return res.render("landlord.ejs", {
                    landlordName: user.full_name,
                    roomsTable: rooms.rows,
                    tenantsTable: tenants.rows,
                    renterRoomsTable: rentersRooms.rows
                });
            } else if (user.role === "renter") {
                return res.render("tenant.ejs", { renterName: user.full_name });
            } else {
                return res.redirect('/login');
            }
        });
    })(req, res, next);
});

/* Logout route
app.post('/logout', (req, res) =>{
    res.send(`<script>
        alert("You have been logged out successfully!");
        window.location.href = '/';
        </script>`);
});
*/

passport.serializeUser((user, cb) =>{
    cb(null, user);
});

passport.deserializeUser((user, cb) =>{
    cb(null, user);
});

app.listen(port, () =>{
    console.log(`Server running on http://localhost:${port}`);
});