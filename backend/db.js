import mysql from "mysql2/promise"

//allows other files to use the database connection
export async function getdatabase() {
    try{
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || "localhost",
        user: process.env.DB_USER || "eagledocs_user",
        password: process.env.DB_PASSWORD || "change_me",
        database: process.env.DB_NAME || "eagledocs_db"
    })
    console.log("Database connected successfully");
    return connection
    } catch (error) {
        console.error("Database connection failed:", error);
        throw error;
    }
}