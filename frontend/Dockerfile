# ==========================================
# Stage 1: Build the Vanilla TypeScript App
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# Combine dependency installation, source copying, and building into a single layer
COPY package*.json ./
COPY . .
RUN npm ci && npm run build 

# ==========================================
# Stage 2: Serve using Unprivileged NGINX
# ==========================================
FROM nginxinc/nginx-unprivileged:1.27-alpine

# Clear default assets and configurations safely in one layer
RUN rm -f /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

# Copy build artifacts from Stage 1 with secure read-only permissions
COPY --from=builder --chown=nginx:nginx --chmod=0555 /app/dist /usr/share/nginx/html
COPY --chown=nginx:nginx --chmod=0444 nginx.conf /etc/nginx/conf.d/default.conf

# Enforce deterministic non-root execution by user ID (UID 101 is 'nginx')
USER 101

# Support read-only root filesystems by mounting ephemeral paths
VOLUME /tmp

# Expose the default unprivileged port
EXPOSE 8080

# Signal for graceful connection termination on shutdown
STOPSIGNAL SIGQUIT

CMD ["nginx", "-g", "daemon off;"]
