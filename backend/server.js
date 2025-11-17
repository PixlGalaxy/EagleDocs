import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import * as LoginPage from "./LoginPage.js";
import * as RegisterPage from "./RegisterPage.js";
import dotenv from "dotenv"
dotenv.config()
import jwt from "jsonwebtoken";
import { getdatabase } from "./db.js";

//initialize server instance
const app = express();

//sets port number the server will listen on
const PORT = 5000;

//enables cors for all requests and allows server to parse json data
app.use(cors());
app.use(express.json());

function verifyToken(req,res,next){
  const token = req.headers["authorization"]?.split(" ")[1];

  if(!token){
    return res.status(401).json({message: "No Token Provided"});
  }

  try{
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  }catch(error){
    return res.status(403).json({message: "Invalid Token"})
  }

}






//creates a post route for login
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await LoginPage.cleanInput(email, password);
    if (typeof result === "string") {
      // result is an error message
      return res.json({ message: result });
    }
    // result is the object { message: "Login successful", token: "xxx" }
    return res.json(result);
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});


//Protected Routes
app.get("/account", verifyToken, async(req, res)=>{
  const db = await getdatabase();

  const [rows] = await db.execute(
    "SELECT account_id, email, account_type, created_at FROM accounts WHERE id = ?", [req.user.id]
  )

  res.json({
    id: rows[0].id,
    email: rows[0].email,
    accountType: rows[0].account_type,
    created_at: rows[0].created_at
  });
})

app.get("/classMember", verifyToken, (req, res)=>{
  
})

app.get("/class", verifyToken, (req, res)=>{
  
})

app.get("/conversation", verifyToken, (req, res)=>{
  
})

app.get("/chatlog", verifyToken, (req, res)=>{
  
})

app.get("/settings", verifyToken, (req, res) =>{

})



//creates a post route for registration
app.post("/api/register", async (req, res) => {
  const { email, password, accountType } = req.body;
  try {
    const result = await RegisterPage.cleanInput(email, password, accountType); 
    res.json({ message: result }); //sends back the result as a json response
} catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ message: "Internal server error" });
  } 
});

//defines route rq how to get data res how to send data
app.get("/api/uptime", (req, res) => {
  res.json({ message: "Hello from EagleDocs backend! - Backend Running" });
});

//starts the server and listens on specified port
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});




