// Content script — Udyam Registration DOM automation
// Runs on UdyamRegistration.aspx
// Fixed: detectStep, plant address, enterprise name, ITR/GSTIN radios,
//        investment fields, NIC cascade, bank name, activity radios,
//        declaration checkboxes, portal registrations, captcha, final OTP

// ===== Configuration =====
const CONFIG = {
  selAadhaar: 'ctl00_ContentPlaceHolder1_txtadharno',
  selName: 'ctl00_ContentPlaceHolder1_txtownername',
  selConsent: 'ctl00_ContentPlaceHolder1_chkDecarationA',
  selGenOtp: 'ctl00_ContentPlaceHolder1_btnValidateAadhaar',
  selMsg1: 'ctl00_ContentPlaceHolder1_lblMsg1',
  selMsg2: 'ctl00_ContentPlaceHolder1_lblMsg2',
  selUpan: 'ctl00_ContentPlaceHolder1_UpdatePaneldd1',
  selProgress: 'ctl00_ContentPlaceHolder1_UpdateProgress4',
  selResultLink: 'ctl00_ContentPlaceHolder1_btnNumberofUnit',
  otpPatterns: [/otp/i, /verification.?code/i],
  panPatterns: [/pan/i, /permanent.?account/i],
  captchaPatterns: [/captcha/i, /verification.?code/i],
  nicPatterns: [/nic/i, /classification/i],
  ifscPatterns: [/ifsc/i, /ifs.?code/i],
  submitPatterns: [/submit/i, /register/i, /save/i],
};

let currentPerson = null;
let currentConfig = {};
let isProcessing = false;
let currentStep = 'IDLE';
let observer = null;

// ===== Message Handler =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case 'processPerson':
      startProcessing(msg.person, msg.config);
      sendResponse({ ok: true });
      break;
    case 'ping':
      sendResponse({ ok: true, step: currentStep });
      break;
    case 'otpEntered':
      handleOtpInput(msg.otp);
      sendResponse({ ok: true });
      break;
    case 'resendOtp':
      handleResendOtp();
      sendResponse({ ok: true });
      break;
    case 'captchaEntered':
      handleCaptchaInput(msg.captcha);
      sendResponse({ ok: true });
      break;
    case 'finalOtpEntered':
      handleFinalOtpInput(msg.otp);
      sendResponse({ ok: true });
      break;
  }
  return true;
});

// ===== Processing Pipeline =====
async function startProcessing(person, config) {
  currentPerson = person;
  currentConfig = config || {};
  isProcessing = true;
  currentStep = 'STARTED';
  Object.keys(config).forEach(k => {
    if (k.startsWith('sel') && config[k]) CONFIG[k] = config[k];
  });
  startObserver();
  await run();
}

async function run() {
  if (!isProcessing) return;
  try {
    const step = detectStep();
    console.log('[UdyamHelper] Detected step:', step);
    switch (step) {
      case 'AADHAAR': await handleAadhaarStep(); break;
      case 'OTP': await handleOtpStep(); break;
      case 'PAN': await handlePanStep(); break;
      case 'ITR_GSTIN': await handleItrGstinStep(); break;
      case 'INVESTMENT': await handleInvestmentStep(); break;
      case 'BASIC_DETAILS': await handleBasicDetailsStep(); break;
      case 'ADDRESS': await handleAddressStep(); break;
      case 'PLANT': await handlePlantStep(); break;
      case 'STATUS_BANK': await handleStatusBankStep(); break;
      case 'NIC': await handleNicStep(); break;
      case 'EMPLOYMENT': await handleEmploymentStep(); break;
      case 'REGISTRATIONS': await handleRegistrationsStep(); break;
      case 'DECLARATION': await handleDeclarationStep(); break;
      case 'CAPTCHA_WAIT': await handleCaptchaStep(); break;
      case 'FINAL_OTP': await handleFinalOtpStep(); break;
      case 'DONE': await extractResult(); break;
      default:
        await sendFail('Unknown step: ' + step);
    }
  } catch (err) {
    console.error('[UdyamHelper] Error:', err);
    await sendFail(err.message || 'Error during processing');
  }
}

