import express from "express";
import cors from "cors";
import * as LoginPage from "./LoginPage.js";
import * as RegisterPage from "./RegisterPage.js";

//initialize server instance
const app = express();

//sets port number the server will listen on
const PORT = 5000;

//enables cors for all requests and allows server to parse json data
app.use(cors());
app.use(express.json());

//creates a post route for login
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body; //extracts username and password from request body
  try {
    const result = await LoginPage.cleanInput(username, password); //calls cleanInput function to validate and process login
    res.json({ message: result }); //sends back the result as a json response
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Internal server error" });
  } 
});

//creates a post route for registration
app.post("/api/register", async (req, res) => {
  const { email, password, accountType } = req.body; //extracts username and password from request body
  try {
    const result = await RegisterPage.cleanInput(email, password, accountType); //calls cleanInput function to validate and process login
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




