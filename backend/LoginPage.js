import { getdatabase } from "./db.js";

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
    const [rows] = await db.execute(`SELECT * FROM accounts WHERE email = ? AND password = ?`, [email, password]);
    if (rows.length === 0) {
        return "Invalid credentials";
    }
    else {
        return "Login successful";
    }
}

