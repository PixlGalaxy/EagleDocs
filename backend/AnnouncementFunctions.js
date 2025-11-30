import { getdatabase } from "./db.js";

export async function CreateAnnouncementFunction(class_id, title, content, due_date) {
    const db = await getdatabase();

    try {
        const [insertResult] = await db.execute(
            `INSERT INTO announcements (class_id, title, announcement, due_date) VALUES (?, ?, ?, ?)`,
            [class_id, title, content, due_date || null]
        );
        if (insertResult.affectedRows === 1) {
            return { message: "Announcement created successfully" };
        }
        return { message: "Announcement did not get created" };
    } 
    catch (error) {
        if (error.code === "ER_NO_REFERENCED_ROW_2") {
            return { message: "Class does not exist" };
        }
        return { error };
    }
}

export async function GetAnnouncementsForClass(class_id) {
    const db = await getdatabase();

    try {
        const [rows] = await db.execute(
            `SELECT announcement_id, title, announcement, due_date, created_at FROM announcements WHERE class_id = ? ORDER BY created_at DESC`,
            [class_id]
        );
        return { announcements: rows };
    }
    catch (error) {
        console.error("Error fetching announcements for class:", error);
        return { error };
    }
}
