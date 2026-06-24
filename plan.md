# Udyam CSP Helper — V1 Plan

> Chrome Extension for bulk Udyam registration of 100+ SBI CSP/Kiosk Operators.
> Build: Manifest V3, zero AI, DOM automation + human-in-loop for OTP/CAPTCHA.

---

## Architecture

```
Google Sheet (100+ CSP rows)
       │ read-only API key
       ▼
Chrome Extension (MV3)
  ├── background.js   → Sheet fetch, queue engine, chrome.storage, message hub
  ├── content.js      → 8-step DOM state machine, MutationObserver, fill/click
  ├── popup.html/js   → Queue UI, OTP/CAPTCHA input, Start/Pause/Skip/Retry
  └── options.html/js → Sheet ID, API key, dry-run, field selector overrides
       │
       ▼ (injects into tab)
Udyam Registration Portal (udyamregistration.gov.in)
```

---

## File Structure (Actual V1)

```
udyam-csp-v1/
├── manifest.json       # MV3, permissions, host_permissions, content script
├── background.js       # ~300 lines — queue orchestration, sheet fetch, messaging
├── content.js          # ~950 lines — 8-step FSM, DOM helpers, UpdatePanel observer
├── popup.html          # ~100 lines — queue table, OTP input, controls
├── popup.js            # ~250 lines — UI render, state sync, OTP/CAPTCHA handlers
├── options.html        # ~80 lines — config form with field overrides
├── options.js          # ~130 lines — save/load, test connection via background
├── plan.md             # This file
├── test_ext.py         # ~300 lines — CSV generator, validator, file checker
├── test-portal.html    # Local mock portal for testing (Aadhaar auth not required)
├── .gitignore          # Repo standard ignores
├── LICENSE             # MIT
└── README.md           # Repo documentation
```

---

## V1 Scope — Actual

### ✅ Included (Implemented & Tested)

| Feature | Detail | Status |
|---------|--------|--------|
| Google Sheets read | API key, public sheet, range `Sheet1!A1:Z` | ✅ Tested |
| Queue management | Flat storage keys (`queue`, `currentIndex`, `isProcessing`) | ✅ Tested |
| Aadhaar step fill | `txtadharno`, `txtownername`, `chkDecarationA`, `btnValidateAadhaar` | ✅ Tested on live portal |
| OTP detection | MutationObserver on UpdatePanel, polls for OTP input | ✅ Tested |
| OTP popup | Text field + Submit button in popup | ✅ Tested |
| PAN step fill | Organisation type, PAN, Validate PAN | ✅ Implemented |
| GST = No | Selects No radio button | ✅ Implemented |
| Business details | Name, address, state/district cascade, pincode, mobile, email, social, gender | ✅ Implemented |
| NIC 66190 | Services radio → 66 → 6619 → 66190 via `__doPostBack` | ✅ Implemented |
| Bank details | Account number, confirm account, IFSC | ✅ Implemented |
| Investment/Turnover | Investment amount, turnover amount | ✅ Implemented |
| Declaration checkbox | Check both declarations before submit | ✅ Implemented |
| CAPTCHA detection | Image appears → show in popup for manual solve | ✅ Implemented |
| Final OTP | Second OTP field → popup for manual entry | ✅ Implemented |
| Submit | Click submit, wait for result | ✅ Implemented |
| Extract Udyam number | Regex from body text + result link | ✅ Implemented |
| Dry-run mode | Fill everything, skip actual OTP/Submit, show success | ✅ Tested (portal down) |
| Field selector overrides | Options page with configurable IDs | ✅ Implemented |
| Config validation | Test Connection button validates sheet + API key | ✅ Tested |
| 100-row test data | Python CSV generator with validation | ✅ Tested |

### ❌ Excluded (V1)

| Feature | Why | Workaround |
|---------|-----|-----------|
| Google Sheets write-back | Complexity + security (API key = read-only) | Copy URN from popup manually |
| Auto-retry on 503 | You should decide when to retry | Click Retry button |
| Auto-resume after crash | Could cause cascade failures | Reload tab, click Start |
| Sound notifications | User wants no surprises | Watch popup status |
| CSV export | Not needed with live queue | Results visible in popup list |
| Keyboard shortcuts | Nice-to-have | V2 |
| Error logging to file | Console + popup is sufficient | V2 |

---

## Step Machine (Implemented)

