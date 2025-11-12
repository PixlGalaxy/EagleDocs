
import { getdatabase } from "./db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_change_in_production";

export async function cleanInput(potemail, potPassword, potaccountType) {
    if (!potemail || !potPassword || !potaccountType) {
        return { error: "Email, password, and account type are required" };
    }
    if (!potemail.includes("@")) {
        return { error: "Invalid email format" };
    }
    if (potPassword.length < 8) {
        return { error: "Password must be at least 8 characters long" };
    }
    if (!["student", "instructor"].includes(potaccountType.toLowerCase())) {
        return { error: "Account type must be 'student' or 'instructor'" };
    }
    return await AddLoginInfo(potemail, potPassword, potaccountType);
}

export async function AddLoginInfo(email, password, accountType) {
    try {
        const db = await getdatabase();
        // Check for duplicate email
        const [existing] = await db.execute(`SELECT * FROM accounts WHERE email = ?`, [email]);
        if (existing.length > 0) {
            return { error: "Email already registered" };
        }
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.execute(
            `INSERT INTO accounts (email, password, account_type) VALUES (?, ?, ?)`,
            [email, hashedPassword, accountType]
        );
        if (result.affectedRows === 0) {
            return { error: "Account creation failed" };
        }
        // Get new user info
        const [userRows] = await db.execute(`SELECT * FROM accounts WHERE email = ?`, [email]);
        const user = userRows[0];
        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, email: user.email, accountType: user.account_type },
            JWT_SECRET,
            { expiresIn: "2h" }
        );
        return {
            message: "Account created successfully",
            user: {
                id: user.id,
                email: user.email,
                accountType: user.account_type
            },
            token
        };
    } catch (error) {
        console.error("Error during account creation:", error);
        return { error: "Internal server error" };
    }
}