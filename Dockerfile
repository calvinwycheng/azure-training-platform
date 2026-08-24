FROM python:3.12-slim
WORKDIR /app
COPY src/ /app/
ENV AI103_HOST=0.0.0.0 AI103_PORT=5000 AZURE_TRAINING_DB_PATH=/app/storage/azure-training.sqlite3
EXPOSE 5000
CMD ["python", "server.py"]
