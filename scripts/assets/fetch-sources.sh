#!/bin/bash
# Downloads the raw CC0 source packs into $ASSET_CACHE (default /home/user/asset-cache).
# Processed, web-ready kits are committed under public/assets/; you only need this to rebuild them.
set -e
CACHE=${ASSET_CACHE:-/home/user/asset-cache}; HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$CACHE" && cd "$CACHE"
get_itch() { [ -f "$3" ] || "$HERE/itch-download.sh" "$1" "$2" "$3"; mkdir -p "$4" && unzip -qo "$3" -d "$4"; }
# Quaternius (CC0) via itch.io
get_itch https://quaternius.itch.io/downtown-city-megakit 17615373 q-downtown.zip q-downtown
get_itch https://quaternius.itch.io/modular-sci-fi-megakit 13454739 q-scifi-megakit.zip q-scifi
# Quaternius Ultimate Spaceships (CC0) via OpenGameArt: enemy aircraft for the units kit.
[ -f ultimate_spaceships_-_may_2021.zip ] || curl -sSLO https://opengameart.org/sites/default/files/ultimate_spaceships_-_may_2021.zip
[ -d q-spaceships ] || { unzip -qo ultimate_spaceships_-_may_2021.zip "*/OBJ/*" "*/Textures/*" -d q-spaceships-tmp && mkdir -p q-spaceships && cp -r "q-spaceships-tmp/Ultimate Spaceships - May 2021/." q-spaceships/ && rm -rf q-spaceships-tmp; }
# Kenney Space Kit and Car Kit (CC0, https://kenney.nl/assets) are expected unzipped as kenney_space-kit/ and kenney_car-kit/.
# The sci-fi kit's glTF files expect textures beside them.
cd "q-scifi/Modular SciFi MegaKit[Standard]/glTF" && for d in */; do for t in ../Textures/*.png; do ln -sf "../$t" "$d$(basename "$t")"; done; done
echo "sources ready in $CACHE"
