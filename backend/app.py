from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


# Temporary in-memory chat "database"
chats = [
    {"id": 1, "title": "Math Midterm Review"},
    {"id": 2, "title": "Software Fundamentals"}
]

# ---------------- CHAT ROUTES ---------------- #

# GET  /api/chats  → return all chats
@app.route("/api/chats", methods=["GET"])
def get_chats():
    return jsonify(chats)

# GET  /api/chats/<id>  → return one chat by id
@app.route("/api/chats/<int:chat_id>", methods=["GET"])
def get_chat(chat_id):
    chat = next((c for c in chats if c["id"] == chat_id), None)
    if chat is None:
        return jsonify({"message": "Chat not found"}), 404
    return jsonify(chat)

# POST  /api/chats  → create a new chat
@app.route("/api/chats", methods=["POST"])
def create_chat():
    data = request.get_json()
    title = data.get("title")
    new_chat = {"id": len(chats) + 1, "title": title}
    chats.append(new_chat)
    return jsonify(new_chat), 201

# DELETE  /api/chats/<id>  → delete a chat
@app.route("/api/chats/<int:chat_id>", methods=["DELETE"])
def delete_chat(chat_id):
    global chats
    chats = [c for c in chats if c["id"] != chat_id]
    return jsonify({"message": f"Chat {chat_id} deleted"})

# --------------------------------------------- #

if __name__ == "__main__":
    app.run(port=5000, debug=True)
