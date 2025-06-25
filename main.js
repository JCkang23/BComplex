import bodyParser from "body-parser";
import express from "express";

const app = express();
const port = 4000;

app.use(bodyParser.urlencoded({ extended: true}));

app.listen(port, ()=>{
    console.log(`API is running on http://localhost:${port}`);
});