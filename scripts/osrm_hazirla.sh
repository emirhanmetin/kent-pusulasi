#!/bin/sh
# Kendi rota sunucumuz için OpenStreetMap verisini hazırlar (araç + yürüme).
# Türkiye verisi indirilir, İzmir ve çevresi kesilir (bellek ve süre için), iki profil için işlenir.
# Gerekenler: docker. İlk çalıştırma ~10-20 dk sürer; sunucuda en az 4 GB bellek önerilir.
# Güncel yollar için ayda bir yeniden çalıştırıp `docker compose restart osrm-car osrm-foot` yapın.
set -eu

OSRM_IMAGE=ghcr.io/project-osrm/osrm-backend:v5.27.1
BBOX=26.1,37.8,28.6,39.5          # batı,güney,doğu,kuzey (İzmir ili ve çevresi)
DIR="$(cd "$(dirname "$0")/.." && pwd)/osrm"

mkdir -p "$DIR/car" "$DIR/foot"
cd "$DIR"

if [ ! -f turkey-latest.osm.pbf ]; then
  echo "Türkiye OSM verisi indiriliyor (Geofabrik)..."
  if command -v wget >/dev/null; then wget -q --show-progress -O turkey-latest.osm.pbf https://download.geofabrik.de/europe/turkey-latest.osm.pbf
  else curl -fL --progress-bar -o turkey-latest.osm.pbf https://download.geofabrik.de/europe/turkey-latest.osm.pbf; fi
fi

echo "İzmir bölgesi kesiliyor..."
# osmium-tool, resmî Debian imajına Debian paketinden kurulur (üçüncü taraf imaj kullanılmaz)
docker run --rm -v "$DIR:/data" debian:bookworm-slim sh -c   "apt-get update -qq && apt-get install -y -qq osmium-tool >/dev/null && osmium extract -b $BBOX /data/turkey-latest.osm.pbf -o /data/izmir.osm.pbf --overwrite"

for profile in car foot; do
  echo "== $profile profili işleniyor"
  cp izmir.osm.pbf "$profile/izmir.osm.pbf"
  docker run --rm -v "$DIR/$profile:/data" "$OSRM_IMAGE" osrm-extract -p "/opt/$profile.lua" /data/izmir.osm.pbf
  docker run --rm -v "$DIR/$profile:/data" "$OSRM_IMAGE" osrm-partition /data/izmir.osrm
  docker run --rm -v "$DIR/$profile:/data" "$OSRM_IMAGE" osrm-customize /data/izmir.osrm
  rm "$profile/izmir.osm.pbf"
done

echo "Hazır. Başlatmak için: docker compose up -d"
