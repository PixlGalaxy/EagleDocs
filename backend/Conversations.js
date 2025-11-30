import { getdatabase } from "./db.js";

export async function CreateConversation(account_id, class_id, conversation_title) {
    const db = await getdatabase();

    try {
        conversation_title = conversation_title.substring(0, 45);
        
        const [insertResult] = await db.execute(`INSERT INTO conversation (account_id, class_id, conversation_title) VALUES (?, ?, ?)`, [account_id, class_id, conversation_title]);
        return {conversation_id: insertResult.insertId, message: "Successfully inserted conversation"};

    } catch (error) {
        console.error("Error creating conversation:", error);
        return { message: error };
    }
}


export async function SaveChatLog(conversation_id, chat_type, chat) {
    const db = await getdatabase();

    try {
        await db.execute(
            `INSERT INTO chatlogs (conversation_id, chat_type, chat) VALUES (?, ?, ?)`,
            [conversation_id, chat_type, chat]
        );

        return { message: "Successfully inserted chatlog" };
    } catch (error) {
        console.error("Error saving chat:", error);
        return { message: error };
    }
}

export async function GetChatLogs(conversation_id) {
    const db = await getdatabase();

    try {
        const [rows] = await db.execute(`SELECT chatlog_id, chat_type, chat, chatlog_timestamp FROM chatlogs WHERE conversation_id = ? ORDER BY chatlog_timestamp ASC`, [conversation_id]);
        return { rows };
    } catch (error) {
        console.error("Error loading chat logs:", error);
        return { message: error };
    }
}

export async function GetConversations(account_id, class_id) {
    const db = await getdatabase();

    try {
        let rows;
        
        if (class_id === null || class_id === undefined) {
            [rows] = await db.execute(`SELECT conversation_id, conversation_title, class_id FROM conversation WHERE account_id = ? ORDER BY conversation_id DESC`,[account_id]);
        } else {
            [rows] = await db.execute(`SELECT conversation_id, conversation_title, class_id FROM conversation WHERE account_id = ? AND class_id = ? ORDER BY conversation_id DESC`,[account_id, class_id]);
        }

        return { rows };
    } catch (error) {
        console.error("Error getting conversations:", error);
        return { message: error };
    }
}