// ===== Step Detection (FIXED) =====
function detectStep() {
  // 1. Check if Aadhaar was ALREADY verified — success message present
  const msg1 = document.getElementById(CONFIG.selMsg1);
  const aadhaarVerified = msg1 && /successfully verified/i.test(msg1.innerText);

  // 2. Check for OTP input (Aadhaar OTP or Final OTP)
  const otpInput = findInputByPattern(CONFIG.otpPatterns, { maxlength: '6' });

  // 3. If Aadhaar field still exists but already verified → skip to PAN
  const aadhaarField = document.getElementById(CONFIG.selAadhaar);
  if (aadhaarField && aadhaarVerified) {
    // Aadhaar done, check if OTP is pending (Aadhaar OTP verification)
    if (otpInput && currentStep !== 'AADHAAR_DONE') return 'OTP';
    // If OTP was already done (step advanced past Aadhaar), go to PAN
    if (currentStep === 'AADHAAR_DONE' || currentStep === 'OTP_ENTERED') return 'PAN';
    // Check if PAN field exists
    const panInput = findInputByPattern(CONFIG.panPatterns);
    if (panInput) return 'PAN';
    return 'PAN'; // Default after Aadhaar verified
  }

  // 4. Aadhaar field exists, NOT verified → Aadhaar step
  if (aadhaarField && !aadhaarVerified) return 'AADHAAR';

  // 5. OTP field visible → OTP step
  if (otpInput) {
    if (currentStep === 'FINAL_OTP_DONE') return 'DECLARATION';
    if (currentStep === 'CAPTCHA_DONE') return 'FINAL_OTP';
    return 'OTP';
  }

  // 6. PAN field exists
  const panInput = findInputByPattern(CONFIG.panPatterns);
  if (panInput) {
    // Check if PAN was verified
    const panVerified = document.body.innerText.includes('PAN has been successfully verified');
    if (!panVerified) return 'PAN';
    // PAN verified — check ITR/GSTIN radios
    const itrRadios = document.querySelectorAll('input[type="radio"][name*="ITR" i], input[type="radio"][name*="itr" i]');
    if (itrRadios.length > 0) return 'ITR_GSTIN';
    return 'PAN';
  }

  // 7. ITR/GSTIN radios
  const itrRadios = document.querySelectorAll('input[type="radio"][name*="ITR" i], input[type="radio"][name*="itr" i]');
  if (itrRadios.length > 0) return 'ITR_GSTIN';

  // 8. Investment fields (WDV, Exclusion)
  const wdvField = document.querySelector('input[id*="Wdv" i], input[id*="wdv" i], input[id*="WrittenDown" i]');
  if (wdvField) return 'INVESTMENT';

  // 9. Basic details — Social Category radio
  const catRadios = document.querySelectorAll('input[type="radio"][name*="Category" i], input[type="radio"][name*="Social" i]');
  if (catRadios.length > 0) return 'BASIC_DETAILS';

  // 10. Address fields — Flat/Door/Block
  const addrField = document.querySelector('input[placeholder*="Flat" i], input[id*="Flat" i], input[placeholder*="Door" i]');
  if (addrField) {
    // Check if Plant Address section visible
    const plantTable = document.querySelector('table[id*="Plant" i], table[id*="Unit" i], div[id*="Plant" i]');
    if (plantTable) return 'PLANT';
    return 'ADDRESS';
  }

  // 11. Plant Add button
  const addBtn = document.querySelector('input[type="submit"][value*="Add" i], input[type="button"][value*="Add" i], button[id*="Add" i]');
  if (addBtn && addBtn.offsetParent !== null) return 'PLANT';

  // 12. Status of Enterprise — Date of Incorporation
  const incDateField = document.querySelector('input[id*="Incorporation" i], input[id*="DateofIncorp" i], input[placeholder*="DD/MM/YYYY" i]');
  if (incDateField) return 'STATUS_BANK';

  // 13. Bank fields
  const ifscField = document.querySelector('input[id*="IFSC" i], input[id*="ifsc" i], input[placeholder*="IFSC" i]');
  if (ifscField) return 'STATUS_BANK';

  // 14. NIC dropdowns
  const nicSelects = document.querySelectorAll('select[id*="NIC" i], select[id*="nic" i]');
  if (nicSelects.length > 0) {
    // Check if NIC already selected
    const nicTable = document.querySelector('table[id*="NIC" i], table[id*="nic" i]');
    if (nicTable) return 'EMPLOYMENT'; // NIC done, go to employment
    return 'NIC';
  }

  // 15. Employment fields
  const empField = document.querySelector('input[id*="Male" i], input[id*="Female" i], input[id*="Others" i]');
  if (empField) {
    // Check if it's the employment section (persons employed)
    const empLabel = document.body.innerText.includes('Number of persons employed');
    if (empLabel) return 'EMPLOYMENT';
  }

  // 16. Child Labour checkbox
  const childLabCheckbox = document.querySelector('input[type="checkbox"][id*="Child" i], input[type="checkbox"][id*="Labour" i]');
  if (childLabCheckbox) return 'REGISTRATIONS';

  // 17. Declaration checkboxes
  const decCheckboxes = document.querySelectorAll('input[type="checkbox"]');
  for (const cb of decCheckboxes) {
    const label = cb.parentElement?.textContent || '';
    if (/declaration|declare|child|labour|adolescent/i.test(label)) return 'REGISTRATIONS';
  }

  // 18. Submit button
  const submitBtns = document.querySelectorAll('input[type="submit"][value*="Submit" i], input[type="submit"][value*="Register" i]');
  for (const btn of submitBtns) {
    if (btn.offsetParent !== null && /submit|register/i.test(btn.value)) {
      // Check if CAPTCHA is visible
      const captchaImg = document.querySelector('img[id*="Captcha" i], img[id*="captcha" i], img[src*="Captcha" i]');
      if (captchaImg && captchaImg.offsetParent !== null) return 'CAPTCHA_WAIT';
      // Check if OTP modal is visible
      const otpModal = document.querySelector('.modal, [id*="OTP" i][id*="Modal" i], [id*="otp" i].modal');
      if (otpModal && otpModal.offsetParent !== null) return 'FINAL_OTP';
      return 'DECLARATION';
    }
  }

  // 19. OTP modal visible
  const otpModal = document.querySelector('.modal[style*="display: block"], [id*="OTP" i][style*="display: block"]');
  if (otpModal) return 'FINAL_OTP';

  // 20. Check for Udyam number
  const bodyText = document.body.innerText || '';
  if (/UDYAM[-][A-Z]{2}[-]\d{2}[-]\d{7,}/.test(bodyText) || bodyText.includes('Congratulations')) return 'DONE';

  return 'UNKNOWN';
}

// ===== Step Handlers =====

async function handleAadhaarStep() {
  sendUpdate('AADHAAR_FILL', 'Filling Aadhaar...');
  await sleep(getDelay());
  await setInput(CONFIG.selAadhaar, currentPerson.Aadhaar_No || '');
  await sleep(getDelay());
  await setInput(CONFIG.selName, currentPerson.Proprietor_Name || currentPerson.name || '');
  await sleep(getDelay());
  const consent = document.getElementById(CONFIG.selConsent);
  if (consent && !consent.checked) {
    consent.checked = true;
    dispatchEvent(consent, 'change');
  }
  await sleep(300);
  const msg1 = document.getElementById(CONFIG.selMsg1);
  if (msg1 && msg1.innerText.includes('issue with Aadhaar')) {
    await sendFail('Aadhaar authentication is down. Cannot proceed.');
    return;
  }
  if (currentConfig.dryRun) {
    await sendFail('Dry-run: Aadhaar form filled. Click Retry when ready for real run.');
    return;
  }
  await sleep(getDelay());
  currentStep = 'AADHAAR_DONE';
  const btn = document.getElementById(CONFIG.selGenOtp);
  if (btn) {
    btn.click();
    await waitForMutation(() => {
      const errEl = document.getElementById(CONFIG.selMsg1);
      if (errEl && errEl.innerText.includes('issue')) return 'ERROR';
      const otp = findInputByPattern(CONFIG.otpPatterns, { maxlength: '6' });
      if (otp) return 'OTP_READY';
      const verified = errEl && /successfully verified/i.test(errEl.innerText);
      if (verified) return 'VERIFIED';
      return null;
    }, 15000);
    const errEl = document.getElementById(CONFIG.selMsg1);
    if (errEl && errEl.innerText.length > 0 && !errEl.innerText.includes('OTP') && !errEl.innerText.includes('successfully')) {
      await sendFail('Aadhaar error: ' + errEl.innerText.slice(0, 100));
      return;
    }
    // If already verified without OTP (some portals auto-verify)
    if (errEl && /successfully verified/i.test(errEl.innerText)) {
      currentStep = 'OTP_ENTERED';
      await run();
      return;
    }
  }
  await waitForOtpField();
}

