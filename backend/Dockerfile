# Stage 1: Build virtual environment
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app

COPY pyproject.toml uv.lock ./

# Install dependencies first to maximize layer caching
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Copy actual code and install the project itself
COPY main.py ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev


# Stage 2: Production runtime image
FROM python:3.12-slim-bookworm
WORKDIR /app

# Cloud-native environment variables
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    WEB_CONCURRENCY=4 \
    PORT=8000

# Install dumb-init for proper signal handling (PID 1) and apply security updates
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends dumb-init && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create a system non-root user for security compliance
RUN groupadd -g 10001 appuser && \
    useradd -u 10001 -g appuser -m -s /sbin/nologin appuser

# Copy virtual environment and code from builder stage
COPY --from=builder --chown=appuser:appuser /app /app

# Enforce non-root execution
USER 10001

EXPOSE ${PORT}

# Use dumb-init as the entrypoint to handle PID 1 responsibilities
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Use 'exec' to replace the shell process with gunicorn so it receives SIGTERM directly
CMD ["sh", "-c", "exec gunicorn main:app --workers=\"${WEB_CONCURRENCY:-4}\" --worker-class=uvicorn.workers.UvicornWorker --bind=0.0.0.0:\"${PORT:-8000}\""]
# CMD ["sh", "-c", "exec uvicorn main:app --workers=\"${WEB_CONCURRENCY:-4}\" --host=0.0.0.0 --port=\"${PORT:-8000}\""]