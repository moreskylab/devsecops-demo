# Stage 1: Build virtual environment
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY pyproject.toml uv.lock ./
# RUN --mount=type=cache,target=/root/.cache/uv \
#     --mount=type=bind,source=pubkeys.txt,target=pubkeys.txt,optional=true \
#     uv init --no-workspace && \
#     uv add fastapi uvicorn pydantic sqlalchemy psycopg2-binary
# Alternatively, if you already have pyproject.toml/uv.lock:
# 1. Install dependencies first to maximize layer caching
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Step 2: Copy your actual code and install the project itself
COPY main.py ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# Stage 2: Production runtime image
FROM python:3.12-slim-bookworm
WORKDIR /app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    WEB_CONCURRENCY=4 \
    PORT=8000

# Create a system non-root user for security compliance
RUN groupadd -g 10001 appuser && \
    useradd -u 10001 -g appuser -m -s /sbin/nologin appuser

# Copy virtual environment from builder stage
COPY --from=builder --chown=appuser:appuser /app /app

USER 10001

EXPOSE ${PORT}


# 2. Execute via the shell wrapper syntax
CMD ["sh", "-c", "gunicorn main:app --workers=${WEB_CONCURRENCY} --worker-class=uvicorn.workers.UvicornWorker --bind=0.0.0.0:${PORT}"]

