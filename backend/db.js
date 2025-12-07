import mysql from "mysql2/promise"

//allows other files to use the database connection
export async function getdatabase() {
    try{
    const connection = await mysql.createConnection({
        host: "localhost",
        user: "EagleDocsUser",
        password: "BluePiano!42Sun",
        database: "EagleDocsDB"
        
    })
    console.log("Database connected successfully");
    return connection
    } catch (error) {
        console.error("Database connection failed:", error);
        throw error;
    }
}