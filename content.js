// Content script — Udyam Registration DOM automation
// Runs on UdyamRegistration.aspx

// ===== Configuration =====
const CONFIG = {
  // Confirmed Step 1 IDs
  selAadhaar: 'ctl00_ContentPlaceHolder1_txtadharno',
  selName: 'ctl00_ContentPlaceHolder1_txtownername',
  selConsent: 'ctl00_ContentPlaceHolder1_chkDecarationA',
  selGenOtp: 'ctl00_ContentPlaceHolder1_btnValidateAadhaar',
  // Error/label elements
  selMsg1: 'ctl00_ContentPlaceHolder1_lblMsg1',
  selMsg2: 'ctl00_ContentPlaceHolder1_lblMsg2',
  selUpan: 'ctl00_ContentPlaceHolder1_UpdatePaneldd1',
  selProgress: 'ctl00_ContentPlaceHolder1_UpdateProgress4',
  selResultLink: 'ctl00_ContentPlaceHolder1_btnNumberofUnit',

  // Steps 2-8: configurable via options
  // These are our best guesses + will be auto-detected
  otpPatterns: [/otp/i, /verification.?code/i],
  panPatterns: [/pan/i, /permanent.?account/i],
  captchaPatterns: [/captcha/i, /verification.?code/i],
  nicPatterns: [/nic/i, /classification/i],
  ifscPatterns: [/ifsc/i, /ifs.?code/i],
  submitPatterns: [/submit/i, /register/i, /save/i],
};

// ===== State =====
let currentPerson = null;
let currentConfig = {};
let isProcessing = false;
let currentStep = 'IDLE';
let observer = null;

// ===== Main Entry =====
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

  // Merge config overrides into CONFIG
  Object.keys(config).forEach(k => {
    if (k.startsWith('sel') && config[k]) CONFIG[k] = config[k];
  });

  // Start MutationObserver for UpdatePanel changes
  startObserver();

  // Begin step machine
  await run();
}

async function run() {
  if (!isProcessing) return;

  try {
    const step = detectStep();

    switch (step) {
      case 'AADHAAR':
        await handleAadhaarStep();
        break;
      case 'OTP':
        await handleOtpStep();
        break;
      case 'PAN':
        await handlePanStep();
        break;
      case 'GST':
        await handleGstStep();
        break;
      case 'BUSINESS':
        await handleBusinessStep();
        break;
      case 'NIC':
        await handleNicStep();
        break;
      case 'BANK':
        await handleBankStep();
        break;
      case 'FINANCIAL':
        await handleFinancialStep();
        break;
      case 'DECLARATION':
        await handleDeclarationStep();
        break;
      case 'SUBMIT':
        await handleSubmitStep();
        break;
      case 'DONE':
        await extractResult();
        break;
      default:
        await sendFail('Unknown page step: ' + step);
    }
  } catch (err) {
    await sendFail(err.message || 'Error during processing');
  }
}