async function waitForOtpField() {
  currentStep = 'OTP_WAIT';
  for (let i = 0; i < 30; i++) {
    const otpInput = findInputByPattern(CONFIG.otpPatterns, { maxlength: '6' });
    if (otpInput) {
      sendUpdate('OTP_READY', 'OTP field detected');
      await notifyBackground('otpWaiting');
      return;
    }
    const captcha = document.getElementById(CONFIG.selCaptcha || 'ctl00_ContentPlaceHolder1_imgCaptcha');
    if (captcha && captcha.offsetParent !== null) {
      await sendFail('Login CAPTCHA detected. Wrong page?');
      return;
    }
    await sleep(500);
  }
  sendUpdate('OTP_WAIT', 'OTP field not found automatically. Check page.');
  await notifyBackground('otpWaiting');
}

async function handleOtpStep() {
  // OTP input exists — user needs to provide it via popup
  currentStep = 'OTP_WAIT';
  await notifyBackground('otpWaiting');
}

function handleOtpInput(otp) {
  const otpInput = findInputByPattern(CONFIG.otpPatterns, { maxlength: '6' })
    || document.querySelector('input[maxlength="6"][type="text"]:not([id*="Captcha" i]):not([id*="captcha" i])');
  if (!otpInput) {
    sendFail('OTP input field not found on page');
    return;
  }
  otpInput.value = otp;
  dispatchEvent(otpInput, 'input');
  dispatchEvent(otpInput, 'change');
  const verifyBtn = findVerifyButton();
  if (verifyBtn) {
    setTimeout(() => verifyBtn.click(), 300);
    currentStep = 'OTP_ENTERED';
    sendUpdate('OTP_ENTERED', 'OTP submitted, waiting for next step...');
    waitForNextStep(10000);
  } else {
    currentStep = 'OTP_ENTERED';
    setTimeout(() => {
      const anyBtn = document.querySelector('input[type="submit"]:not([id*="Captcha" i]):not([id*="captcha" i])');
      if (anyBtn) anyBtn.click();
    }, 500);
    waitForNextStep(10000);
  }
}

function handleResendOtp() {
  const resendLink = document.querySelector('a[onclick*="Resend" i], a[onclick*="resend" i], span[id*="Resend" i], a[id*="Resend" i]');
  if (resendLink) {
    resendLink.click();
  } else {
    const btn = document.getElementById(CONFIG.selGenOtp);
    if (btn) btn.click();
  }
}

async function handlePanStep() {
  sendUpdate('PAN_FILL', 'Filling PAN...');
  await sleep(getDelay());

  // Select Organisation Type = Proprietorship
  const orgSelects = document.querySelectorAll('select[id*="Org" i], select[id*="Constitution" i], select[id*="Type" i], select[name*="Org" i]');
  for (const sel of orgSelects) {
    const opts = sel.querySelectorAll('option');
    for (const opt of opts) {
      if (opt.textContent.toLowerCase().includes('proprietor') || opt.textContent.toLowerCase().includes('proprietary')) {
        sel.value = opt.value;
        dispatchEvent(sel, 'change');
        await sleep(getDelay());
        break;
      }
    }
  }

  // Fill PAN
  const panInput = findInputByPattern(CONFIG.panPatterns);
  if (panInput) {
    await setInputRaw(panInput, currentPerson.PAN_No || '');
    await sleep(500);
    const validateBtn = document.querySelector('input[type="submit"][value*="Validate" i], input[type="submit"][id*="Validate" i], input[type="submit"][id*="verify" i]');
    if (validateBtn) {
      validateBtn.click();
      sendUpdate('PAN_FILL', 'PAN submitted, waiting for verification...');
      await sleep(5000);
    }
  }

  // Wait for PAN verification to complete
  await waitForMutation(() => {
    const bodyText = document.body.innerText || '';
    if (bodyText.includes('PAN has been successfully verified')) return 'PAN_VERIFIED';
    return null;
  }, 15000);

  currentStep = 'PAN_DONE';
  await run();
}

// NEW: Handle ITR/GSTIN selection (4.2 and 4.3)
async function handleItrGstinStep() {
  sendUpdate('ITR_GSTIN', 'Setting ITR and GSTIN options...');
  await sleep(getDelay());

  // 4.2 ITR for PY 2024-25 = No (new business, no previous filing)
  const itrRadios = document.querySelectorAll('input[type="radio"]');
  for (const radio of itrRadios) {
    const name = (radio.name || '').toLowerCase();
    const parentText = (radio.parentElement?.textContent || '').toLowerCase();
    const val = (radio.value || '').toLowerCase();
    if (name.includes('itr') || parentText.includes('itr')) {
      if (val === 'no' || val === '2' || parentText.includes('no')) {
        radio.checked = true;
        dispatchEvent(radio, 'change');
        await sleep(300);
        break;
      }
    }
  }

  await sleep(getDelay());

  // 4.3 GSTIN = No (CSP services exempt)
  for (const radio of itrRadios) {
    const name = (radio.name || '').toLowerCase();
    const parentText = (radio.parentElement?.textContent || '').toLowerCase();
    const val = (radio.value || '').toLowerCase();
    if (name.includes('gst') || name.includes('gstin') || parentText.includes('gstin')) {
      if (val === 'no' || val === '2' || parentText.includes('no')) {
        radio.checked = true;
        dispatchEvent(radio, 'change');
        await sleep(300);
        break;
      }
    }
  }

  // Wait for Investment section to appear after selecting ITR=No
  await sleep(2000);
  currentStep = 'ITR_GSTIN_DONE';
  await run();
}

