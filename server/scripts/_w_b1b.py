from pathlib import Path
p = Path(r"c:\Users\SRAVANI\mern-project\server\controllers\settingsController.js")
src = p.read_text(encoding="utf-8")
nl = "\r\n" if "\r\n" in src else "\n"
old = """        config: refreshed.config,
        primaryContact: refreshed.primaryContact,
        subscription: refreshed.subscription,"""
new = """        config: refreshed.config,
        primaryContact: refreshed.primaryContact,
        letterhead: {
          address: refreshed.letterhead?.address || \"\",
          website: refreshed.letterhead?.website || \"\",
          signatoryName: refreshed.letterhead?.signatoryName || \"\",
          signatoryTitle: refreshed.letterhead?.signatoryTitle || \"\",
        },
        subscription: refreshed.subscription,"""
old_n = old.replace("\n", nl)
new_n = new.replace("\n", nl)
if old_n not in src:
    raise SystemExit("put response patch failed")
p.write_text(src.replace(old_n, new_n, 1), encoding="utf-8", newline="")
print("OK put response letterhead")
