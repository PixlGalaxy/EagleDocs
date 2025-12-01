import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

export const DOCUMENTS_DIR = process.env.DOCUMENTS_DIR || path.join(ROOT_DIR, 'storage', 'documents');
export const RAG_INDEX_DIR = process.env.RAG_INDEX_DIR || path.join(ROOT_DIR, 'storage', 'rag');

export const ensureStorage = () => {
  [DOCUMENTS_DIR, RAG_INDEX_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};
