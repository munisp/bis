FROM python:3.11-slim

# System dependencies for OpenCV, Tesseract, and PaddlePaddle
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libglu1-mesa \
    tesseract-ocr \
    tesseract-ocr-eng \
    libgl1-mesa-glx \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download InsightFace buffalo_l model
RUN python -c "from insightface.app import FaceAnalysis; app = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider']); app.prepare(ctx_id=0)" || true

# Copy application
COPY . .

EXPOSE 8084

ENV PORT=8084
ENV PYTHONUNBUFFERED=1

CMD ["python", "main.py"]
