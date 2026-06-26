# ==========================================
# STAGE 1: Build virtual environment
# ==========================================
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder
# FROM ghcr.io/astral-sh/uv:python3.12-trixie-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# Copy dependency mappings 
COPY pyproject.toml uv.lock ./

# Install dependencies into the workspace (omitting development environments)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Mount files and execute final application alignment
COPY main.py .
# RUN --mount=type=cache,target=/root/.cache/uv \
#     uv sync --frozen --no-dev


# ==========================================
# STAGE 2: Distroless production runtime
# ==========================================
FROM gcr.io/distroless/python3-debian12
# FROM gcr.io/distroless/python3-debian13
WORKDIR /app

# Point PATH to the venv bin folder so Python can find uvicorn modules
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Copy the complete venv + app from the builder stage
COPY --from=builder --chown=nonroot:nonroot /app /app

# Enforce secure context using the built-in distroless user identifier
USER nonroot

# Expose target application port
EXPOSE 8000

# Call the uvicorn executable inside your .venv directly using JSON array format.
# Distroless has no shell, so arguments must be separate strings.
ENTRYPOINT ["/app/.venv/bin/uvicorn"]

# Configure uvicorn arguments directly via JSON array formatting
# CMD ["main:app", "--host=0.0.0.0", "--port=8000", "--workers=4"]
CMD ["fastapi", "run", "main.py", "--port", "8000", "--workers", "4"]
