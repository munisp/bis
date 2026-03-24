FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8082
ENV RISK_ENGINE_PORT=8082
CMD ["python", "main.py"]
