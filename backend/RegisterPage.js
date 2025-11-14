import { getdatabase } from "./db.js"; 
import { sendVerificationEmail } from "./services/emailService.js";     

export async function cleanInput(potemail, potPassword, potaccountType) {

    if (!potemail.includes("@")) {
        return "Invalid email format";
    }

    if (potPassword.length <= 0) {
        return "Password cannot be empty";
    }

    return await AddLoginInfo(potemail, potPassword, potaccountType);
}

export async function AddLoginInfo(email, password, accountType) {
    try {
        const db = await getdatabase();

        const [rows] = await db.execute(
            `INSERT INTO accounts (email, password, account_type) VALUES (?, ?, ?)`,
            [email, password, accountType]
        );

        if (rows.affectedRows === 0) {
            return "Account creation failed";
        }

        // EMAIL VERIFICATION STEP
        await sendVerificationEmail(email);

        return "Account created successfully. Check your email for verification.";
        
    } catch (error) {
        console.error("Error during account creation:", error);
        return error.message;
    }
}
