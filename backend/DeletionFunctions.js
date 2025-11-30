import { getdatabase } from "./db.js";

export async function DeleteConversation(conversation_id) {
    const db = await getdatabase();

    try {
        // Delete chat logs first (FK constraint requires cleanup)
        await db.execute(
            `DELETE FROM chatlogs WHERE conversation_id = ?`,
            [conversation_id]
        );

        // Delete the conversation
        const [deleteResult] = await db.execute(
            `DELETE FROM conversation WHERE conversation_id = ?`,
            [conversation_id]
        );

        if (deleteResult.affectedRows === 1) {
            return { message: "Conversation deleted successfully" };
        }

        return { message: "Conversation not found" };

    } catch (error) {
        console.error("Error deleting conversation:", error);
        return { error };
    }
}

export async function DeleteAccount(account_id) {
    const db = await getdatabase();

    try {
        // Delete chat logs → conversations
        await db.execute(
            `DELETE cl FROM chatlogs cl 
             JOIN conversation c ON cl.conversation_id = c.conversation_id
             WHERE c.account_id = ?`,
            [account_id]
        );

        // Delete conversations
        await db.execute(
            `DELETE FROM conversation WHERE account_id = ?`,
            [account_id]
        );

        // Remove from class membership
        await db.execute(
            `DELETE FROM class_members WHERE student_id = ?`,
            [account_id]
        );

        // Delete announcements made by this account (if teacher)
        await db.execute(
            `DELETE a FROM announcements a
             JOIN classes c ON a.class_id = c.class_id
             WHERE c.teacher_id = ?`,
            [account_id]
        );

        // Delete classes owned by teacher
        await db.execute(
            `DELETE FROM classes WHERE teacher_id = ?`,
            [account_id]
        );

        // Finally delete the account itself
        const [deleteResult] = await db.execute(
            `DELETE FROM accounts WHERE account_id = ?`,
            [account_id]
        );

        if (deleteResult.affectedRows === 1) {
            return { message: "Account deleted successfully" };
        }

        return { message: "Account not found" };

    } catch (error) {
        console.error("Error deleting account:", error);
        return { error };
    }
}

export async function DeleteClass(class_id) {
    const db = await getdatabase();

    try {
        // Delete announcements
        await db.execute(
            `DELETE FROM announcements WHERE class_id = ?`,
            [class_id]
        );

        // Delete chat logs → conversations
        await db.execute(
            `DELETE cl FROM chatlogs cl
             JOIN conversation c ON cl.conversation_id = c.conversation_id
             WHERE c.class_id = ?`,
            [class_id]
        );

        // Delete conversations belonging to that class
        await db.execute(
            `DELETE FROM conversation WHERE class_id = ?`,
            [class_id]
        );

        // Remove students in the class
        await db.execute(
            `DELETE FROM class_members WHERE class_id = ?`,
            [class_id]
        );

        // Finally, delete the class
        const [deleteResult] = await db.execute(
            `DELETE FROM classes WHERE class_id = ?`,
            [class_id]
        );

        if (deleteResult.affectedRows === 1) {
            return { message: "Class deleted successfully" };
        }

        return { message: "Class not found" };

    } catch (error) {
        console.error("Error deleting class:", error);
        return { error };
    }
}

export async function DeleteAnnouncement(announcement_id) {
    const db = await getdatabase();

    try {
        const [deleteResult] = await db.execute(
            `DELETE FROM announcements WHERE announcement_id = ?`,
            [announcement_id]
        );

        if (deleteResult.affectedRows === 1) {
            return { message: "Announcement deleted successfully" };
        }

        return { message: "Announcement not found" };

    } catch (error) {
        console.error("Error deleting announcement:", error);
        return { error };
    }
}