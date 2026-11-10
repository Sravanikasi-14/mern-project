from pathlib import Path

# --- B1 Company schema ---
p = Path(r"c:\Users\SRAVANI\mern-project\server\models\Company.js")
src = p.read_text(encoding="utf-8")
old = """    primaryContact: {
      fullName: { type: String, default: \"\" },
      email: { type: String, default: \"\" },
      phoneNumber: { type: String, default: \"\" },
    },"""
new = """    primaryContact: {
      fullName: { type: String, default: \"\" },
      email: { type: String, default: \"\" },
      phoneNumber: { type: String, default: \"\" },
    },
    /**
     * Offer letter letterhead (authoritative for standard HRMS offer template).
     * Do not reuse geofence officeAddress from HR policy.
     */
    letterhead: {
      address: { type: String, default: \"\" },
      website: { type: String, default: \"\" },
      signatoryName: { type: String, default: \"\" },
      signatoryTitle: { type: String, default: \"\" },
    },"""
nl = "\r\n" if "\r\n" in src else "\n"
old_n = old.replace("\n", nl)
new_n = new.replace("\n", nl)
if old_n not in src:
    raise SystemExit("Company schema patch failed")
p.write_text(src.replace(old_n, new_n, 1), encoding="utf-8", newline="")
print("OK Company.js")

# --- settings getCompanySettings ---
p = Path(r"c:\Users\SRAVANI\mern-project\server\controllers\settingsController.js")
src = p.read_text(encoding="utf-8")
nl = "\r\n" if "\r\n" in src else "\n"
old = """        primaryContact: {
          fullName: company.primaryContact?.fullName || \"\",
          email: company.primaryContact?.email || \"\",
          phoneNumber: company.primaryContact?.phoneNumber || \"\",
        },
        subscription: {"""
new = """        primaryContact: {
          fullName: company.primaryContact?.fullName || \"\",
          email: company.primaryContact?.email || \"\",
          phoneNumber: company.primaryContact?.phoneNumber || \"\",
        },
        letterhead: {
          address: company.letterhead?.address || \"\",
          website: company.letterhead?.website || \"\",
          signatoryName: company.letterhead?.signatoryName || \"\",
          signatoryTitle: company.letterhead?.signatoryTitle || \"\",
        },
        subscription: {"""
# appears twice potentially - replace all for get and put response
count = src.count(old.replace("\n", nl) if "\r\n" in src else old)
old_n = old.replace("\n", nl)
new_n = new.replace("\n", nl)
if old_n not in src:
    raise SystemExit("settings get letterhead block not found")
src = src.replace(old_n, new_n)  # all occurrences in get + put responses
print("letterhead serialize replacements", count)

# updateCompanySettings body destructuring + $set
old = """    const {
      companyName,
      displayName,
      timezone,
      currencyCode,
      currency,
      primaryContact,
      contactEmail,
      contactPhone,
    } = req.body || {};"""
new = """    const {
      companyName,
      displayName,
      timezone,
      currencyCode,
      currency,
      primaryContact,
      contactEmail,
      contactPhone,
      letterhead,
    } = req.body || {};"""
old_n = old.replace("\n", nl)
new_n = new.replace("\n", nl)
if old_n not in src:
    raise SystemExit("updateCompanySettings destructure not found")
src = src.replace(old_n, new_n, 1)

old = """    if (contactPayload && typeof contactPayload === \"object\") {
      if (typeof contactPayload.fullName === \"string\") {
        $set[\"primaryContact.fullName\"] = contactPayload.fullName.trim();
      }
      if (typeof contactPayload.email === \"string\" && contactPayload.email.trim()) {
        const norm = normalizeEmail(contactPayload.email.trim());
        if (norm && isValidEmail(norm)) {
          $set[\"primaryContact.email\"] = norm;
        }
      }
      if (typeof contactPayload.phoneNumber === \"string\") {
        $set[\"primaryContact.phoneNumber\"] = contactPayload.phoneNumber.trim();
      }
    }

    if (Object.keys($set).length > 0) {"""
new = """    if (contactPayload && typeof contactPayload === \"object\") {
      if (typeof contactPayload.fullName === \"string\") {
        $set[\"primaryContact.fullName\"] = contactPayload.fullName.trim();
      }
      if (typeof contactPayload.email === \"string\" && contactPayload.email.trim()) {
        const norm = normalizeEmail(contactPayload.email.trim());
        if (norm && isValidEmail(norm)) {
          $set[\"primaryContact.email\"] = norm;
        }
      }
      if (typeof contactPayload.phoneNumber === \"string\") {
        $set[\"primaryContact.phoneNumber\"] = contactPayload.phoneNumber.trim();
      }
    }

    if (letterhead && typeof letterhead === \"object\") {
      if (typeof letterhead.address === \"string\") {
        $set[\"letterhead.address\"] = letterhead.address.trim().slice(0, 1000);
      }
      if (typeof letterhead.website === \"string\") {
        const site = letterhead.website.trim().slice(0, 300);
        if (site && !/^https?:\\/\\//i.test(site) && site.includes(\".\")) {
          $set[\"letterhead.website\"] = `https://${site}`;
        } else {
          $set[\"letterhead.website\"] = site;
        }
      }
      if (typeof letterhead.signatoryName === \"string\") {
        $set[\"letterhead.signatoryName\"] = letterhead.signatoryName.trim().slice(0, 200);
      }
      if (typeof letterhead.signatoryTitle === \"string\") {
        $set[\"letterhead.signatoryTitle\"] = letterhead.signatoryTitle.trim().slice(0, 200);
      }
    }

    if (Object.keys($set).length > 0) {"""
old_n = old.replace("\n", nl)
new_n = new.replace("\n", nl)
if old_n not in src:
    raise SystemExit("letterhead $set block insert failed")
src = src.replace(old_n, new_n, 1)

# Ensure put response also has letterhead - already replaced if same structure
# Check put response company object - may use refreshed.
if "letterhead: {" not in src.replace("\r\n","\n"):
    raise SystemExit("letterhead missing after patch")
p.write_text(src, encoding="utf-8", newline="")
print("OK settingsController.js")
