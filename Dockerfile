# Kent Pusulası API + web sitesi (yayın imajı)
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    KP_ENV=prod

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY web ./web

# Root olmayan kullanıcı; önbellek klasörü birim (volume) olarak bağlanır
RUN useradd --create-home --uid 10001 app && mkdir -p /app/.cache && chown -R app /app
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:' + __import__('os').environ.get('PORT', '8000') + '/api/katmanlar', timeout=4)"

# Erişim günlüğü kapalı: uvicorn'un günlüğü konum koordinatlarını ve IP'yi yazar (bkz. backend/security.py)
# PORT: Render/Railway gibi barındırma servisleri portu bu değişkenle verir (varsayılan 8000)
CMD ["sh", "-c", "exec python -m uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000} --no-access-log"]