// ===== Step Detection =====
function detectStep() {
  // Step 1: Aadhaar
  if (document.getElementById(CONFIG.selAadhaar)) return 'AADHAAR';

  // Step 2: OTP (Aadhaar OTP input) — detect by finding new text input after Aadhaar panel
  const otpInput = findInputByPattern(CONFIG.otpPatterns, { maxlength: '6' });
  if (otpInput && currentStep === 'AADHAAR_DONE') return 'OTP';

  // Step 3: PAN
  const panInput = findInputByPattern(CONFIG.panPatterns);
  if (panInput) return 'PAN';

  // Step 4: GST radio
  const gstRadios = document.querySelectorAll('input[type="radio"][name*="GST" i], input[type="radio"][name*="gst" i]');
  if (gstRadios.length > 0) return 'GST';

  // Step 5: Business details — look for address or enterprise name fields
  const addrInputs = document.querySelectorAll('input[placeholder*="Address" i], input[id*="Address" i], input[id*="Enterprise" i], input[id*="Unit" i]');
  if (addrInputs.length > 0) return 'BUSINESS';

  // Step 6: NIC
  const nicSelects = document.querySelectorAll('select[id*="NIC" i], select[id*="nic" i], select[name*="NIC" i]');
  if (nicSelects.length > 0) return 'NIC';

  // Step 7: Bank
  const bankInputs = document.querySelectorAll('input[placeholder*="IFSC" i], input[id*="IFSC" i], input[id*="Account" i], input[id*="Bank" i]');
  if (bankInputs.length > 0) return 'BANK';

  // Step 8: Financial (investment/turnover)
  const finInputs = document.querySelectorAll('input[placeholder*="Investment" i], input[placeholder*="Turnover" i], input[id*="Investment" i], input[id*="Turnover" i]');
  if (finInputs.length > 0) return 'FINANCIAL';

  // Step 9: Declaration + Submit
  const decCheckboxes = document.querySelectorAll('input[type="checkbox"][id*="Declaration" i], input[type="checkbox"][id*="Declare" i]');
  const submitBtns = document.querySelectorAll('input[type="submit"][value*="Submit" i], input[type="submit"][value*="Register" i]');
  if (decCheckboxes.length > 0 || submitBtns.length > 0) return 'DECLARATION';

  // Check if already done — look for Udyam number text
  const bodyText = document.body.innerText || '';
  if (bodyText.includes('Udyam Registration Number') || bodyText.includes('UDYAM-')) return 'DONE';

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

  // Check for Aadhaar auth down message
  await sleep(300);
  const msg1 = document.getElementById(CONFIG.selMsg1);
  if (msg1 && msg1.innerText.includes('issue with Aadhaar')) {
    await sendFail('Aadhaar authentication is down. Cannot proceed.');
    return;
  }

  // Check if dry-run
  if (currentConfig.dryRun) {
    await sendFail('Dry-run: Aadhaar form filled. Click Retry when ready for real run.');
    return;
  }

  await sleep(getDelay());
  currentStep = 'AADHAAR_DONE';
  // Click Generate OTP
  const btn = document.getElementById(CONFIG.selGenOtp);
  if (btn) {
    btn.click();
    // Wait for OTP panel to appear (or error)
    await waitForMutation(() => {
      // Check for error or OTP input
      const errEl = document.getElementById(CONFIG.selMsg1);
      if (errEl && errEl.innerText.includes('issue')) return 'ERROR';
      const otp = findInputByPattern(CONFIG.otpPatterns, { maxlength: '6' });
      if (otp) return 'OTP_READY';
      return null;
    }, 15000);

    // Check for error
    const errEl = document.getElementById(CONFIG.selMsg1);
    if (errEl && errEl.innerText.length > 0 && !errEl.innerText.includes('OTP')) {
      await sendFail('Aadhaar error: ' + errEl.innerText.slice(0, 100));
      return;
    }
  }

  // Wait for OTP input
  await waitForOtpField();
}

