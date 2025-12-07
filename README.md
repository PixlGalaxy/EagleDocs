### Getting Started

To begin using this template:
1. Clone the repository:
   `git clone https://github.com/PixlGalaxy/EagleDocs.git`
2. Install dependencies with `npm install` or `yarn`.
3. Start the development server using `npm run dev` or `yarn dev`.

### Docker Setup

To run the Docker container for this project, follow these steps:

1. Use the following command to run the container:
   ```bash
   docker run -p 80:3000 ghcr.io/pixlgalaxy/eagledocs:latest

This will map port 3000 from the container to your host machine.

2. After running the command, you can access the application by navigating to http://localhost:3000.

### More Information

For more details on setting up and using Vite with React, refer to the official documentation of each plugin linked above.

### RAG storage paths

- Instructor PDFs are stored in `backend/storage/documents/<year>/<instructor>/<course>-<crn>` (mount `backend/storage/documents` as a Docker volume to persist uploads).
- Generated RAG indexes are written to `backend/storage/rag/<year>/<instructor>/<course>-<crn>` (mount `backend/storage/rag` to keep chunked context across deployments).
- The primary `OLLAMA_MODEL` both gates intent (deciding when to read PDFs) and generates answers, returning JSON for document selection before receiving course context.

Share the course code and CRN defined by each instructor with students so they can select the course RAG from the chat experience.

### Links

- Website: [eagledocs.org](https://eagledocs.org)
- Discord: [EagleDocs Discord](https://discord.gg/CFS9DSe9RX)

### Developers 
- [PixlGalaxy](https://github.com/PixlGalaxy)