// NEW: Handle Investment fields (WDV, Exclusion, Net Investment, Turnover)
async function handleInvestmentStep() {
  sendUpdate('INVESTMENT_FILL', 'Filling investment & turnover...');
  await sleep(getDelay());

  // WDV (A) = Investment value
  const wdvField = document.querySelector('input[id*="Wdv" i], input[id*="wdv" i], input[id*="WrittenDown" i]');
  if (wdvField && currentPerson.Investment_Value) {
    await setInputRaw(wdvField, String(currentPerson.Investment_Value));
    await sleep(500);
  }

  // Exclusion (B) = 0 (no exclusions for CSP)
  const exclField = document.querySelector('input[id*="Exclusion" i], input[id*="exclusion" i], input[id*="Pollution" i]');
  if (exclField) {
    await setInputRaw(exclField, '0');
    await sleep(500);
  }

  // Net Investment is auto-calculated [(A)-(B)]
  // Total Turnover
  const turnFields = document.querySelectorAll('input[id*="Turnover" i], input[id*="turnover" i], input[placeholder*="Turnover" i]');
  for (const f of turnFields) {
    const id = (f.id || '').toLowerCase();
    const name = (f.name || '').toLowerCase();
    if (id.includes('export') || name.includes('export')) continue; // Skip export turnover
    if (id.includes('net') || name.includes('net')) continue; // Net is auto-calculated
    // Total Turnover field
    if (!f.value || f.value === '0' || f.value === '') {
      await setInputRaw(f, String(currentPerson.Turnover_Value || '0'));
      await sleep(500);
    }
  }

  // Export Turnover = 0
  for (const f of turnFields) {
    const id = (f.id || '').toLowerCase();
    const name = (f.name || '').toLowerCase();
    if (id.includes('export') || name.includes('export')) {
      await setInputRaw(f, '0');
      await sleep(300);
      break;
    }
  }

  // Tab out to trigger calculation
  await sleep(1000);
  currentStep = 'INVESTMENT_DONE';
  await run();
}

// NEW: Handle Basic Details (Enterprise Name, Mobile, Email, Category, Gender)
async function handleBasicDetailsStep() {
  sendUpdate('BASIC_DETAILS', 'Filling basic details...');
  await sleep(getDelay());

  // Enterprise Name — auto-filled from PAN but editable
  const enterpriseInput = document.querySelector('input[id*="EnterpriseName" i], input[id*="UnitName" i], input[id*="BusinessName" i]');
  if (enterpriseInput && !enterpriseInput.disabled) {
    // Only set if empty or if we have a specific name
    if (!enterpriseInput.value || enterpriseInput.value.trim() === '') {
      await setInputRaw(enterpriseInput, currentPerson.Proprietor_Name || 'Enterprise');
    }
  }

  // Mobile
  const mobFields = document.querySelectorAll('input[id*="Mobile" i], input[id*="mobile" i], input[placeholder*="Mobile" i]');
  for (const f of mobFields) {
    if (currentPerson.Mobile_No && !f.disabled) {
      await setInputRaw(f, currentPerson.Mobile_No);
    }
    break;
  }

  // Email
  const emailFields = document.querySelectorAll('input[type="email"], input[id*="Email" i], input[id*="email" i], input[placeholder*="Email" i]');
  for (const f of emailFields) {
    if (currentPerson.Email_ID && !f.disabled) {
      await setInputRaw(f, currentPerson.Email_ID);
    }
    break;
  }

  // Social Category — radio buttons
  const cat = currentPerson.Social_Category || 'General';
  const catRadios = document.querySelectorAll('input[type="radio"]');
  for (const radio of catRadios) {
    const parentText = (radio.parentElement?.textContent || '').trim();
    const name = (radio.name || '').toLowerCase();
    if (name.includes('category') || name.includes('social')) {
      if (parentText.toLowerCase().includes(cat.toLowerCase())) {
        radio.checked = true;
        dispatchEvent(radio, 'change');
        await sleep(300);
        break;
      }
    }
  }

  // Gender — radio buttons
  const gender = currentPerson.Gender || 'Male';
  for (const radio of catRadios) {
    const parentText = (radio.parentElement?.textContent || '').trim();
    const name = (radio.name || '').toLowerCase();
    if (name.includes('gender')) {
      if (parentText.toLowerCase().includes(gender.toLowerCase())) {
        radio.checked = true;
        dispatchEvent(radio, 'change');
        await sleep(300);
        break;
      }
    }
  }

  // Specially Abled = No
  for (const radio of catRadios) {
    const parentText = (radio.parentElement?.textContent || '').trim();
    const name = (radio.name || '').toLowerCase();
    if (name.includes('divyang') || name.includes('specially') || name.includes('abled')) {
      if (parentText.toLowerCase().includes('no')) {
        radio.checked = true;
        dispatchEvent(radio, 'change');
        await sleep(300);
        break;
      }
    }
  }

  await sleep(getDelay());
  currentStep = 'BASIC_DETAILS_DONE';
  await run();
}

// NEW: Handle Official Address
async function handleAddressStep() {
  sendUpdate('ADDRESS_FILL', 'Filling address...');
  await sleep(getDelay());

  const addrMap = [
    { patterns: [/flat/i, /door/i, /block/i], value: currentPerson.Address_Flat || '' },
    { patterns: [/premises/i, /building/i], value: currentPerson.Address_Premises || '' },
    { patterns: [/village/i, /town/i], value: currentPerson.Address_Village || '' },
    { patterns: [/road/i, /street/i, /lane/i], value: currentPerson.Address_Street || '' },
    { patterns: [/city/i], value: currentPerson.Address_City || '' },
    { patterns: [/pin/i, /pincode/i], value: currentPerson.Pincode || '' },
  ];

  const allInputs = document.querySelectorAll('input[type="text"]');
  for (const field of addrMap) {
    if (!field.value) continue;
    for (const inp of allInputs) {
      const id = (inp.id || '').toLowerCase();
      const ph = (inp.placeholder || '').toLowerCase();
      const name = (inp.name || '').toLowerCase();
      for (const pat of field.patterns) {
        if (pat.test(id) || pat.test(ph) || pat.test(name)) {
          if (!inp.disabled && inp.offsetParent !== null) {
            await setInputRaw(inp, field.value);
            break;
          }
        }
      }
    }
  }

  // State dropdown
  if (currentPerson.State_Name) {
    const stateSelects = document.querySelectorAll('select[id*="State" i], select[name*="State" i]');
    for (const sel of stateSelects) {
      if (selectOptionByText(sel, currentPerson.State_Name)) {
        dispatchEvent(sel, 'change');
        await sleep(3000); // Wait for district cascade via ASP.NET __doPostBack
        break;
      }
    }
  }

  // District dropdown
  if (currentPerson.District_Name) {
    const distSelects = document.querySelectorAll('select[id*="District" i], select[name*="District" i]');
    for (const sel of distSelects) {
      if (selectOptionByText(sel, currentPerson.District_Name)) {
        dispatchEvent(sel, 'change');
        await sleep(1000);
        break;
      }
    }
  }

  // BIADA Area = No
  const biadaRadios = document.querySelectorAll('input[type="radio"]');
  for (const radio of biadaRadios) {
    const parentText = (radio.parentElement?.textContent || '').toLowerCase();
    const name = (radio.name || '').toLowerCase();
    if (name.includes('biada') || parentText.includes('biada')) {
      if (parentText.includes('no')) {
        radio.checked = true;
        dispatchEvent(radio, 'change');
        await sleep(300);
        break;
      }
    }
  }

  // DIC dropdown
  if (currentPerson.District_Name) {
    const dicSelects = document.querySelectorAll('select[id*="DIC" i], select[id*="dic" i], select[name*="DIC" i]');
    for (const sel of dicSelects) {
      if (selectOptionByText(sel, currentPerson.District_Name)) {
        dispatchEvent(sel, 'change');
        await sleep(500);
        break;
      }
    }
  }

  await sleep(getDelay());
  currentStep = 'ADDRESS_DONE';
  await run();
}

