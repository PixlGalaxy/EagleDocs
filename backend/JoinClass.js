import { getdatabase } from "./db.js";

export async function addStudentToClass(student_id, class_key) {
    const db = await getdatabase();

    const [classRows] = await db.execute(`SELECT * FROM classes WHERE class_key = ?`, [class_key]);
    
    if (classRows.length === 0) {
        return {message: "Invalid Key"};
    }
    else{
        try{
            const [insertResult] = await db.execute(`Insert INTO class_members (class_id, student_id) VALUES (?, ?)`,[classRows[0].class_id, student_id])
            if(insertResult.affectedRows === 1){
                return{message: "Student added successfully"};
            }

            return{message: "Student didn't get added"};
        }
        catch(error){
            return {message: "Server Error"};
        }
    }
}