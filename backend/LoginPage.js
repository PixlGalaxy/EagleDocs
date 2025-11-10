import { getdatabase } from "./db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

//function to validate and process login input
export async function cleanInput(potemail, potPassword) {
    if (!potemail || !potPassword) {
        return { error: "Email and password are required" };
    }
    if (!potemail.includes("@")) {
        return { error: "Invalid email format" };
    }
    if (potPassword.length <= 0) {
        return { error: "Password cannot be empty" };
    }
    return await GetLoginInfo(potemail, potPassword);
}

//function to get login info from database and verify user credentials
export async function GetLoginInfo(email, password) {
    try {
        const db = await getdatabase();
        const [rows] = await db.execute(`SELECT * FROM accounts WHERE email = ?`, [email]);
        if (rows.length === 0) {
            return { error: "Invalid credentials" };
        }
        const user = rows[0];
        // Compare hashed password
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return { error: "Invalid credentials" };
        }
        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, email: user.email, accountType: user.accountType },
            "your_jwt_secret", // Replace with env var in production
            { expiresIn: "2h" }
        );
        // Return user data and token
        return {
            message: "Login successful",
            user: {
                id: user.id,
                email: user.email,
                accountType: user.accountType
            },
            token
        };
    } catch (error) {
        console.error("Login error:", error);
        return { error: "Internal server error" };
    }
}

