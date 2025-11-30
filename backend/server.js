import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import * as Login from "./Login.js";
import * as Register from "./Register.js";
import * as ClassesFunctions from "./ClassesFunctions.js";
import * as Announcements from "./AnnouncementFunctions.js";
import * as Conversations from "./Conversations.js";
import * as DeletionFunctions from "./DeletionFunctions.js";
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
    const result = await Login.cleanInput(email, password);
    if (typeof result === "string") {

      return res.json({ message: result });
    }
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
    "SELECT account_id, email, account_type, created_at FROM accounts WHERE account_id = ?", [req.user.id]
  )

  res.json({
    account_id: rows[0].account_id,
    email: rows[0].email,
    accountType: rows[0].account_type,
    created_at: rows[0].created_at
  });
})

// GET STUDENT INFO BY ID
app.post("/getStudentInfo", verifyToken, async (req, res) => {
  const { student_id } = req.body;

  try {
    const db = await getdatabase();

    const [rows] = await db.execute(
      "SELECT account_id, email FROM accounts WHERE account_id = ?",
      [student_id]
    );

    if (rows.length === 0) {
      return res.json({ error: "Student not found" });
    }

    return res.json({ student: rows[0] });

  } catch (err) {
    console.error("Error in /getStudentInfo:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/getClasses", verifyToken, async(req, res)=>{
  const {id} = req.user;
  const {accountType} = req.body;

  try {
    const result = await ClassesFunctions.getClassesForUser(id, accountType); 
    res.json(result); 
  } catch (error) {
    console.error("Error fetching classes:", error);
    res.status(500).json({ message: "Internal server error" });
  }
})

app.post("/student/addClassMember", verifyToken, async(req, res)=>{
    const {class_key} = req.body;
    const student_id = req.user.id;

   try {
    const result = await ClassesFunctions.addStudentToClass(student_id, class_key) 
    res.json(result); 
  } catch (error) {
    console.error("Error during submission:", error);
    res.status(500).json({ message: "Error during submission" });
  } 
})

app.post("/teacher/createClass", verifyToken, async(req, res)=>{
    const{class_name, class_key} = req.body;
    const teacher_id = req.user.id;

   try {
    const result = await ClassesFunctions.ClassCreation(class_name, teacher_id, class_key); 
    res.json(result); 
  } catch (error) {
    console.error("Error during submission:", error);
    res.status(500).json({ message: "Error during submission" });
  } 

})

app.post("/createAnnouncement", verifyToken, async(req, res) =>{
    const { class_id, title, content, due_date } = req.body;

    try {
          const result = await Announcements.CreateAnnouncementFunction(class_id, title, content, due_date);

          res.json(result);
    }
    catch (error) {
        console.error("Error creating announcement:", error);
        res.status(500).json({ message: "Internal server error" });
    }

})

app.post("/getStudentsInClass", verifyToken, async(req, res) =>{
    const { class_id } = req.body;

    try {
          const result = await ClassesFunctions.getStudentsInClass(class_id);
          res.json(result);
    }
    catch (error) {
        console.error("Error fetching students in class:", error);
        res.status(500).json({ message: "Internal server error" });
    }
})

app.post("/getAnnouncements", verifyToken, async(req, res) =>{
    const { class_id } = req.body;

    try {
          const result = await Announcements.GetAnnouncementsForClass(class_id);
          res.json(result);
    }
    catch (error) {
        console.error("Error fetching announcements:", error);
        res.status(500).json({ message: "Internal server error" });
    }
})

app.post("/createConversation", verifyToken, async (req, res) => {
    const { title, class_id } = req.body;
    const account_id = req.user.id;


    if (!title) {
        return res.status(400).json({ message: "Missing conversation title" });
    }

    try {
        const result = await Conversations.CreateConversation(account_id, class_id, title);
        res.json(result);
    } catch (error) {
        console.error("Error creating conversation:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});


app.post("/saveChatLog", verifyToken, async (req, res) => {
    const { conversation_id, chat_type, chat } = req.body;

    if (!conversation_id || !chat_type || !chat) {
        return res.status(400).json({ message: "Missing chat log fields" });
    }

    try {
        const result = await Conversations.SaveChatLog(conversation_id, chat_type, chat);
        res.json(result);
    } catch (error) {
        console.error("Error saving chat log:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});


app.post("/getChatLogs", verifyToken, async (req, res) => {
    const { conversation_id } = req.body;

    if (!conversation_id) {
        return res.status(400).json({ message: "Missing conversation_id" });
    }

    try {
        const result = await Conversations.GetChatLogs(conversation_id);
        res.json(result);
    } catch (error) {
        console.error("Error getting chat logs:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});


app.post("/getConversations", verifyToken, async (req, res) => {
    const account_id = req.user.id;
    const { class_id } = req.body;

    try {
        const result = await Conversations.GetConversations(account_id, class_id);
        res.json(result);
    } catch (error) {
        console.error("Error getting conversations:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

app.post("/getStudentConversations", verifyToken, async (req, res) => {
    const { student_id, class_id } = req.body;

    if (!student_id || !class_id) {
        return res.status(400).json({ message: "Missing fields" });
    }

    try {
        const result = await Conversations.GetConversations(student_id, class_id);
        res.json(result);
    } catch (error) {
        console.error("Error getting student conversations:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

app.post("/leaveClass", verifyToken, async (req, res) => {
  const { class_id } = req.body;
  const student_id = req.user.id;

  if (!class_id) {
    return res.status(400).json({ message: "Missing class_id" });
  }

  try {
    const db = await getdatabase();

    await db.execute(
      `DELETE FROM class_members 
       WHERE class_id = ? AND student_id = ?`,
      [class_id, student_id]
    );

    res.json({ message: "Left class successfully" });

  } catch (err) {
    console.error("Error leaving class:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/deleteConversation", verifyToken, async (req, res) => {
    const { conversation_id } = req.body;

    if (!conversation_id) {
        return res.status(400).json({ message: "Missing conversation_id" });
    }

    const result = await DeletionFunctions.DeleteConversation(conversation_id);
    return res.json(result);
});

app.post("/deleteClass", verifyToken, async (req, res) => {
    const { class_id } = req.body;

    if (!class_id) {
        return res.status(400).json({ message: "Missing class_id" });
    }

    const result = await DeletionFunctions.DeleteClass(class_id);
    return res.json(result);
});

app.post("/deleteAccount", verifyToken, async (req, res) => {
    const { account_id } = req.body;

    if (!account_id) {
        return res.status(400).json({ message: "Missing account_id" });
    }

    const result = await DeletionFunctions.DeleteAccount(account_id);
    return res.json(result);
});

app.post("/deleteAnnouncement", verifyToken, async (req, res) => {
    const { announcement_id } = req.body;

    if (!announcement_id) {
        return res.status(400).json({ message: "Missing announcement_id" });
    }

    const result = await DeletionFunctions.DeleteAnnouncement(announcement_id);
    return res.json(result);
});




//creates a post route for registration
app.post("/api/register", async (req, res) => {
  const { email, password, accountType } = req.body;
  try {
    const result = await Register.cleanInput(email, password, accountType); 
    res.json(result ); //sends back the result as a json response
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