async function waitForOtpField() {
  currentStep = 'OTP_WAIT';
  // Poll for OTP input field
  for (let i = 0; i < 30; i++) {
    const otpInput = findInputByPattern(CONFIG.otpPatterns, { maxlength: '6' });
    if (otpInput) {
      sendUpdate('OTP_READY', 'OTP field detected');
      await notifyBackground('otpWaiting');
      return;
    }
    // Check for CAPTCHA appearing instead (on login page variant)
    const captcha = document.getElementById(CONFIG.selCaptcha || 'ctl00_ContentPlaceHolder1_imgCaptcha');
    if (captcha && captcha.offsetParent !== null) {
      // This is the login CAPTCHA, not registration
      await sendFail('Login CAPTCHA detected. Wrong page?');
      return;
    }
    await sleep(500);
  }
  // OTP field not found — maybe it appeared differently
  sendUpdate('OTP_WAIT', 'OTP field not found automatically. Check page.');
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

  // Find and click Verify button
  const verifyBtn = findVerifyButton();
  if (verifyBtn) {
    setTimeout(() => verifyBtn.click(), 300);
    currentStep = 'OTP_ENTERED';
    sendUpdate('OTP_ENTERED', 'OTP submitted, waiting for next step...');
    // Wait for next panel to load
    waitForNextStep(10000);
  } else {
    // Maybe auto-validates on 6 digits? Wait and see.
    currentStep = 'OTP_ENTERED';
    sendUpdate('OTP_ENTERED', 'OTP filled. Clicking Verify or waiting...');
    // Try clicking any submit button that appeared after OTP
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
    // Try clicking the generate OTP button again
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
      if (opt.textContent.toLowerCase().includes('proprietor') || opt.textContent.toLowerCase().includes('proprietorship')) {
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

    // Click Validate PAN button
    const validateBtn = document.querySelector('input[type="submit"][value*="Validate" i], input[type="submit"][id*="Validate" i], input[type="submit"][id*="verify" i]');
    if (validateBtn) {
      validateBtn.click();
      sendUpdate('PAN_FILL', 'PAN submitted, waiting for verification...');
      await sleep(3000);
    }
  }

  // Wait for next step
  await waitForNextStep(8000);
  await run();
}

async function handleGstStep() {
  sendUpdate('GST_SET', 'Setting GST to No...');
  await sleep(getDelay());

  // Select "No" radio for GST
  const gstRadios = document.querySelectorAll('input[type="radio"][name*="GST" i], input[type="radio"][name*="gst" i]');
  for (const radio of gstRadios) {
    const parentText = (radio.parentElement?.textContent || '').toLowerCase();
    const val = (radio.value || '').toLowerCase();
    if (val === 'no' || val === '2' || parentText.includes('no') || parentText.includes('not')) {
      radio.checked = true;
      dispatchEvent(radio, 'change');
      break;
    }
  }

  await sleep(getDelay());
  await waitForNextStep(5000);
  await run();
}

async function handleBusinessStep() {
  sendUpdate('BUSINESS_FILL', 'Filling business details...');
  await sleep(getDelay());

  // Enterprise/Business name
  const nameFields = document.querySelectorAll('input[placeholder*="Enterprise" i], input[placeholder*="Business" i], input[placeholder*="Unit Name" i], input[id*="EnterpriseName" i], input[id*="UnitName" i], input[id*="BusinessName" i]');
  for (const f of nameFields) {
    await setInputRaw(f, currentPerson.Proprietor_Name || currentPerson.name || '');
    break;
  }

  // Mobile
  const mobFields = document.querySelectorAll('input[placeholder*="Mobile" i], input[id*="Mobile" i], input[maxlength="10"][type="text"]');
  for (const f of mobFields) {
    if (currentPerson.Mobile_No) {
      await setInputRaw(f, currentPerson.Mobile_No);
    }
    break;
  }

  // Email
  const emailFields = document.querySelectorAll('input[type="email"], input[placeholder*="Email" i], input[id*="Email" i]');
  for (const f of emailFields) {
    if (currentPerson.Email_ID) {
      await setInputRaw(f, currentPerson.Email_ID);
    }
    break;
  }

  // Social Category
  const catSelects = document.querySelectorAll('select[id*="Category" i], select[id*="Social" i], select[name*="Category" i]');
  for (const sel of catSelects) {
    const cat = currentPerson.Social_Category || 'General';
    selectOptionByText(sel, cat);
    await sleep(300);
  }

  // Gender
  const genderRadios = document.querySelectorAll('input[type="radio"][name*="Gender" i], input[type="radio"][name*="gender" i]');
  const gender = currentPerson.Gender || 'Male';
  for (const radio of genderRadios) {
    const val = (radio.value || '').toLowerCase();
    const parentText = (radio.parentElement?.textContent || '').toLowerCase();
    if (val.includes(gender.toLowerCase()) || parentText.includes(gender.toLowerCase())) {
      radio.checked = true;
      dispatchEvent(radio, 'change');
      break;
    }
  }

  // Woman owned
  if (currentPerson.Woman_Owned === 'Yes') {
    const wRadios = document.querySelectorAll('input[type="radio"][name*="Woman" i], input[type="radio"][name*="woman" i]');
    for (const radio of wRadios) {
      const val = (radio.value || '').toLowerCase();
      const parentText = (radio.parentElement?.textContent || '').toLowerCase();
      if (val === 'yes' || parentText.includes('yes')) {
        radio.checked = true;
        dispatchEvent(radio, 'change');
        break;
      }
    }
  }

  // Address fields
  const addressLines = [
    currentPerson.Address_Flat || '',
    currentPerson.Address_Premises || '',
    currentPerson.Address_Village || '',
    currentPerson.Address_City || ''
  ];

  const addrInputs = document.querySelectorAll('input[placeholder*="Address" i], input[id*="Address" i], input[id*="Flat" i], input[id*="Premises" i], input[id*="Village" i], input[id*="City" i]');
  let addrIdx = 0;
  for (const f of addrInputs) {
    const ph = (f.placeholder || '').toLowerCase();
    const id = (f.id || '').toLowerCase();
    // Skip fields we already handled
    if (f.type !== 'text') continue;
    if (ph.includes('mobile') || ph.includes('email') || ph.includes('aadhaar') || ph.includes('pan')) continue;
    if (addrIdx < addressLines.length && addressLines[addrIdx]) {
      await setInputRaw(f, addressLines[addrIdx]);
      addrIdx++;
    }
  }

  // Pincode
  const pinFields = document.querySelectorAll('input[placeholder*="Pincode" i], input[placeholder*="Pin Code" i], input[placeholder*="Pin" i], input[maxlength="6"][type="text"]:not([id*="Mobile" i]):not([id*="mobile" i]):not([id*="OTP" i]):not([id*="otp" i])');
  for (const f of pinFields) {
    if (currentPerson.Pincode) {
      await setInputRaw(f, currentPerson.Pincode);
    }
    break;
  }

  // State + District cascade
  if (currentPerson.State_Name) {
    const stateSelects = document.querySelectorAll('select[id*="State" i], select[name*="State" i]');
    for (const sel of stateSelects) {
      if (selectOptionByText(sel, currentPerson.State_Name)) {
        dispatchEvent(sel, 'change');
        await sleep(2000); // Wait for district cascade
        break;
      }
    }
  }

  if (currentPerson.District_Name) {
    const distSelects = document.querySelectorAll('select[id*="District" i], select[name*="District" i]');
    for (const sel of distSelects) {
      if (selectOptionByText(sel, currentPerson.District_Name)) {
        dispatchEvent(sel, 'change');
        await sleep(500);
        break;
      }
    }
  }

  // Date of Commencement
  const dateFields = document.querySelectorAll('input[type="date"], input[placeholder*="Date" i], input[placeholder*="Commencement" i], input[id*="Date" i], input[id*="Commencement" i]');
  for (const f of dateFields) {
    if (currentPerson.Commencement_Date) {
      await setInputRaw(f, currentPerson.Commencement_Date);
    }
    break;
  }

  await sleep(getDelay());
  await waitForNextStep(5000);
  await run();
}

async function handleNicStep() {
  sendUpdate('NIC_SET', 'Setting NIC 66190...');
  await sleep(getDelay());

  // Select "Services" radio
  const sectorRadios = document.querySelectorAll('input[type="radio"][name*="Sector" i], input[type="radio"][name*="sector" i], input[type="radio"][name*="Major" i]');
  for (const radio of sectorRadios) {
    const val = (radio.value || '').toLowerCase();
    const parentText = (radio.parentElement?.textContent || '').toLowerCase();
    if (val.includes('service') || parentText.includes('service')) {
      radio.checked = true;
      dispatchEvent(radio, 'change');
      await sleep(500);
      break;
    }
  }

  const nic2 = currentConfig.nic2 || '66';
  const nic4 = currentConfig.nic4 || '6619';
  const nic5 = currentConfig.nic5 || '66190';

  // Find NIC dropdowns
  const selects = document.querySelectorAll('select[id*="NIC" i], select[id*="nic" i], select[name*="NIC" i]');
  // Sort by presumed hierarchy (2-digit < 4-digit < 5-digit by option count or value length)
  // Or try __doPostBack approach for cascade

  // Try direct value injection first
  for (const sel of selects) {
    const optValues = Array.from(sel.options).map(o => o.value);
    if (optValues.includes(nic2)) {
      sel.value = nic2;
      dispatchEvent(sel, 'change');
      await sleep(2000); // Wait for cascade AJAX
      break;
    }
  }

  // After cascade, find 4-digit
  await sleep(1000);
  const selects2 = document.querySelectorAll('select[id*="NIC" i], select[id*="nic" i], select[name*="NIC" i]');
  for (const sel of selects2) {
    const optValues = Array.from(sel.options).map(o => o.value);
    if (optValues.includes(nic4) && sel.value !== nic4) {
      sel.value = nic4;
      dispatchEvent(sel, 'change');
      await sleep(2000);
      break;
    }
  }

  // Then 5-digit
  await sleep(1000);
  const selects3 = document.querySelectorAll('select[id*="NIC" i], select[id*="nic" i], select[name*="NIC" i]');
  for (const sel of selects3) {
    const optValues = Array.from(sel.options).map(o => o.value);
    if (optValues.includes(nic5) && sel.value !== nic5) {
      sel.value = nic5;
      dispatchEvent(sel, 'change');
      await sleep(500);
      break;
    }
  }

  // Click "Add Activity" button
  await sleep(500);
  const addBtn = document.querySelector('input[type="submit"][value*="Add" i], input[type="button"][value*="Add" i], button[id*="Add" i]');
  if (addBtn) {
    addBtn.click();
    await sleep(1000);
  }

  await waitForNextStep(5000);
  await run();
}

async function handleBankStep() {
  sendUpdate('BANK_FILL', 'Filling bank details...');
  await sleep(getDelay());

  // Bank Account
  const acctFields = document.querySelectorAll('input[placeholder*="Account" i], input[id*="Account" i], input[id*="Bank" i]');
  let acctFilled = false;
  for (const f of acctFields) {
    const ph = (f.placeholder || '').toLowerCase();
    const id = (f.id || '').toLowerCase();
    if (ph.includes('confirm') || id.includes('confirm')) continue;
    if ((ph.includes('account') || id.includes('account') || ph.includes('bank')) && !acctFilled) {
      if (currentPerson.Bank_Account_No) await setInputRaw(f, currentPerson.Bank_Account_No);
      acctFilled = true;
    }
  }

  // Confirm Account
  for (const f of acctFields) {
    const ph = (f.placeholder || '').toLowerCase();
    const id = (f.id || '').toLowerCase();
    if (ph.includes('confirm') || id.includes('confirm') || id.includes('re-enter')) {
      if (currentPerson.Bank_Account_No) await setInputRaw(f, currentPerson.Bank_Account_No);
      break;
    }
  }

  // IFSC
  const ifscFields = document.querySelectorAll('input[placeholder*="IFSC" i], input[placeholder*="ifs" i], input[id*="IFSC" i], input[id*="Ifsc" i], input[id*="ifsc" i]');
  for (const f of ifscFields) {
    if (currentPerson.Bank_IFSC) await setInputRaw(f, currentPerson.Bank_IFSC);
    break;
  }

  await sleep(getDelay());
  await waitForNextStep(5000);
  await run();
}

async function handleFinancialStep() {
  sendUpdate('FINANCIAL_FILL', 'Filling investment & turnover...');
  await sleep(getDelay());

  // Investment
  const invFields = document.querySelectorAll('input[placeholder*="Investment" i], input[placeholder*="Plant" i], input[placeholder*="Machinery" i], input[id*="Investment" i], input[id*="Plant" i], input[id*="Wdv" i], input[id*="WDV" i]');
  for (const f of invFields) {
    const ph = (f.placeholder || '').toLowerCase();
    const id = (f.id || '').toLowerCase();
    if (ph.includes('exclusion') || id.includes('exclusion') || id.includes('turnover') || ph.includes('turnover')) continue;
    if (currentPerson.Investment_Value) await setInputRaw(f, String(currentPerson.Investment_Value));
    break;
  }

  // Turnover
  const turnFields = document.querySelectorAll('input[placeholder*="Turnover" i], input[placeholder*="turnover" i], input[id*="Turnover" i], input[id*="turnover" i]');
  for (const f of turnFields) {
    const ph = (f.placeholder || '').toLowerCase();
    const id = (f.id || '').toLowerCase();
    if (ph.includes('export') || id.includes('export')) continue; // Skip export turnover
    if (currentPerson.Turnover_Value) await setInputRaw(f, String(currentPerson.Turnover_Value));
    break;
  }

  await sleep(getDelay());
  await waitForNextStep(5000);
  await run();
}

async function handleDeclarationStep() {
  sendUpdate('DECLARED', 'Checking declarations...');
  await sleep(getDelay());

  // Check all declaration checkboxes
  const decCheckboxes = document.querySelectorAll('input[type="checkbox"][id*="Declaration" i], input[type="checkbox"][id*="Declare" i], input[type="checkbox"][id*="chk" i]');
  for (const cb of decCheckboxes) {
    if (!cb.checked) {
      cb.checked = true;
      dispatchEvent(cb, 'change');
    }
  }

  await sleep(getDelay());

  // Check for CAPTCHA
  const captchaImg = document.querySelector('img[id*="Captcha" i], img[id*="captcha" i], img[src*="Captcha" i], img[src*="captcha" i]');
  if (captchaImg && captchaImg.offsetParent !== null) {
    currentStep = 'CAPTCHA_WAIT';
    // Send CAPTCHA to popup
    await notifyBackground('captchaWaiting', { captchaSrc: captchaImg.src });
    return; // Wait for human to solve CAPTCHA
  }

  // If no CAPTCHA, proceed to final OTP / submit
  await handlePreSubmit();
}

function handleCaptchaInput(captcha) {
  const captchaInput = document.querySelector('input[id*="Captcha" i], input[id*="captcha" i], input[placeholder*="Verification" i]');
  if (captchaInput) {
    captchaInput.value = captcha;
    dispatchEvent(captchaInput, 'input');
    dispatchEvent(captchaInput, 'change');
    currentStep = 'CAPTCHA_DONE';
    sendUpdate('CAPTCHA_DONE', 'CAPTCHA submitted');
    // Proceed to submit
    setTimeout(() => handlePreSubmit(), 500);
  }
}

async function handlePreSubmit() {
  // Check for final OTP
  await sleep(500);
  const finalOtpInput = document.querySelector('input[maxlength="6"][type="text"]:not([id*="Captcha" i]):not([id*="captcha" i])');
  if (finalOtpInput && currentStep !== 'OTP_ENTERED') {
    currentStep = 'FINAL_OTP_WAIT';
    await notifyBackground('finalOtpWaiting');
    return;
  }

  // No OTP needed, try submit
  await doSubmit();
}

function handleFinalOtpInput(otp) {
  const finalOtpInput = document.querySelector('input[maxlength="6"][type="text"]:not([id*="Captcha" i]):not([id*="captcha" i])');
  if (finalOtpInput) {
    finalOtpInput.value = otp;
    dispatchEvent(finalOtpInput, 'input');
    dispatchEvent(finalOtpInput, 'change');
    currentStep = 'FINAL_OTP_DONE';
    sendUpdate('FINAL_OTP_DONE', 'Final OTP entered');
    setTimeout(() => doSubmit(), 500);
  }
}

async function handleSubmitStep() {
  await doSubmit();
}

async function doSubmit() {
  sendUpdate('SUBMITTING', 'Submitting registration...');

  // Click submit button
  const submitBtns = document.querySelectorAll('input[type="submit"][value*="Submit" i], input[type="submit"][value*="Register" i], input[type="submit"][id*="Submit" i], input[type="submit"][id*="btnSubmit" i]');
  for (const btn of submitBtns) {
    if (btn.offsetParent !== null) { // visible
      btn.click();
      await sleep(3000);
      break;
    }
  }

  // Wait for result
  await waitForResult(15000);
}

async function waitForResult(timeout) {
  for (let i = 0; i < timeout / 500; i++) {
    const bodyText = document.body.innerText || '';
    // Look for Udyam number pattern
    const match = bodyText.match(/UDYAM[-][A-Z]{2}[-]\d{2}[-]\d{7,9}/);
    if (match) {
      await notifyDone(match[0]);
      return;
    }
    // Alternative: check for success message
    if (bodyText.includes('Congratulations') || bodyText.includes('successfully registered')) {
      // Try to extract number from any link
      const resultLink = document.getElementById(CONFIG.selResultLink);
      if (resultLink && resultLink.innerText) {
        await notifyDone(resultLink.innerText.trim());
        return;
      }
      // Try from any bold text matching pattern
      const allText = document.body.innerText;
      const m2 = allText.match(/UDYAM[-]\w{2}[-]\d{2}[-]\d{7,}/);
      if (m2) {
        await notifyDone(m2[0]);
        return;
      }
      await notifyDone('SUCCESS');
      return;
    }
    // Check for errors
    const msgEl = document.getElementById(CONFIG.selMsg1);
    if ((msgEl && msgEl.innerText.includes('error')) || (msgEl && msgEl.innerText.includes('already'))) {
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

function findInputByPattern(patterns, attrs = {}) {
  const inputs = document.querySelectorAll('input[type="text"]');
  for (const input of inputs) {
    if (input.offsetParent === null) continue; // hidden
    const id = (input.id || '').toLowerCase();
    const ph = (input.placeholder || '').toLowerCase();
    const name = (input.name || '').toLowerCase();
    const val = (input.value || '').toLowerCase();

    // Check attributes
    let matchAttrs = true;
    for (const [k, v] of Object.entries(attrs)) {
      if (input.getAttribute(k) !== v) { matchAttrs = false; break; }
    }
    if (!matchAttrs) continue;

    // Check patterns
    for (const pattern of patterns) {
      if (pattern.test(id) || pattern.test(ph) || pattern.test(name)) {
        return input;
      }
    }
  }
  return null;
}

function findVerifyButton() {
  // Try various patterns for the verify/submit button after OTP
  const patterns = [/verify/i, /validate/i, /submit/i, /otp/i, /ok/i];
  const buttons = document.querySelectorAll('input[type="submit"], button[type="submit"]');
  for (const btn of buttons) {
    const val = (btn.value || btn.textContent || '').toLowerCase();
    const id = (btn.id || '').toLowerCase();
    for (const p of patterns) {
      if (p.test(val) || p.test(id)) return btn;
    }
  }
  // Fallback: first visible submit button
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
  // Try partial match
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

// ===== Observer & Wait =====

function startObserver() {
  const upanel = document.getElementById(CONFIG.selUpan);
  if (!upanel) return;

  observer = new MutationObserver((mutations) => {
    // Re-run step detection when UpdatePanel changes
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
  // Wait for DOM to settle after a step transition
  await sleep(1500);
  // Check if we got redirected or session expired
  const onWrongPage = !window.location.href.includes('UdyamRegistration.aspx');
  if (onWrongPage) {
    await sendFail('Session expired or redirected. Reload and retry.');
    return;
  }
}

// ===== Communication =====

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

// ===== Init =====
console.log('Udyam CSP Helper content script loaded. Waiting for commands...');
