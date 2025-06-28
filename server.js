import bcrypt from "bcrypt";
import bodyParser from "body-parser";
import env from "dotenv";
import express from "express";
import pg from "pg";

const app = express();
const port = 3000;
const saltRounds = 10;
env.config();

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

app.get('/landlord', async (req, res) => {
    try {
        const rooms = await db.query(
            "SELECT title, room_details, room_type, room_price, is_available FROM rooms",
        );
        const tenants = await db.query(
            "SELECT full_name, preference, budget, activity_desc FROM renters",
        );
        const rentersRooms = await db.query(
            "SELECT renter_id, room_id, renter_details, renter_value, renter_contract_start, renter_contract_end FROM renters_rooms",
        );
        res.render("landlord.ejs", {
            landlordName: "Landlord", // You might want to get this from session
            roomsTable: rooms.rows,
            tenantsTable: tenants.rows,
            renterRoomsTable: rentersRooms.rows
        });
    } catch (err) {
        console.error("Error fetching rooms:", err);
        res.render("landlord.ejs", {
            landlordName: "Landlord",
            roomsTable: [],
            tenantsTable: [],
            renterRoomsTable: [],
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
        // First, find the renter by name
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
        
        // Find the room by title
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
        // Insert into renters_rooms table
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
    const roomName = req.body.newRoomName;
    const roomDetails = req.body.newPropertyDetails;
    const roomType = req.body.roomType;
    const roomValue = req.body.newRoomValue;
    
    try {
        await db.query(
            "INSERT INTO rooms (title, room_details, room_type, room_price) VALUES ($1, $2, $3, $4)",
            [roomName, roomDetails, roomType, roomValue]
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
            "SELECT * FROM landlords WHERE  email = $1",
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
                    res.status(500).send("Error processing the registration. Please try again later.");
                } else {
                    try {

                        await db.query(
                            "INSERT INTO landlords (full_name, email, password_hash, rooms_owned) VALUES ($1, $2, $3, $4)",
                            [userName, userEmail, hash, roomsOwned]
                        );
                        
                        // Fetch rooms data for the landlord dashboard
                        const rooms = await db.query(
                            "SELECT title, room_details, room_type, room_price, is_available FROM rooms"
                        );
                        const tenants = await db.query(
                            "SELECT full_name, preference, budget, activity_desc FROM renters"
                        );
                        const renterRooms = await db.query(
                            "SELECT renter_id, room_id, renter_details, renter_value, renter_contract_start, renter_contract_end FROM renters_rooms"
                        );
                        
                        res.render("landlord.ejs", {
                            landlordName: userName,
                            roomsTable: rooms.rows,
                            tenantsTable: tenants.rows,
                            renterRoomsTable: renterRooms.rows
                        });

                    } catch (err) {
                        console.log("User already exists...");
                            res.send(`<script>
                                alert("User already exists. Try logging in instead!");
                                window.location.href = '/login';
                                </script>`);
                    }
                }
                });
        } else if (func === "renter"){
            bcrypt.hash(userPswrd, saltRounds, async(err, hash) =>{
                if (err) {
                    console.log("Error Hashing the Password:", err);
                    res.status(500).send("Error processing the registration. Please try again later.");
                } else {
                    try {

                        await db.query(
                            "INSERT INTO renters (full_name, email, password_hash, preference, budget, activity_desc) VALUES ($1, $2, $3, $4, $5, $6)",
                            [userName, userEmail, hash, lookingFor, budget, desc]
                        );
                        res.render("tenant.ejs", {renterName: userName});

                    } catch (err) {
                        console.log("User already exists!");
                            res.send(`<script>
                                alert("User already exists. Try logging in instead!");
                                window.location.href = '/login';
                                </script>`);
                    }
                }
            });
        }
    } catch (err) {
        console.log(err);
        res.status(500).send("Server error! Try again later ...");
    }
});

app.post('/login', async (req, res) =>{
    const userEmail = req.body.email;
    const userPswrd = req.body.password_hash;
    const func = req.body.role;

    try{
        const result1 = await db.query(
            "SELECT * FROM landlords WHERE (email) = ($1)",
            [userEmail],
        );

        const result2 = await db.query(
            "SELECT * FROM renters WHERE (email) = ($1)",
            [userEmail],
        );

        if (result1.rows.length > 0 || result2.rows.length > 0){
            // console.log(result1);
            // console.log(result2);
            const user = result1.rows[0] || result2.rows[0];
            const storedPassword = user.password_hash;
            bcrypt.compare(userPswrd, storedPassword, async (err, passwordMatches) =>{
                if (err){
                    console.log("Error comparing the password:", err);
                    res.status(500).send("Error processing the login. Please try again later.");
                } else {
                    if (passwordMatches) {
                        if (func === "landlord"){
                            try {
                                // Fetch rooms data for the landlord dashboard
                                const rooms = await db.query(
                                    "SELECT title, room_details, room_type, room_price, is_available FROM rooms"
                                );
                                const tenants = await db.query(
                                    "SELECT full_name, preference, budget, activity_desc FROM renters"
                                );
                                const rentersRooms = await db.query(
                                    "SELECT renter_id, room_id, renter_details, renter_value, renter_contract_start, renter_contract_end FROM renters_rooms"
                                );
                                
                                res.render("landlord.ejs", {
                                    landlordName: user.full_name,
                                    roomsTable: rooms.rows,
                                    tenantsTable: tenants.rows,
                                    renterRoomsTable: rentersRooms.rows
                                });
                            } catch (dbErr) {
                                console.error("Error fetching rooms:", dbErr);
                                res.render("landlord.ejs", {
                                    landlordName: user.full_name,
                                    roomsTable: [],
                                    tenantsTable: [],
                                    renterRoomsTable: []
                                });
                            }
                        } else if (func === "renter"){
                            res.render("tenant.ejs", {renterName: user.full_name});
                        } else {
                            res.send(`<script>
                                alert("Unknown role! Please, try again...");
                                window.location.href = '/login';
                                </script>`
                            );
                        }
                    } else {
                        console.log("Incorrect Password");
                        res.send(`<script>
                            alert("Incorrect Password! Please, try again...");
                            window.location.href = '/login';
                            </script>`
                        );
                    }
                }
            });
        } else {
            res.send(`<script>
                alert("User not found! Please, try again...");
                window.location.href = '/login';
                </script>`
            );
        }
    } catch (err){
        console.log(err);
        res.status(500).send("Server error! Try again later ...");
    }
});

/* Logout route
app.post('/logout', (req, res) =>{
    res.send(`<script>
        alert("You have been logged out successfully!");
        window.location.href = '/';
        </script>`);
});
*/

app.listen(port, () =>{
    console.log(`Server running on http://localhost:${port}`);
});