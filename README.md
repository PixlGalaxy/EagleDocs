# EagleDocs — AI-Powered Study Assistant

EagleDocs is a platform designed to help students study using AI and Retrieval-Augmented Generation (RAG). Instuctors can upload PDFs, generate embeddings, and interact with course-specific knowledge through an intelligent chat interface.

This repository uses:

- **Frontend:** React + Vite
- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **AI Engine:** Ollama

---

## Prerequisites

Before running EagleDocs, you must configure:

- **backend `.env` file**
- **PostgreSQL database** for User and Chats storage. (local or in a container)
- **Ollama** for AI processing (local or in a container)

---

# 1. Configure the `.env` file

Inside `/backend`, rename `.env.example` → `.env` and fill in:

```env
# Server
PORT=5000
NODE_ENV=development #development or production | development disables CORS
CLIENT_ORIGIN=http://localhost:5173

# PostgreSQL DB Config
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=eagledocs_user
DB_PASSWORD=eagledocs_pass
DB_NAME=eagledocs_db
DB_SSL=false #On LAN set to false 

# Auth (JWT on httpOnly cookie)
JWT_SECRET=SecretHere :3 

# Ollama Config
OLLAMA_HOST=127.0.0.1
OLLAMA_PORT=11434
OLLAMA_MODEL=gpt-oss:20b
```

---

# 2. Install PostgreSQL & Create the Database

After installing PostgreSQL, run:

```sql
CREATE DATABASE eagledocs_db;

CREATE USER eagledocs_user WITH PASSWORD 'eagledocs_pass';

GRANT ALL PRIVILEGES ON DATABASE eagledocs_db TO eagledocs_user;
```

Use these values inside your `.env`.

---

# 3. Install Ollama (Required for Local Development)

Download Ollama here:
https://ollama.com/download

Pull the AI model:

```bash
ollama pull gpt-oss:20b
```

Start the service:

```bash
ollama serve
```

---

# Running EagleDocs Locally (without Docker)

## Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

Runs at: http://localhost:5173

---

## Backend (Node.js + Express)

```bash
cd backend
npm install
node server.js
```

Runs at: http://localhost:5000

> Note: Run frontend and backend in separate terminals.

---

# Using VSCode

1. Open the project folder in VSCode.
2. Open **Terminal 1**:
   ```bash
   cd backend
   node server.js
   ```
3. Open **Terminal 2**:
   ```bash
   cd frontend
   npm run dev
   ```

---

# Docker Deployment (Production / Unraid / Linux)

EagleDocs requires **3 containers**:

| Container | Purpose |
|----------|---------|
| **Ollama** | Runs the AI model |
| **PostgreSQL** | Stores persistent data |
| **EagleDocs App** | Backend + Frontend |

---

## Quick Docker Run

```bash
docker run -p 80:3000 ghcr.io/pixlgalaxy/eagledocs:latest
```

Access at: http://localhost:3000

---

# RAG Storage Paths

EagleDocs stores documents and embeddings inside the backend container:

| Purpose | Path |
|---------|------|
| Uploaded PDFs | /app/backend/storage/documents |
| RAG Indexes | /app/backend/storage/rag |

These **must be mounted** to host paths so that data persists after restarts.

---

# Mapping Host Paths ↔ Container Paths

## Docker Run Example

```bash
docker run   -p 80:3000   -v /mnt/user/EagleDocs/documents:/app/backend/storage/documents   -v /mnt/user/EagleDocs/rag:/app/backend/storage/rag   ghcr.io/pixlgalaxy/eagledocs:latest
```

## docker-compose Example

```yaml
services:
  eagledocs:
    image: ghcr.io/pixlgalaxy/eagledocs:latest
    ports:
      - "80:3000"
    volumes:
      - ./documents:/app/backend/storage/documents
      - ./rag:/app/backend/storage/rag
```

## Unraid Example

Add **two Path entries** in the container settings:

| Container Path | Host Path Example |
|----------------|------------------|
| /app/backend/storage/documents | /mnt/user/appdata/eagledocs/documents |
| /app/backend/storage/rag | /mnt/user/appdata/eagledocs/rag |

### Steps in Unraid:
1. Edit the container
2. Click **Add another Path**
3. Add the Document path mapping Read/Write
4. Add the RAG path mapping
5. Apply

---

# Links

- Website: https://eagledocs.org
- Discord: https://discord.gg/CFS9DSe9RX

---

# Developers

- PixlGalaxy — https://github.com/PixlGalaxy
