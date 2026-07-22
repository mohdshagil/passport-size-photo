FROM python:3.11-slim

WORKDIR /app

# Copy application files
COPY . /app

# Expose port
EXPOSE 8000

ENV PORT=8000
ENV CASHFREE_ENV=sandbox

CMD ["python", "server.py"]
