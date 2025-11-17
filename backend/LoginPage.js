import { getdatabase } from "./db.js";
import jwt from "jsonwebtoken"
import bcrypt from "bcrypt";

//function to validate and process login input
export async function cleanInput(potemail, potPassword) {
    if( potemail.includes("@")  && potPassword.length > 0 ){ 
        return await GetLoginInfo(potemail, potPassword);
    }
    else if( potPassword.length <= 0 ){
        return "Password cannot be empty";
    }
    else{
        return "Invalid username format";
    }
}

//function to get login info from database and verify user credentials
export async function GetLoginInfo(email, password) {
    const db = await getdatabase();

    const [rows] = await db.execute(`SELECT * FROM accounts WHERE email = ?`, [email]);
    
    if (rows.length === 0) {
        return {message: "Invalid credentials"};
    }
    else{
        const valid = await bcrypt.compare(password, rows[0].password);
        if (!valid) {
            return {message: "Invalid credentials"};
        }
        else{
            const token = jwt.sign({
            id: rows[0].id,
        },
        process.env.JWT_SECRET,{expiresIn: '2h'})
        return {
            message: "Login successful",
            token: token,
        };
        }
    }
}


