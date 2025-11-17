import mysql from "mysql2/promise"
import dotenv from "dotenv"
dotenv.config()

//allows other files to use the database connection
export async function getdatabase() {
    try{
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user:   process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME
        
    })
    console.log("Database connected successfully");
    return connection
    } catch (error) {
        console.error("Database connection failed:", error);
        throw error;
    }
}