// NEW: Handle Plant Address — click Add button, fill fields, save
async function handlePlantStep() {
  sendUpdate('PLANT_FILL', 'Adding plant address...');
  await sleep(getDelay());

  // Check if there's an Add button for Plant
  const addBtns = document.querySelectorAll('input[type="submit"][value*="Add" i], input[type="button"][value*="Add" i], button[id*="Add" i]');
  let addBtn = null;
  for (const btn of addBtns) {
    if (btn.offsetParent !== null && /add/i.test(btn.value || btn.textContent)) {
      addBtn = btn;
      break;
    }
  }

  if (addBtn) {
    addBtn.click();
    await sleep(2000); // Wait for modal/add form to appear
  }

  // Fill Plant/Unit fields
  const plantAddrMap = [
    { patterns: [/flat/i, /door/i, /block/i], value: currentPerson.Address_Flat || '' },
    { patterns: [/premises/i, /building/i], value: currentPerson.Address_Premises || '' },
    { patterns: [/village/i, /town/i], value: currentPerson.Address_Village || '' },
    { patterns: [/road/i, /street/i, /lane/i], value: currentPerson.Address_Street || '' },
    { patterns: [/city/i], value: currentPerson.Address_City || '' },
    { patterns: [/pin/i, /pincode/i], value: currentPerson.Pincode || '' },
  ];

  const allInputs = document.querySelectorAll('input[type="text"]');
  for (const field of plantAddrMap) {
    if (!field.value) continue;
    for (const inp of allInputs) {
      const id = (inp.id || '').toLowerCase();
      const ph = (inp.placeholder || '').toLowerCase();
      for (const pat of field.patterns) {
        if (pat.test(id) || pat.test(ph)) {
          if (!inp.disabled && inp.offsetParent !== null) {
            await setInputRaw(inp, field.value);
            break;
          }
        }
      }
    }
  }

  // Plant State dropdown
  if (currentPerson.State_Name) {
    const stateSelects = document.querySelectorAll('select[id*="Plant" i][id*="State" i], select[id*="Unit" i][id*="State" i]');
    if (stateSelects.length === 0) {
      // Fallback — any state select not already filled
      const allStateSelects = document.querySelectorAll('select[id*="State" i]');
      for (const sel of allStateSelects) {
        if (sel.value && sel.value !== '0' && sel.value !== '') continue; // Already filled
        if (selectOptionByText(sel, currentPerson.State_Name)) {
          dispatchEvent(sel, 'change');
          await sleep(3000);
          break;
        }
      }
    } else {
      for (const sel of stateSelects) {
        if (selectOptionByText(sel, currentPerson.State_Name)) {
          dispatchEvent(sel, 'change');
          await sleep(3000);
          break;
        }
      }
    }
  }

  // Plant District dropdown
  if (currentPerson.District_Name) {
    const distSelects = document.querySelectorAll('select[id*="Plant" i][id*="District" i], select[id*="Unit" i][id*="District" i]');
    if (distSelects.length === 0) {
      const allDistSelects = document.querySelectorAll('select[id*="District" i]');
      for (const sel of allDistSelects) {
        if (sel.value && sel.value !== '0' && sel.value !== '') continue;
        if (selectOptionByText(sel, currentPerson.District_Name)) {
          dispatchEvent(sel, 'change');
          await sleep(1000);
          break;
        }
      }
    } else {
      for (const sel of distSelects) {
        if (selectOptionByText(sel, currentPerson.District_Name)) {
          dispatchEvent(sel, 'change');
          await sleep(1000);
          break;
        }
      }
    }
  }

  // Save/Add the plant entry
  await sleep(1000);
  const saveBtn = document.querySelector('input[type="submit"][value*="Save" i], input[type="submit"][value*="Add" i], input[type="button"][value*="Save" i]');
  if (saveBtn && saveBtn.offsetParent !== null) {
    saveBtn.click();
    await sleep(2000);
  }

  await sleep(getDelay());
  currentStep = 'PLANT_DONE';
  await run();
}