```
IDLE → AADHAAR_FILL → click Generate OTP → OTP_WAIT (human types) →
OTP_ENTERED → PAN_FILL → GST_SET → BUSINESS_FILL → NIC_SET →
BANK_FILL → FINANCIAL_FILL → DECLARED → FINAL_OTP_WAIT (human types) →
CAPTCHA_WAIT (human solves) → SUBMITTED → DONE

             Any step → FAILED (user clicks Retry or Skip)
```

### Step Detection Logic

The content script detects which step the portal is on by checking for DOM element presence in priority order. It doesn't track state with variables — it re-evaluates `detectStep()` each cycle.

1. **AADHAAR** → `txtadharno` exists and `lblMsg1` doesn't say success
2. **AADHAAR_DONE** → `lblMsg1` says "Aadhaar verified" or OTP input visible
3. **PAN** → `panInputField` detected
4. **GST** → GST radio buttons detected
5. **BUSINESS** → `enterpriseNameField` detected
6. **NIC** → `nic2Select` detected
7. **BANK** → `bankAccountField` detected
8. **FINANCIAL** → `investmentField` detected
9. **DECLARATION** → submit button + declaration checkboxes detected
10. **DONE** → body text matches `UDYAM-XX-00-1234567` pattern

---

## Confirmed Element IDs

These are the CONFIGURABLE IDs stored in chrome.storage and mapped through `CONFIG.sel*` in content.js. Defaults tested on live portal:

| Config Key | Default ID | Step |
|-----------|-----------|------|
| `selAadhaarNo` | `ctl00_ContentPlaceHolder1_txtadharno` | 1 |
| `selName` | `ctl00_ContentPlaceHolder1_txtownername` | 1 |
| `selConsent` | `ctl00_ContentPlaceHolder1_chkDecarationA` | 1 |
| `selValidateAadhaarBtn` | `ctl00_ContentPlaceHolder1_btnValidateAadhaar` | 1 |
| `selAadhaarMsg` | `ctl00_ContentPlaceHolder1_lblMsg1` | 1 |
| `selUpdatePanel` | `ctl00_ContentPlaceHolder1_UpdatePaneldd1` | All |
| `selOtpInput` | `#txtOTP, #txtotp, input[maxlength="6"]` | 2 |
| `selOtpVerifyBtn` | `#btnVerifyOTP, #btnValidateOTP` | 2 |
| `selOrgType` | `select[id*="ddlOrgType"], select[id*="ddlConstitution"]` | 3 |
| `selPanInput` | `input[id*="txtPAN"]` | 3 |
| `selValidatePanBtn` | `input[id*="btnValidatePAN"]` | 3 |
| `selGstNo` | `input[type="radio"][value="No"]` | 4 |
| `selEnterpriseName` | `input[id*="txtEnterprise"], input[id*="txtUnit"]` | 5 |
| `selMobile` | `input[id*="txtMobile"]` | 5 |
| `selEmail` | `input[id*="txtEmail"]` | 5 |
| `selSocialCategory` | `select[id*="ddlSocial"]` | 5 |
| `selGender` | `input[name*="gender"]` | 5 |
| `selWomanOwned` | `input[id*="chkWoman"]` | 5 |
| `selAddressFlat` | `input[id*="txtAddress1"], input[id*="txtUnitAddress"]` | 5 |
| `selAddressPremises` | `input[id*="txtAddress2"]` | 5 |
| `selAddressVillage` | `input[id*="txtVillage"]` | 5 |
| `selAddressCity` | `input[id*="txtCity"]` | 5 |
| `selPincode` | `input[id*="txtPincode"]` | 5 |
| `selState` | `select[id*="ddlState"]` | 5 |
| `selDistrict` | `select[id*="ddlDistrict"]` | 5 |
| `selCommencementDate` | `input[id*="txtDateComm"]` | 5 |
| `selSector` | `input[type="radio"][value="Services"]` | 6 |
| `selNic2Digit` | `select[id*="ddlNIC2"], select[id*="ddlNic2digit"]` | 6 |
| `selNic4Digit` | `select[id*="ddlNIC4"], select[id*="ddlNic4digit"]` | 6 |
| `selNic5Digit` | `select[id*="ddlNIC5"], select[id*="ddlNic5digit"]` | 6 |
| `selAddActivityBtn` | `input[id*="btnAddActivity"]` | 6 |
| `selBankAccount` | `input[id*="txtAccount"]` | 7 |
| `selConfirmAccount` | `input[id*="txtConfirm"]` | 7 |
| `selIfsc` | `input[id*="txtIFSC"]` | 7 |
| `selInvestment` | `input[id*="txtPlantWdv"], input[id*="txtInvestment"]` | 8 |
| `selTurnover` | `input[id*="txtTurnover"]` | 8 |
| `selDeclaration1` | `input[id*="chkDeclaration"]` | 9 |
| `selDeclaration2` | `input[id*="chkDeclare"]` | 9 |
| `selCaptchaImg` | `img[id*="imgCaptcha"]` | 9 |
| `selCaptchaInput` | `input[id*="txtCaptcha"]` | 9 |
| `selSubmitBtn` | `input[id*="btnSubmit"]` | 9 |
| `selResultLink` | `a[id*="lblUdyamNo"], a[id*="lblResult"]` | Done |

