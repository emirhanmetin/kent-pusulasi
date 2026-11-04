"""Sunucu ayarları. Değerler ortam değişkenlerinden ya da proje kökündeki .env dosyasından okunur.

Geliştirme (varsayılan) ile yayın (KP_ENV=prod) arasındaki farklar:
  - API belgesi (/docs) yayında kapalı,
  - FOSSGIS'in ücretsiz genel rota sunucuları yayında kullanılmaz (kullanım koşulları yoğun kullanıma izin
    vermiyor); kendi OSRM sunucunuzun adresi OSRM_URL / OSRM_FOOT_URL ile verilmelidir,
  - X-Forwarded-For başlığına yalnızca ters vekil (Caddy/nginx) arkasında güvenilir.
Ayrıntılar için .env.example dosyasına bakın.
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"


def load_dotenv(override: bool = False) -> None:
    """.env dosyasını ortam değişkenlerine yükler (ek paket gerektirmez)."""
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if override or key not in os.environ:
            os.environ[key] = value


load_dotenv()


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in ("1", "true", "evet", "yes", "on")


ENV = os.environ.get("KP_ENV", "dev").strip().lower()
IS_PROD = ENV == "prod"

# Rota (OSRM). Kendi sunucunuz varsa önce o denenir.
OSRM_CAR_URL = os.environ.get("OSRM_URL") or None
OSRM_FOOT_URL = os.environ.get("OSRM_FOOT_URL") or None
PUBLIC_ROUTING = _bool("KP_PUBLIC_ROUTING", not IS_PROD)

# IP'ye göre yaklaşık konum: kullanıcının IP adresini üçüncü taraf bir servise (ipwho.is) gönderir.
# Gizlilik nedeniyle varsayılan olarak kapalıdır.
IP_LOCATION = _bool("KP_IP_KONUM", False)

DOCS = _bool("KP_DOCS", not IS_PROD)
RATE_LIMIT_PER_MIN = int(os.environ.get("KP_RATE_LIMIT", "120"))
TRUST_PROXY = _bool("KP_TRUST_PROXY", IS_PROD)

# Anlık bildirimler (Expo Push). Erişim anahtarı isteğe bağlıdır; Expo projesinde "enhanced security"
# açıksa gerekir.
EXPO_ACCESS_TOKEN = os.environ.get("EXPO_ACCESS_TOKEN") or None
