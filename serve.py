"""Kent Pusulası İzmir'i başlatır.

Kullanım:
  python serve.py            ->  yalnızca bu bilgisayar: http://localhost:8000
  python serve.py --lan      ->  aynı Wi-Fi'daki telefonlar da erişebilir (iPhone uygulamasını denemek için)
  python serve.py 9000       ->  farklı port
  python serve.py --reload   ->  geliştirirken: backend/ dosyaları değişince sunucu kendiliğinden yeniden başlar
  (seçenekler birleştirilebilir: python serve.py --lan --reload)

API belgesi: http://localhost:8000/docs
Konum izni (geolocation) yalnızca localhost ya da https üzerinden çalışır;
index.html dosyasını çift tıklayarak açmak yetmez.
"""

import socket
import sys

import uvicorn


def lan_ip() -> str | None:
    """Bu bilgisayarın yerel ağ IP'si (dışarıya paket göndermeden, yönlendirme tablosundan)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


if __name__ == "__main__":
    args = sys.argv[1:]
    lan = "--lan" in args
    port = next((int(a) for a in args if a.isdigit()), 8000)
    host = "0.0.0.0" if lan else "127.0.0.1"

    print(f"Kent Pusulası: http://localhost:{port}")
    if lan:
        ip = lan_ip()
        print(f"Yerel ağdan erişim: http://{ip or '<bu-bilgisayarin-ip-adresi>'}:{port}")
        print("Windows güvenlik duvarı sorarsa yalnızca 'Özel ağlar' için izin verin.")
    reload = "--reload" in args
    if reload:
        print("Otomatik yeniden başlatma açık: backend/ klasöründeki değişiklikler hemen uygulanır.")
    # Uvicorn'un kendi erişim günlüğü sorgu dizesini (konum koordinatlarını) ve IP'yi yazar; kapatıp
    # yerine backend/security.py'deki gizlilik dostu günlüğü kullanıyoruz.
    uvicorn.run(
        "backend.main:app",
        host=host,
        port=port,
        reload=reload,
        reload_dirs=["backend"] if reload else None,
        access_log=False,
        proxy_headers=False,
    )
