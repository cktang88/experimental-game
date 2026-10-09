#!/bin/bash
# usage: itchdl.sh <itch page url> <upload_id> <outfile>
P="$1"; ID="$2"; OUT="$3"; D=$(mktemp -d); C=$D/cj
curl -s -c $C -b $C "$P" -o $D/p.html
T=$(grep -oE 'name="csrf_token" value="[^"]+"' $D/p.html | head -1 | sed 's/.*value="//;s/"$//')
U=$(curl -s -c $C -b $C -X POST --data-urlencode "csrf_token=$T" "$P/download_url" | python3 -I -c 'import json,sys;print(json.load(sys.stdin).get("url",""))')
curl -s -c $C -b $C "$U" -o $D/d.html
R=$(curl -s -c $C -b $C -X POST --data-urlencode "csrf_token=$T" "$P/file/$ID?source=view_game&as_props=1&after_download_lightbox=true")
F=$(echo "$R" | python3 -I -c 'import json,sys;print(json.load(sys.stdin).get("url",""))')
[ -z "$F" ] && { echo "FAIL $R"; exit 1; }
curl -sSL "$F" -o "$OUT" && ls -la "$OUT"
rm -rf $D