// NEW: Handle Status of Enterprise + Bank Details
async function handleStatusBankStep() {
  sendUpdate('STATUS_BANK', 'Filling status & bank details...');
  await sleep(getDelay());

  // Date of Incorporation
  const incDateField = document.querySelector('input[id*="Incorporation" i], input[id*="DateofIncorp" i]');
  if (incDateField && currentPerson.Commencement_Date) {
    await setInputRaw(incDateField, currentPerson.Commencement_Date);
    await sleep(500);
  }

  // Business Commenced = Yes
  const commenceRadios = document.querySelectorAll('input[type="radio"]');
  for (const radio of commenceRadios) {
    const name = (radio.name || '').toLowerCase();
    const parentText = (radio.parentElement?.textContent || '').toLowerCase();
    if (name.includes('commence') || parentText.includes('commenced')) {
      if (parentText.includes('yes') || (radio.value || '').toLowerCase() === 'yes' || radio.value === '1') {
        radio.checked = true;
        dispatchEvent(radio, 'change');
        await sleep(500);
        break;
      }
    }
  }

  // Date of Commencement
  const commDateField = document.querySelector('input[id*="Commencement" i], input[id*="commencement" i]');
  if (commDateField && currentPerson.Commencement_Date) {
    await setInputRaw(commDateField, currentPerson.Commencement_Date);
    await sleep(500);
  }

  // Previous EM-II/UAM = N/A
  for (const radio of commenceRadios) {
    const name = (radio.name || '').toLowerCase();
    const parentText = (radio.parentElement?.textContent || '').toLowerCase();
    if (name.includes('em') || name.includes('uam') || parentText.includes('em-ii') || parentText.includes('uam')) {
      if (parentText.includes('n/a') || parentText.includes('na') || parentText.includes('not applicable')) {
        radio.checked = true;
        dispatchEvent(radio, 'change');
        await sleep(500);
        break;
      }
    }
  }

  await sleep(getDelay());

  // Bank Name
  const bankNameField = document.querySelector('input[id*="BankName" i], input[id*="bankname" i], input[placeholder*="Bank" i]');
  if (bankNameField) {
    await setInputRaw(bankNameField, 'STATE BANK OF INDIA');
    await sleep(500);
  }

  // IFSC
  const ifscField = document.querySelector('input[id*="IFSC" i], input[id*="ifsc" i], input[placeholder*="IFSC" i]');
  if (ifscField && currentPerson.Bank_IFSC) {
    await setInputRaw(ifscField, currentPerson.Bank_IFSC);
    await sleep(500);
  }

  // Bank Account
  const acctField = document.querySelector('input[id*="Account" i], input[id*="account" i], input[placeholder*="Account" i]');
  if (acctField && currentPerson.Bank_Account_No) {
    await setInputRaw(acctField, currentPerson.Bank_Account_No);
    await sleep(500);
  }

  // Major Activity = Services
  const majorActRadios = document.querySelectorAll('input[type="radio"]');
  for (const radio of majorActRadios) {
    const name = (radio.name || '').toLowerCase();
    const parentText = (radio.parentElement?.textContent || '').toLowerCase();
    if (name.includes('major') || name.includes('activity') || parentText.includes('major activity')) {
      if (parentText.includes('service')) {
        radio.checked = true;
        dispatchEvent(radio, 'change');
        await sleep(1000); // Wait for sub-category to appear
        break;
      }
    }
  }

  // Major Activity Under Services = Non-Trading
  await sleep(1000);
  for (const radio of majorActRadios) {
    const name = (radio.name || '').toLowerCase();
    const parentText = (radio.parentElement?.textContent || '').toLowerCase();
    if (name.includes('trading') || parentText.includes('trading') || parentText.includes('non-trading')) {
      if (parentText.includes('non-trading') || parentText.includes('non trading')) {
        radio.checked = true;
        dispatchEvent(radio, 'change');
        await sleep(500);
        break;
      }
    }
  }

  await sleep(getDelay());
  currentStep = 'STATUS_BANK_DONE';
  await run();
}

// FIXED: NIC cascade — uses __doPostBack for ASP.NET UpdatePanel
async function handleNicStep() {
  sendUpdate('NIC_SET', 'Setting NIC 66190...');
  await sleep(getDelay());

  const nic2 = currentConfig.nic2 || '66';
  const nic4 = currentConfig.nic4 || '6619';
  const nic5 = currentConfig.nic5 || '66190';

  // Find NIC 2-digit dropdown
  const nicSelects = document.querySelectorAll('select[id*="NIC" i], select[id*="nic" i], select[name*="NIC" i]');
  let nic2Select = null;
  for (const sel of nicSelects) {
    const optValues = Array.from(sel.options).map(o => o.value);
    if (optValues.includes(nic2)) {
      nic2Select = sel;
      break;
    }
  }

  if (nic2Select) {
    nic2Select.value = nic2;
    // ASP.NET requires __doPostBack for UpdatePanel refresh
    triggerPostBack(nic2Select);
    await sleep(3000); // Wait for AJAX to load 4-digit options
  }

  // Find NIC 4-digit dropdown
  const nicSelects2 = document.querySelectorAll('select[id*="NIC" i], select[id*="nic" i], select[name*="NIC" i]');
  let nic4Select = null;
  for (const sel of nicSelects2) {
    const optValues = Array.from(sel.options).map(o => o.value);
    if (optValues.includes(nic4) && sel !== nic2Select) {
      nic4Select = sel;
      break;
    }
  }

  if (nic4Select) {
    nic4Select.value = nic4;
    triggerPostBack(nic4Select);
    await sleep(3000); // Wait for AJAX to load 5-digit options
  }

  // Find NIC 5-digit dropdown
  const nicSelects3 = document.querySelectorAll('select[id*="NIC" i], select[id*="nic" i], select[name*="NIC" i]');
  let nic5Select = null;
  for (const sel of nicSelects3) {
    const optValues = Array.from(sel.options).map(o => o.value);
    if (optValues.includes(nic5) && sel !== nic2Select && sel !== nic4Select) {
      nic5Select = sel;
      break;
    }
  }

  if (nic5Select) {
    nic5Select.value = nic5;
    triggerPostBack(nic5Select);
    await sleep(2000);
  }

  // Click "Add Activity" button
  await sleep(1000);
  const addBtns = document.querySelectorAll('input[type="submit"][value*="Add" i], input[type="button"][value*="Add" i], button[id*="Add" i]');
  for (const btn of addBtns) {
    if (btn.offsetParent !== null && /add/i.test(btn.value || btn.textContent)) {
      btn.click();
      await sleep(2000);
      break;
    }
  }

  await sleep(getDelay());
  currentStep = 'NIC_DONE';
  await run();
}

// NEW: Handle Employment fields
async function handleEmploymentStep() {
  sendUpdate('EMPLOYMENT_FILL', 'Filling employment details...');
  await sleep(getDelay());

  const emp = currentPerson.Employees || currentConfig.defaultEmployees || 1;

  // Find employment fields
  const empInputs = document.querySelectorAll('input[type="text"]');
  let maleSet = false, femaleSet = false, othersSet = false, totalSet = false;

  for (const inp of empInputs) {
    const id = (inp.id || '').toLowerCase();
    const name = (inp.name || '').toLowerCase();
    const ph = (inp.placeholder || '').toLowerCase();

    if (!maleSet && (id.includes('male') && !id.includes('female'))) {
      await setInputRaw(inp, '0');
      maleSet = true;
    } else if (!femaleSet && id.includes('female')) {
      await setInputRaw(inp, String(emp));
      femaleSet = true;
    } else if (!othersSet && id.includes('others')) {
      await setInputRaw(inp, '0');
      othersSet = true;
    } else if (!totalSet && id.includes('total')) {
      await setInputRaw(inp, String(emp));
      totalSet = true;
    }

    if (maleSet && femaleSet && othersSet && totalSet) break;
  }

  await sleep(getDelay());
  currentStep = 'EMPLOYMENT_DONE';
  await run();
}

