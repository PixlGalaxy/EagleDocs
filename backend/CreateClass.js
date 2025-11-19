import { getdatabase } from "./db.js";

export async function classCreation(class_name, teacher_id, class_key) {
    const db = await getdatabase();
    
    try{
        const [insertResult] = await db.execute(`Insert INTO classes (class_name, teacher_id, class_key) VALUES (?, ?, ?)`,[class_name, teacher_id, class_key])
            if(insertResult.affectedRows === 1){
                return{message: "Class created successfully"};
            }

            return{message: "Class didn't get created"};
        }
        catch(error){
            if(error.code === "ER_DUP_ENTRY"){return{message:"Class Key Already Exists"}}   

            return {message: "Server Error"};
        }
}