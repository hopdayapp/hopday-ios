"""Writes the App Store Connect key from the ASC_KEY_P8 secret to a temporary file,
adding the BEGIN/END lines if they were left out when pasting. Prints nothing secret."""
import os, re
raw = os.environ["ASC_KEY_P8"].replace("\\n", "\n").strip()
body = re.sub(r"-----(BEGIN|END) [A-Z ]*PRIVATE KEY-----", "", raw)
body = re.sub(r"[^A-Za-z0-9+/=]", "", body)
lines = [body[i:i + 64] for i in range(0, len(body), 64)]
pem = "-----BEGIN PRIVATE KEY-----\n" + "\n".join(lines) + "\n-----END PRIVATE KEY-----\n"
open(os.path.join(os.environ["RUNNER_TEMP"], "asc.p8"), "w").write(pem)
print("Key file prepared:", len(lines), "lines")
