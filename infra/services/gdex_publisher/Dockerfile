FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY publish.py pin.py ./
CMD ["python", "-u", "publish.py"]