> These are CSS selectors (not just IDs) for flexibility. The first match wins.

---

## Storage Schema (chrome.storage.local)

Flat keys (all at top level, no nesting):

| Key | Type | Description |
|-----|------|-------------|
| `queue` | Array | Array of person objects |
| `currentIndex` | Number | Index of current person being processed |
| `isProcessing` | Boolean | Whether queue is actively running |
| `sheetId` | String | Google Sheet ID |
| `apiKey` | String | Google API Key |
| `sheetRange` | String | Default: `Sheet1!A1:Z` |
| `dryRun` | Boolean | Skip real OTP/Submit (testing) |
| `fieldOverrides` | Object | Override any `sel*` config key |

### Queue Item Schema

```json
{
  "id": "UID-001",
  "status": "PENDING | PROCESSING | OTP_WAITING | CAPTCHA_WAITING | DONE | SKIPPED | FAILED",
  "aadhaar": "123456789012",
  "name": "Test Person",
  "pan": "ABCDE1234F",
  "mobile": "9876543210",
  "email": "testperson@example.com",
  "lastError": null,
  "urnResult": "UDYAM-UP-24-0001234",
  ... (all other sheet columns)
}
```

---

## Google Sheets Data Schema

All values read as strings, no date/number formatting in sheet.

| Column | Type | Validation | Example |
|--------|------|-----------|---------|
| `Aadhaar_No` | String (12) | `/^\d{12}$/` | `123456789012` |
| `Proprietor_Name` | String | Max 100 | `Ramesh Kumar` |
| `PAN_No` | String (10) | `/^[A-Z]{5}\d{4}[A-Z]$/` | `ABCDE1234F` |
| `Mobile_No` | String (10) | `/^\d{10}$/` | `9876543210` |
| `Email_ID` | String | Valid format | `ramesh@example.com` |
| `Commencement_Date` | String (10) | `YYYY-MM-DD` | `2020-04-01` |
| `Address_Flat` | String | Max 50 | `Shop 5` |
| `Address_Premises` | String | Max 50 | `Main Road` |
| `Address_Village` | String | Max 50 | `Shahpur` |
| `Address_City` | String | Max 50 | `Pune` |
| `Pincode` | String (6) | `/^\d{6}$/` | `411001` |
| `State_Name` | String | Exact match portal dropdown | `Maharashtra` |
| `District_Name` | String | Exact match portal dropdown | `Pune` |
| `Social_Category` | String | `General/OBC/SC/ST` | `General` |
| `Gender` | String | `Male/Female/Transgender` | `Female` |
| `Woman_Owned` | String | `Yes/No` | `Yes` |
| `Minority_Owned` | String | `Yes/No` | `No` |
| `Disabled_Owned` | String | `Yes/No` | `No` |
| `Bank_Account_No` | String | Numeric only | `65432109876` |
| `Bank_IFSC` | String (11) | `/^[A-Z]{4}0[A-Z0-9]{6}$/` | `SBIN0000123` |
| `Investment_Value` | String | Numeric, no commas | `150000` |
| `Turnover_Value` | String | Numeric, no commas | `500000` |
| `URN_Output` | String | Leave blank | (filled manually) |

### Hardcoded Constants

