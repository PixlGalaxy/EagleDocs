import { getdatabase } from "./db.js"; 
import bcrypt, { hash } from "bcrypt";

export async function cleanInput(potemail, potPassword,potaccountType) {
    if( potemail.includes("@")  && potPassword.length > 0 ){ 
        const hashedPassword = await bcrypt.hash(potPassword, 10);
        return await AddLoginInfo(potemail, hashedPassword, potaccountType);
    }
    else if( potPassword.length <= 0 ){
        return "Password cannot be empty";
    }
    else{
        return "Invalid username format";
    }
}

export async function AddLoginInfo(email, password, accountType) {
    try {
    const db = await getdatabase();
    const [rows] = await db.execute(`Insert INTO accounts (email, password, account_type) VALUES (?, ?, ?)`, [email, password, accountType]);
    
    if (rows.affectedRows === 0) {
        return {message:"Account creation failed"};
    }
    else {
        return {message:"Account created successfully"};
    }
} catch (error) {
    if(error.code === "ER_DUP_ENTRY"){
        return{
            message:"Account already exists"
        }
    }

    console.error("Error during account creation:", error);

    return{
        message: "Internal server error"
    }

}
}