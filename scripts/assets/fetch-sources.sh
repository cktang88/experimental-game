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
# The sci-fi kit's glTF files expect textures beside them.
cd "q-scifi/Modular SciFi MegaKit[Standard]/glTF" && for d in */; do for t in ../Textures/*.png; do ln -sf "../$t" "$d$(basename "$t")"; done; done
echo "sources ready in $CACHE"
