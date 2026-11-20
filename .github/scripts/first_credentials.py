"""Runs `eas build` in interactive mode on GitHub's machine and answers Expo's setup questions,
so Expo can create the Apple distribution certificate and provisioning profile with the
App Store Connect API key (from the environment). Prints the dialogue; never prints secrets."""
import os, re, sys, pexpect

cmd = "npx -y eas-cli@latest build --platform ios --profile production --no-wait"
child = pexpect.spawn("/bin/bash", ["-lc", cmd], encoding="utf-8", timeout=900,
                      dimensions=(50, 200), env={k: v for k, v in {**os.environ, "FORCE_COLOR": "0"}.items() if k not in ("CI", "GITHUB_ACTIONS", "CONTINUOUS_INTEGRATION")})
child.logfile_read = sys.stdout

# Questions we expect, and the answer to give. Anything that asks for an Apple password
# or a code is refused: the API key must be used instead.
RULES = [
    (r"Apple ID:|Apple ID password|Password \(for|two-factor|6.digit code|verification code", None),
    (r"log in to your Apple account\?", "y"),
    (r"(Use|Select|Choose).*App Store Connect API Key", "\r"),
    (r"Generate a new Apple Distribution Certificate\?", "y"),
    (r"Generate a new Apple Provisioning Profile\?", "y"),
    (r"Reuse this distribution certificate\?", "y"),
    (r"(set up|enable) Push Notifications", "n"),
    (r"Select a team|Which team", "\r"),
    (r"\(Y/n\)", "y"),
    (r"\(y/N\)", "n"),
    (r"› ", "\r"),           # any other list: take the suggested option
]
pats = [re.compile(p, re.I) for p, _ in RULES] + [pexpect.EOF, pexpect.TIMEOUT]
answered = 0
while True:
    i = child.expect(pats)
    if i == len(RULES):
        break
    if i == len(RULES) + 1:
        print("\n::error::Expo stopped answering for 15 minutes"); sys.exit(1)
    ans = RULES[i][1]
    if ans is None:
        print("\n::error::Expo asked for an Apple password or code. The App Store Connect key was not used, so it stopped here.")
        child.terminate(force=True); sys.exit(1)
    answered += 1
    if answered > 40:
        print("\n::error::Too many questions; stopping to be safe."); child.terminate(force=True); sys.exit(1)
    child.send(ans if ans == "\r" else ans + "\r")
child.close()
sys.exit(child.exitstatus or 0)
