import { getdatabase } from "./db.js";

export async function getClassesForUser(user_id, accountType) {
    const db = await getdatabase();
    try {      
        let rows;
        if(accountType === "teacher"){
            [rows] = await db.execute('SELECT class_id, class_name, class_key, teacher_id, created_at FROM classes WHERE teacher_id = ?', [user_id])
        }
        else if(accountType === "student"){
            [rows] = await db.execute('SELECT c.class_id, c.class_name FROM class_members cm JOIN classes c ON cm.class_id = c.class_id WHERE cm.student_id = ?', [user_id])
        }
        else{
            return { message: "Invalid account type" };
        }
        return { classes: rows };
    } catch (error) {
        console.error("Error fetching classes for user:", error);
        return { error };
    } 
}

export async function addStudentToClass(student_id, class_key) {
    const db = await getdatabase();

    const [classRows] = await db.execute(`SELECT * FROM classes WHERE class_key = ?`, [class_key]);
    
    if (classRows.length === 0) {
        return {message: "Invalid Class Key"};
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

export async function ClassCreation(class_name, teacher_id, class_key) {
    const db = await getdatabase();
    
    try{
        const [insertResult] = await db.execute(`INSERT INTO classes (class_name, teacher_id, class_key) VALUES (?, ?, ?)`,[class_name, teacher_id, class_key])
            if(insertResult.affectedRows === 1){
                return{message: "Class created successfully"};
            }

            return{message: "Class didn't get created"};
        }
    catch(error){
        if(error.code === "ER_DUP_ENTRY"){return{message:"Class Key Already Exists"}}   
            return {error};
        }
}

export async function getStudentsInClass(class_id) {
  const db = await getdatabase();

  try {
    const [rows] = await db.execute(`SELECT cm.member_id, cm.student_id, cm.joined_at, a.email FROM class_members cm JOIN accounts a ON cm.student_id = a.account_id WHERE cm.class_id = ?`, [class_id]);
    return { students: rows };

  } catch (error) {
    console.error("Error fetching students for class:", error);
    return { error };
  }
}