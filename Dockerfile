# Build frontend
FROM node:24-alpine AS build-frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Build backend
FROM node:24-alpine AS build-backend
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./

# Final image (Node + Nginx)
FROM node:24-alpine
WORKDIR /app

# Install nginx
RUN apk add --no-cache nginx

# Copy built frontend
COPY --from=build-frontend /app/frontend/dist /usr/share/nginx/html

# Copy backend
COPY --from=build-backend /app/backend /app/backend

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Ensure backend permissions
WORKDIR /app/backend
RUN chmod +x server.js

# Expose ports
EXPOSE 80
EXPOSE 5000

# Start both services
CMD ["sh", "-c", "node /app/backend/server.js & nginx -g 'daemon off;'"]
