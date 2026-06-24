# Udyam CSP Helper

Bulk Udyam registration for SBI CSP operators. Semi-automated. You type OTPs, extension does the rest.

**Author**: [AkashPriyadarshii](https://github.com/AkashPriyadarshii)

## Why This Exists

100+ CSP people need Udyam numbers. The portal is ASP.NET WebForms — ViewState, UpdatePanels, OTP auth, CAPTCHAs. Can't script it fully. Can't use Playwright — bot detection kills it.

Doing every person manually on that portal takes forever. Aadhaar, PAN, NIC cascade, bank, financials, declaration — same shit 100 times.

So the extension fills forms. You just type OTPs. That's the tradeoff.

## How It Works

- Reads 24 columns from a Google Sheet (public, read-only API key)
- Auto-fills the portal tab — clicks buttons, handles AJAX panels
- Stops when it hits OTP or CAPTCHA — you type it in the popup
- Moves to next person when you confirm

No AI. No ML. No external dependencies. Just DOM automation.

## Per Person Flow

| Step | What happens | You do |
|------|-------------|--------|
| 1 | Fills Aadhaar, name, consent → hits Generate OTP | — |
| 2 | — | Type OTP from their phone |
| 3 | PAN, org type, GST=No | — |
| 4 | Business name, address, mobile, email, category, gender | — |
| 5 | NIC: Services → 66 → 6619 → 66190 | — |
| 6 | Bank account, IFSC | — |
| 7 | Investment, turnover | — |
| 8 | Checks declarations → Submit | — |
| 9 | — | Type final OTP / CAPTCHA |
| 10 | Shows Udyam number | Screenshot it, click next |

~30 seconds of your time per person. 100 people ≈ half an hour.

## What's in the Box

| File | What it does |
|------|-------------|
| `manifest.json` | Chrome extension config (MV3) |
| `background.js` | Queue orchestrator, sheet fetcher, message router |
| `content.js` | The actual work — 8-step DOM state machine |
| `popup.html` / `popup.js` | Queue list, OTP/CAPTCHA input, controls |
| `options.html` / `options.js` | Config — sheet ID, API key, field overrides |
| `test_ext.py` | CSV generator + data validator |
| `test-portal.html` | Mock portal for offline testing |

## Setup

1. Create a Google Sheet with these columns (row 1):

```
Aadhaar_No | Proprietor_Name | PAN_No | Mobile_No | Email_ID | Commencement_Date | Address_Flat | Address_Premises | Address_Village | Address_City | Pincode | State_Name | District_Name | Social_Category | Gender | Woman_Owned | Minority_Owned | Disabled_Owned | Bank_Account_No | Bank_IFSC | Investment_Value | Turnover_Value | URN_Output
```

2. Share: Anyone with link → Viewer.
3. Get an API key from Google Cloud Console. Enable Sheets API.
4. `chrome://extensions/` → Load unpacked → select this folder.
5. Extension icon → Options → paste Sheet ID + API key → Save & Validate.
6. Open the portal page → click Start.
7. Type OTPs. Screenshot numbers. Move to next.

## Defaults (SBI CSP profile, all overridable)

- Org type: Proprietorship, Sector: Services, NIC: 66190
- GST: No
- 48+ DOM selectors in Options page if portal element IDs change

## License

All Rights Reserved. [LICENSE](LICENSE).
Copyright (c) 2026 AkashPriyadarshii.