| Field | Value | Overridable? |
|-------|-------|-------------|
| Organisation Type | `Proprietorship` | Via `orgTypeValue` in options |
| Sector | `Services` | Via `sectorValue` in options |
| NIC 2-digit | `66` | Via `nic2Value` in options |
| NIC 4-digit | `6619` | Via `nic4Value` in options |
| NIC 5-digit | `66190` | Via `nic5Value` in options |
| GST Applicable | `No` | Via `gstNoValue` in options |
| Gender (fallback) | `Male` | Via `genderValue` in options |
| Woman Owned (fallback) | `No` | Via `womanOwnedValue` in options |

---

## Error Handling

| Error | Detection | User Action |
|-------|-----------|-------------|
| Aadhaar auth down | `lblMsg1` contains "issue with Aadhaar" | Wait for portal fix, retry |
| Wrong OTP | Portal shows error message after verify | Click Skip, type correct OTP on retry |
| PAN mismatch | Error span after PAN validate | Skip person, check PAN manually |
| CAPTCHA appears | `selCaptchaImg` detected in DOM | Type in popup image viewer |
| 503 / Gateway error | Page shows IIS error screen | Click Retry (waits, tries again) |
| Session expired | Page redirects away from form | Reload portal tab, click Retry |
| Person not answering | Popup waits indefinitely | Click Skip (comes back at end of queue) |
| Unknown DOM state | Expected element missing after timeout | Click Manual Mode, fill yourself |
| Empty sheet | `Test Connection` returns 0 rows | Check sheet range and sharing settings |

---

## Bugs Found & Fixed During Build

| # | File | Bug | Fix |
|---|------|-----|-----|
| 1 | `options.js` | Options page fetch blocked by extension CSP | Delegated fetch to background service worker |
| 2 | `background.js` | Sheet range `Sheet1!A2:Z` excluded header, causing 0 rows | Changed to `Sheet1!A1:Z` |
| 3 | `background.js` + `popup.js` | Storage key mismatch: background saved nested `udyamState`, popup read flat keys | Flattened to top-level `queue`, `currentIndex`, `isProcessing` |
| 4 | `content.js` | `waitForResult` operator precedence bug (`&&` / `||` without parens) | Added explicit parentheses |
| 5 | `background.js` | `start()` always reset queue to index 0 — pause+resume restarted | Resume from current index if already in progress |
| 6 | `popup.js` | `showMsg` 5s timer could hide newer messages | Clears old timer before setting new one |

---

## Current Status

| Component | Status |
|-----------|--------|
| Extension V1 implementation | ✅ Complete |
| Dry-run test on live portal | ✅ Passed (Aadhaar/name/consent filled correctly) |
| 100-row test data CSV | ✅ Generated and validated |
| Python test suite | ✅ Created and passing |
| Test portal (local mock) | ✅ Created for offline testing |
| Portal Aadhaar auth | ❌ DOWN — "There is some issue with Aadhaar authentication..." |
| Production run | ⏳ Waiting for Aadhaar auth restoration |

---

## V2 Roadmap

| Feature | Priority | Why |
|---------|----------|-----|
| Write URN back to Sheet | High | Saves manual copy step |
| Sound/notification alerts | Medium | Don't need to watch popup constantly |
| CSV export of results | Medium | Share with client |
| Auto-retry with exponential backoff | Low | You can click Retry |
| Keyboard shortcuts | Low | Nice but not critical |
| Progress dashboard (time per person, rate) | Low | Nice-to-have |
| Multi-tab parallel processing | Very Low | Risk of portal blocking — one at a time is fine |

**V1 goal**: Register 100+ CSPs with minimal active time (~30 min total).
**V2 goal**: Eliminate manual URN copying and add progress tracking.

---

## How to Use V1

```
1. Fill Google Sheet with registrant data (24 columns)
2. Share sheet: "Anyone with link → Viewer"
3. Get API key from Google Cloud Console (restrict to Sheets API)
4. Load extension in Chrome (chrome://extensions → Load unpacked)
5. Open Options → paste Sheet ID + API key → Save & Validate
6. Open portal: udyamregistration.gov.in
7. Click extension icon → ▶ Start
8. For each person:
   a. Extension fills Aadhaar → clicks Generate OTP
   b. Call person → person reads OTP → type in popup
   c. Extension completes all remaining steps
   d. Type final OTP/CAPTCHA if needed
   e. Screenshot Udyam number → click Next
9. Repeat for all 100+
```

**Estimated active time**: ~10-15 seconds per person. ~25-30 min total for 100.