// NEW: Handle Registration checkboxes + Declaration
async function handleRegistrationsStep() {
  sendUpdate('REGISTRATIONS', 'Setting registrations & declarations...');
  await sleep(getDelay());

  // Set GeM/TReDS/NCS/NSIC/Skill India to No
  const allRadios = document.querySelectorAll('input[type="radio"]');
  for (const radio of allRadios) {
    const name = (radio.name || '').toLowerCase();
    const parentText = (radio.parentElement?.textContent || '').toLowerCase();
    const val = (radio.value || '').toLowerCase();

    // Check if this is a registration question
    if (name.includes('gem') || name.includes('treds') || name.includes('ncs') ||
        name.includes('nsic') || name.includes('skill') || name.includes('nsc')) {
      if (val === 'no' || val === '2' || parentText.includes('no')) {
        radio.checked = true;
        dispatchEvent(radio, 'change');
        await sleep(200);
      }
    }
  }

  // Also handle via text matching (portal may use different name attributes)
  const questions = ['gem', 'treds', 'ncs', 'nsic', 'skill'];
  for (const q of questions) {
    for (const radio of allRadios) {
      const parentText = (radio.parentElement?.textContent || '').toLowerCase();
      if (parentText.includes(q)) {
        const name = (radio.name || '').toLowerCase();
        const siblings = document.querySelectorAll(`input[type="radio"][name="${radio.name}"]`);
        for (const sib of siblings) {
          const sibText = (sib.parentElement?.textContent || '').toLowerCase();
          if (sibText.includes('no') || sib.value === '2' || sib.value.toLowerCase() === 'no') {
            sib.checked = true;
            dispatchEvent(sib, 'change');
            break;
          }
        }
        break;
      }
    }
  }

  await sleep(getDelay());

  // Check Child Labour declaration
  const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
  for (const cb of allCheckboxes) {
    const label = cb.parentElement?.textContent || '';
    if (/child|labour|adolescent/i.test(label)) {
      if (!cb.checked) {
        cb.checked = true;
        dispatchEvent(cb, 'change');
      }
    }
  }

  // Check main declaration
  for (const cb of allCheckboxes) {
    const label = cb.parentElement?.textContent || '';
    if (/hereby declare|information given|true to the best/i.test(label)) {
      if (!cb.checked) {
        cb.checked = true;
        dispatchEvent(cb, 'change');
      }
    }
  }

  await sleep(getDelay());
  currentStep = 'REGISTRATIONS_DONE';
  await run();
}

// FIXED: Handle Declaration + CAPTCHA + Submit
async function handleDeclarationStep() {
  sendUpdate('DECLARED', 'Preparing to submit...');
  await sleep(getDelay());

  // Ensure all declarations are checked
  const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
  for (const cb of allCheckboxes) {
    if (!cb.checked) {
      cb.checked = true;
      dispatchEvent(cb, 'change');
    }
  }

  await sleep(500);

  // Check for CAPTCHA (verification code image)
  const captchaImg = document.querySelector('img[id*="Captcha" i], img[id*="captcha" i], img[src*="Captcha" i], img[src*="captcha" i]');
  if (captchaImg && captchaImg.offsetParent !== null) {
    currentStep = 'CAPTCHA_WAIT';
    await notifyBackground('captchaWaiting', { captchaSrc: captchaImg.src });
    return;
  }

  // No CAPTCHA, try submit
  await doSubmit();
}

// NEW: Handle CAPTCHA input
async function handleCaptchaStep() {
  currentStep = 'CAPTCHA_WAIT';
  await notifyBackground('captchaWaiting');
}

function handleCaptchaInput(captcha) {
  const captchaInput = document.querySelector('input[id*="Captcha" i], input[id*="captcha" i], input[placeholder*="Verification" i], input[placeholder*="Code" i]');
  if (captchaInput) {
    captchaInput.value = captcha;
    dispatchEvent(captchaInput, 'input');
    dispatchEvent(captchaInput, 'change');
    currentStep = 'CAPTCHA_DONE';
    sendUpdate('CAPTCHA_DONE', 'CAPTCHA submitted');
    setTimeout(() => doSubmit(), 500);
  }
}

// NEW: Handle Final OTP (after CAPTCHA submit)
async function handleFinalOtpStep() {
  currentStep = 'FINAL_OTP_WAIT';
  await notifyBackground('finalOtpWaiting');
}

function handleFinalOtpInput(otp) {
  // OTP modal — find the OTP input inside the modal
  const otpInput = document.querySelector('.modal input[maxlength="6"], [id*="OTP" i] input[maxlength="6"], input[id*="otpCode" i], input[id*="OTPCode" i]');
  if (!otpInput) {
    // Fallback — any maxlength=6 text input that's visible
    const allInputs = document.querySelectorAll('input[type="text"][maxlength="6"]');
    for (const inp of allInputs) {
      if (inp.offsetParent !== null) {
        inp.value = otp;
        dispatchEvent(inp, 'input');
        dispatchEvent(inp, 'change');
        currentStep = 'FINAL_OTP_DONE';
        sendUpdate('FINAL_OTP_DONE', 'Final OTP entered');
        setTimeout(() => doSubmit(), 500);
        return;
      }
    }
    sendFail('Final OTP input not found');
    return;
  }

  otpInput.value = otp;
  dispatchEvent(otpInput, 'input');
  dispatchEvent(otpInput, 'change');
  currentStep = 'FINAL_OTP_DONE';
  sendUpdate('FINAL_OTP_DONE', 'Final OTP entered');
  setTimeout(() => doSubmit(), 500);
}

// ===== Submit & Result =====

async function doSubmit() {
  sendUpdate('SUBMITTING', 'Submitting registration...');
  const submitBtns = document.querySelectorAll('input[type="submit"]');
  for (const btn of submitBtns) {
    const val = (btn.value || '').toLowerCase();
    if ((val.includes('submit') || val.includes('register') || val.includes('final')) && btn.offsetParent !== null) {
      btn.click();
      await sleep(5000);
      break;
    }
  }
  // After submit, wait for either OTP modal or result
  await waitForResult(20000);
}

