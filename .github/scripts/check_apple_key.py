"""Checks the App Store Connect key secrets and asks Apple whether it accepts them.
Prints only yes/no answers and lengths, never the values."""
import os, re, sys, time, json, urllib.request, urllib.error
import jwt  # PyJWT
from cryptography.hazmat.primitives.serialization import load_pem_private_key

path, kid, iss = os.environ["EXPO_ASC_API_KEY_PATH"], os.environ.get("EXPO_ASC_KEY_ID", "").strip(), os.environ.get("EXPO_ASC_ISSUER_ID", "").strip()
raw = open(path).read()
ok = True
print("Key file: BEGIN line present:", "-----BEGIN PRIVATE KEY-----" in raw, "| END line present:", "-----END PRIVATE KEY-----" in raw, "| lines:", len(raw.strip().splitlines()))
try:
    key = load_pem_private_key(raw.strip().encode() + b"\n", password=None); print("Key file: readable private key: True")
except Exception as e:
    print("::error::The ASC_KEY_P8 secret isn't a valid key file (copy the whole .p8 text again, BEGIN to END)."); sys.exit(1)
if not re.fullmatch(r"[A-Z0-9]{10}", kid):
    print(f"::error::ASC_KEY_ID should be 10 capital letters/numbers; it has {len(kid)} characters."); ok = False
if not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", iss, re.I):
    print(f"::error::ASC_ISSUER_ID should look like 8-4-4-4-12 characters with dashes; it has {len(iss)} characters."); ok = False
if not ok: sys.exit(1)
now = int(time.time())
tok = jwt.encode({"iss": iss, "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"}, raw.strip() + "\n", algorithm="ES256", headers={"kid": kid, "typ": "JWT"})
req = urllib.request.Request("https://api.appstoreconnect.apple.com/v1/bundleIds?limit=1", headers={"Authorization": "Bearer " + tok})
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        print("Apple accepts the key: True (HTTP", r.status, ")")
except urllib.error.HTTPError as e:
    body = e.read().decode()[:300]
    print(f"::error::Apple refused the key (HTTP {e.code}). Most likely the Key ID doesn't belong to this .p8 file, the Issuer ID is wrong, or the key was revoked / isn't a Team key with Admin access.")
    print("Apple says:", re.sub(r"[A-Za-z0-9_-]{20,}", "…", body))
    sys.exit(1)
