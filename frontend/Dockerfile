# ==========================================
# Stage 1: Build the Vanilla TypeScript App
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy ONLY package files first to leverage Docker layer caching
COPY package*.json ./

# Use 'ci' for deterministic, faster, lockfile-based installations
RUN npm ci

# Copy the rest of the source code and build
COPY . .
RUN npm run build 

# ==========================================
# Stage 2: Serve using Unprivileged NGINX
# ==========================================
FROM nginxinc/nginx-unprivileged:1.27-alpine

# Copy build artifacts from Stage 1 with secure read-only permissions
COPY --from=builder --chown=nginx:nginx --chmod=0555 /app/dist /usr/share/nginx/html

# Enforce deterministic non-root execution by user ID (UID 101 is 'nginx')
USER 101

# Support read-only root filesystems by mounting ephemeral paths
VOLUME /tmp

# Expose the default unprivileged port
EXPOSE 8080

# Signal for graceful connection termination on shutdown
STOPSIGNAL SIGQUIT

CMD ["nginx", "-g", "daemon off;"]