async function waitForResult(timeout) {
  for (let i = 0; i < timeout / 500; i++) {
    const bodyText = document.body.innerText || '';
    // Check for Udyam number
    const match = bodyText.match(/UDYAM[-][A-Z]{2}[-]\d{2}[-]\d{7,9}/);
    if (match) {
      await notifyDone(match[0]);
      return;
    }
    if (bodyText.includes('Congratulations') || bodyText.includes('successfully registered')) {
      const m2 = bodyText.match(/UDYAM[-]\w{2}[-]\d{2}[-]\d{7,}/);
      if (m2) {
        await notifyDone(m2[0]);
        return;
      }
      await notifyDone('SUCCESS');
      return;
    }
    // Check for OTP modal (final submit needs OTP)
    const otpModal = document.querySelector('.modal[style*="display: block"], [id*="OTP" i][style*="display: block"]');
    if (otpModal) {
      currentStep = 'FINAL_OTP_WAIT';
      await notifyBackground('finalOtpWaiting');
      return;
    }
    // Check for error
    const msgEl = document.getElementById(CONFIG.selMsg1);
    if (msgEl && (msgEl.innerText.includes('error') || msgEl.innerText.includes('already') || msgEl.innerText.includes('invalid'))) {
      await sendFail(msgEl.innerText.slice(0, 200));
      return;
    }
    await sleep(500);
  }
  await sendFail('Result not detected within timeout');
}

async function extractResult() {
  const bodyText = document.body.innerText || '';
  const match = bodyText.match(/UDYAM[-][A-Z]{2}[-]\d{2}[-]\d{7,9}/);
  if (match) {
    await notifyDone(match[0]);
  } else {
    await notifyDone('UDYAM_NUMBER_FOUND');
  }
}

// ===== Helpers =====

async function setInput(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  return setInputRaw(el, value);
}

async function setInputRaw(el, value) {
  el.value = value;
  dispatchEvent(el, 'focus');
  dispatchEvent(el, 'input');
  dispatchEvent(el, 'change');
  dispatchEvent(el, 'blur');
  await sleep(100);
}

function dispatchEvent(el, type) {
  const event = new Event(type, { bubbles: true });
  el.dispatchEvent(event);
}

// NEW: Trigger ASP.NET __doPostBack for UpdatePanel refresh
function triggerPostBack(element) {
  const target = element.id || element.name;
  if (typeof __doPostBack === 'function') {
    __doPostBack(target, '');
  } else {
    // Fallback — dispatch change event
    dispatchEvent(element, 'change');
  }
}

function findInputByPattern(patterns, attrs = {}) {
  const inputs = document.querySelectorAll('input[type="text"]');
  for (const input of inputs) {
    if (input.offsetParent === null) continue;
    const id = (input.id || '').toLowerCase();
    const ph = (input.placeholder || '').toLowerCase();
    const name = (input.name || '').toLowerCase();

    let matchAttrs = true;
    for (const [k, v] of Object.entries(attrs)) {
      if (input.getAttribute(k) !== v) { matchAttrs = false; break; }
    }
    if (!matchAttrs) continue;

    for (const pattern of patterns) {
      if (pattern.test(id) || pattern.test(ph) || pattern.test(name)) {
        return input;
      }
    }
  }
  return null;
}

function findVerifyButton() {
  const patterns = [/verify/i, /validate/i, /submit/i, /otp/i, /ok/i];
  const buttons = document.querySelectorAll('input[type="submit"], button[type="submit"]');
  for (const btn of buttons) {
    const val = (btn.value || btn.textContent || '').toLowerCase();
    const id = (btn.id || '').toLowerCase();
    for (const p of patterns) {
      if (p.test(val) || p.test(id)) return btn;
    }
  }
  for (const btn of buttons) {
    if (btn.offsetParent !== null) return btn;
  }
  return null;
}

function selectOptionByText(select, text) {
  const opts = Array.from(select.options);
  for (const opt of opts) {
    if (opt.textContent.trim().toLowerCase() === text.trim().toLowerCase()) {
      select.value = opt.value;
      dispatchEvent(select, 'change');
      return true;
    }
  }
  for (const opt of opts) {
    if (opt.textContent.trim().toLowerCase().includes(text.trim().toLowerCase())) {
      select.value = opt.value;
      dispatchEvent(select, 'change');
      return true;
    }
  }
  return false;
}

function getDelay() {
  return (currentConfig.actionDelay || 800) + Math.random() * 300;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function startObserver() {
  const upanel = document.getElementById(CONFIG.selUpan);
  if (!upanel) return;
  observer = new MutationObserver((mutations) => {
    if (isProcessing && currentStep !== 'OTP_WAIT' && currentStep !== 'CAPTCHA_WAIT' && currentStep !== 'FINAL_OTP_WAIT') {
      // Don't auto-advance during human wait states
    }
  });
  observer.observe(upanel, { childList: true, subtree: true, characterData: true });
}

async function waitForMutation(checkFn, timeout) {
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const result = checkFn();
      if (result) {
        clearInterval(interval);
        resolve(result);
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        resolve(null);
      }
    }, 300);
  });
}

async function waitForNextStep(timeout) {
  await sleep(1500);
  const onWrongPage = !window.location.href.includes('UdyamRegistration.aspx');
  if (onWrongPage) {
    await sendFail('Session expired or redirected. Reload and retry.');
    return;
  }
}

async function sendUpdate(status, detail) {
  currentStep = status;
  chrome.runtime.sendMessage({
    action: 'stepUpdate',
    step: status,
    status: status,
    detail: detail
  }).catch(() => {});
}

async function notifyBackground(type, extra = {}) {
  chrome.runtime.sendMessage({
    action: type,
    ...extra
  }).catch(() => {});
}

async function notifyDone(udyamNumber) {
  currentStep = 'DONE';
  isProcessing = false;
  chrome.runtime.sendMessage({
    action: 'personDone',
    udyamNumber: udyamNumber
  }).catch(() => {});
}

async function sendFail(error) {
  currentStep = 'FAILED';
  isProcessing = false;
  chrome.runtime.sendMessage({
    action: 'personFailed',
    error: error
  }).catch(() => {});
}

console.log('Udyam CSP Helper content script loaded. Waiting for commands...');
