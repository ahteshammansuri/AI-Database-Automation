FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code into /app/ai_service so module imports match ai_service.app...
COPY . /app/ai_service

# Ensure storage directories exist
RUN mkdir -p /app/ai_service/storage/indexes /app/ai_service/storage/uploads

ENV PYTHONPATH=/app
ENV AI_SERVICE_PORT=8001
ENV AI_SERVICE_HOST=0.0.0.0
ENV OLLAMA_BASE_URL=http://host.docker.internal:11434

EXPOSE 8001

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8001/health || exit 1

CMD ["uvicorn", "ai_service.app.main:app", "--host", "0.0.0.0", "--port", "8001"]
