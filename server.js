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

app.post('/register', async (req, res) =>{
    const userName = req.body.full_name;
    const userEmail = req.body.email;
    const userPswrd = req.body.password_hash;
    const func = req.body.role;

    try {
        const checkResult = await db.query(
            "SELECT * FROM users WHERE (full_name, email, password_hash, role) = ($1, $2, $3, $4)",
            [userName, userEmail, userPswrd, func]
            );

        if (checkResult.rows.length > 0){
            res.send(`<script>alert("User already exists. Try loggin in instead!");
                widow.location.href = '/register';
                </script>`);
        } else {

            if (func === "landlord"){
                bcrypt.hash(userPswrd, saltRounds, async (err, hash) =>{
                    if (err){
                        console.log("Error hashing the password:", hash);
                    } else {
                        await db.query(
                            "INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4)",
                            [userName, userEmail, hash, func]
                        )
                        res.render("landlord.ejs");
                    }
                });
                

            } else if (func === "renter"){
            
                bcrypt.hash(userPswrd, saltRounds, async(err, hash) =>{
                    if (err) {
                        console.log("Error Hashing the Password:", hash);
                    } else {
                        await db.query(
                            "INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4)",
                            [userName, userEmail, hash, func]
                        );
                        res.render("tenant.ejs");
                    }
                });

            } else {
                res.send(`<script>alert("Try again by entering a valid role!");
                    window.location.href = '/register';
                    </script>`)
            }

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
        const result = await db.query(
            "SELECT * FROM users WHERE (email, role) = ($1, $2)",
            [userEmail, func],
        );

        if (result.rows.length > 0){
            // console.log(result);
            const user = result.rows[0];
            const storedPassword = user.password_hash;

            bcrypt.compare(userPswrd, storedPassword, (err, result) =>{

                if (err){
                    console.log("Error comparing the password:", err);
                } else {
                    if (result) {

                        if (func === "landlord"){
                            res.render("landlord.ejs");
                        } else if (func === "renter"){
                            res.render("tenant.ejs");
                        } else {
                            res.send(`<script>
                                alert("Unknown role! Please, try again...");
                                window.location.href = '/login';
                                </script>`
                            );
                        }

                    } else {
                        console.log("Incorrect Password");
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

app.post('/newRenter', async (req, res) =>{
    const renterName = req.body.newRenterName;
    const renterRoom = req.body.newRenterRoom;
    const renterDetails = req.body.newRenterDetails;
    const renterValue = req.body.newRenterValue;
    const renterContractS = req.body.newRenterContractS;
    const renterContractE = req.body.newRenterContractE;

    try {
        const checkResult = await db.query(
            "SELECT * FROM users WHERE full_name = $1",
            [renterName],
        );

        if (checkResult.rows.length > 0) {
            const user = checkResult.rows[0];
            const userId = user.id;
            const userRole = user.role;
            console.log("User ID:", userId);
                await db.query(
                    "INSERT INTO rooms (title, description, price, landlord_id) VALUES ($1, $2, $3, $4)",
                    [renterRoom, renterDetails, renterValue, userId]
                );
                
                await db.query(
                    "INSERT INTO contracts (start_date, end_date) VALUES ($1, $2)",
                    [renterContractS, renterContractE]
                );
            
                
        } else {
            console.log("This renter does not exist! Please, try again...");
            res.redirect('/landlord');
        }
    } catch (err) {
        console.error("Error inserting new renter:", err);
        return res.status(500).send("Error adding new renter. Please try again later.");
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