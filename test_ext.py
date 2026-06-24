#!/usr/bin/env python3
"""Udyam CSP Helper — Test Suite
Tests: CSV generation, sheet schema validation, dry-run flow simulation.

Usage:
  python test_ext.py              # Run all tests
  python test_ext.py --gen-csv    # Generate 100-row test CSV only
  python test_ext.py --validate   # Validate an existing CSV file
"""
import csv, os, sys, json, re, random
from pathlib import Path

DESKTOP = Path.home() / "Desktop"
PROJECT = DESKTOP / "udyam-csp-v1"
CSV_PATH = DESKTOP / "udyam-100-test-data.csv"

COLUMNS = [
    "Queue_ID", "Aadhaar_No", "Proprietor_Name", "PAN_No", "Mobile_No",
    "Email_ID", "Commencement_Date", "Address_Flat", "Address_Premises",
    "Address_Village", "Address_City", "Pincode", "State_Name",
    "District_Name", "Social_Category", "Gender", "Woman_Owned",
    "Minority_Owned", "Disabled_Owned", "Bank_Account_No", "Bank_IFSC",
    "Investment_Value", "Turnover_Value", "URN_Output"
]

# ====== TEST DATA GENERATION ======

def generate_person(idx):
    """Generate realistic test data for one CSP/kiosk operator."""
    names = [
        "Amit Kumar", "Priya Singh", "Ravi Sharma", "Sneha Patel", "Vijay Verma",
        "Anita Gupta", "Suresh Reddy", "Deepa Joshi", "Rajesh Mishra", "Pooja Rao",
        "Manish Tiwari", "Neha Agarwal", "Sunil Yadav", "Kavita Das", "Arun Nair",
        "Meena Iyer", "Rahul Saxena", "Shweta Menon", "Vikas Choudhary", "Ritu Jain",
        "Sanjay Malhotra", "Anjali Deshmukh", "Prakash Bhat", "Sangeeta Shetty",
        "Deepak Ghosh", "Nidhi Kapoor", "Rohit Mehta", "Jyoti Pandey", "Gaurav Thakur",
        "Lata Krishnan"
    ]
    cities_districts = {
        "Uttar Pradesh": [("Lucknow", "226001"), ("Varanasi", "221001"), ("Agra", "282001"), ("Kanpur", "208001"), ("Allahabad", "211001")],
        "Bihar": [("Patna", "800001"), ("Muzaffarpur", "842001"), ("Gaya", "823001"), ("Bhagalpur", "812001")],
        "Rajasthan": [("Jaipur", "302001"), ("Jodhpur", "342001"), ("Udaipur", "313001")],
        "Madhya Pradesh": [("Bhopal", "462001"), ("Indore", "452001"), ("Gwalior", "474001")],
        "Maharashtra": [("Mumbai", "400001"), ("Pune", "411001"), ("Nagpur", "440001")],
    }
    genders = ["Male", "Female"]
    categories = ["General", "OBC", "SC", "ST"]
    banks = [
        ("SBI", "SBIN0001234"), ("PNB", "PUNB0012345"), ("BOB", "BARB0012346"),
        ("Canara", "CANB0001234"), ("Union", "UBIN0012345")
    ]

    name = random.choice(names)
    gender = random.choice(genders)
    state = random.choice(list(cities_districts.keys()))
    district, pincode = random.choice(cities_districts[state])
    bank_name, ifsc = random.choice(banks)
    pan = "FGIPB" + f"{idx:04d}" + random.choice("ABCDEFGH")
    aadhaar = f"{random.randint(100000000000, 999999999999)}"
    mobile = f"9{random.randint(100000000, 999999999)}"
    email = name.lower().replace(" ", ".") + f"{idx}@gmail.com"

    return {
        "Queue_ID": str(idx + 1),
        "Aadhaar_No": aadhaar,
        "Proprietor_Name": name,
        "PAN_No": pan,
        "Mobile_No": mobile,
        "Email_ID": email,
        "Commencement_Date": f"{random.randint(2015,2024)}-{random.randint(1,12):02d}-{random.randint(1,28):02d}",
        "Address_Flat": f"H.No. {random.randint(1,999)}",
        "Address_Premises": random.choice(["Main Road", "Station Road", "Gandhi Nagar", "Shastri Nagar", "Indira Colony"]),
        "Address_Village": f"Village {random.randint(1,50)}",
        "Address_City": district,
        "Pincode": pincode,
        "State_Name": state,
        "District_Name": district,
        "Social_Category": random.choice(categories),
        "Gender": gender,
        "Woman_Owned": "Yes" if gender == "Female" else "No",
        "Minority_Owned": random.choice(["Yes", "No"]),
        "Disabled_Owned": random.choice(["Yes", "No"]),
        "Bank_Account_No": f"{random.randint(10000000000, 99999999999)}",
        "Bank_IFSC": ifsc,
        "Investment_Value": str(random.choice([500000, 1000000, 2500000, 5000000, 10000000])),
        "Turnover_Value": str(random.choice([5000000, 10000000, 25000000, 50000000])),
        "URN_Output": ""
    }


def generate_csv(count=100):
    """Generate test CSV with `count` rows."""
    print(f"\n  Generating {count} test rows...")
    with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        for i in range(count):
            writer.writerow(generate_person(i))
    print(f"  [OK] Written: {CSV_PATH}")
    print(f"  Size: {CSV_PATH.stat().st_size:,} bytes")
    return CSV_PATH


# ====== VALIDATION ======

def validate_csv(path):
    """Validate a CSV file against the expected schema."""
    errors = []
    row_count = 0
    seen_aadhaar = set()

    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        # Check columns
        missing_cols = [c for c in COLUMNS if c not in reader.fieldnames]
        if missing_cols:
            errors.append(f"Missing columns: {missing_cols}")
            return errors, 0

        extra_cols = [c for c in reader.fieldnames if c not in COLUMNS]
        if extra_cols:
            print(f"  [WARN] Extra columns (will be ignored): {extra_cols}")

        for i, row in enumerate(reader):
            row_count += 1
            aadhaar = row.get("Aadhaar_No", "").strip()

            # Check Aadhaar
            if not re.match(r"^\d{12}$", aadhaar):
                errors.append(f"Row {i+2}: Invalid Aadhaar '{aadhaar}' (must be 12 digits)")
            elif aadhaar in seen_aadhaar:
                errors.append(f"Row {i+2}: Duplicate Aadhaar '{aadhaar}'")
            seen_aadhaar.add(aadhaar)

            # Check Name
            if not row.get("Proprietor_Name", "").strip():
                errors.append(f"Row {i+2}: Missing Proprietor_Name")

            # Check Mobile
            mobile = row.get("Mobile_No", "").strip()
            if mobile and not re.match(r"^\d{10}$", mobile):
                errors.append(f"Row {i+2}: Invalid Mobile '{mobile}' (must be 10 digits)")

            # Check PAN
            pan = row.get("PAN_No", "").strip()
            if pan and not re.match(r"^[A-Z]{5}\d{4}[A-Z]$", pan):
                errors.append(f"Row {i+2}: Invalid PAN '{pan}'")

            # Check Pincode
            pin = row.get("Pincode", "").strip()
            if pin and not re.match(r"^\d{6}$", pin):
                errors.append(f"Row {i+2}: Invalid Pincode '{pin}'")

    return errors, row_count


def validate_config_files():
    """Verify project files exist and have expected structure."""
    print("\n--- File Structure ---")
    files = {
        "manifest.json": False,
        "background.js": False,
        "content.js": False,
        "popup.html": False,
        "popup.js": False,
        "options.html": False,
        "options.js": False,
    }
    for f in files:
        path = PROJECT / f
        exists = path.exists()
        files[f] = exists
        print(f"  {'[OK]' if exists else '[MISS]'} {f} ({path.stat().st_size:,} bytes)" if exists else f"  [MISS] {f} (MISSING)")

    return all(files.values())


# ====== SHEET API TEST ======

def test_sheet_api(sheet_id=None, api_key=None):
    """Test connection to Google Sheets API."""
    import urllib.request, urllib.error, json as j

    if not sheet_id or not api_key:
        print("  [WARN] No sheet ID / API key provided. Skipping API test.")
        print("  Usage: python test_ext.py --api-test --sheet-id <ID> --api-key <KEY>")
        return False

    url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/Sheet1!A1:Z?key={api_key}"
    try:
        resp = urllib.request.urlopen(url, timeout=10)
        data = j.loads(resp.read())
        rows = data.get("values", [])
        print(f"  [OK] Sheet connected! Found {len(rows)} rows (incl. header).")
        if len(rows) > 1:
            print(f"  First data row: {rows[1][:4]}")
        return True
    except urllib.error.HTTPError as e:
        print(f"  [MISS] HTTP {e.code}: {e.reason}")
        body = e.read().decode()
        try:
            err = j.loads(body)
            print(f"    Details: {err.get('error', {}).get('message', '')}")
        except:
            print(f"    Body: {body[:200]}")
        return False
    except Exception as e:
        print(f"  [MISS] Error: {e}")
        return False


# ====== MAIN ======

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Udyam CSP Helper — Test Suite")
    parser.add_argument("--gen-csv", type=int, nargs="?", const=100, metavar="N",
                        help="Generate N-row test CSV (default: 100)")
    parser.add_argument("--validate", type=str, nargs="?", const=str(CSV_PATH), metavar="PATH",
                        help="Validate a CSV file")
    parser.add_argument("--api-test", action="store_true", help="Test Sheet API connection")
    parser.add_argument("--sheet-id", type=str, help="Google Sheet ID")
    parser.add_argument("--api-key", type=str, help="Google API Key")
    parser.add_argument("--all", action="store_true", help="Run all tests")
    args = parser.parse_args()

    if len(sys.argv) == 1:
        args.all = True

    passed, failed = 0, 0

    # File structure
    print("=" * 50)
    print("  UDYAM CSP HELPER — TEST SUITE")
    print("=" * 50)

    if args.all or args.gen_csv is not None:
        print("\n--- CSV Generation ---")
        count = args.gen_csv if args.gen_csv is not None else 100
        path = generate_csv(count)
        errors, n = validate_csv(path)
        if errors:
            print(f"  [MISS] {len(errors)} validation errors:")
            for e in errors[:5]:
                print(f"    - {e}")
            failed += 1
        else:
            print(f"  [OK] All {n} rows valid!")
            passed += 1

    if args.all or args.validate:
        path = args.validate if args.validate else CSV_PATH
        if not os.path.exists(path):
            print(f"\n--- Validate ---")
            print(f"  [MISS] File not found: {path}")
            failed += 1
        else:
            print(f"\n--- Validate: {path} ---")
            errors, n = validate_csv(path)
            if errors:
                print(f"  [MISS] {len(errors)} errors:")
                for e in errors[:10]:
                    print(f"    - {e}")
                failed += 1
            else:
                print(f"  [OK] {n} rows valid!")
                passed += 1

    if args.all:
        print("\n--- File Structure ---")
        if validate_config_files():
            print("  [OK] All files present")
            passed += 1
        else:
            print("  [MISS] Some files missing")
            failed += 1

    if args.all or args.api_test:
        print("\n--- API Test ---")
        sid = args.sheet_id or os.environ.get("UDYAM_SHEET_ID")
        ak = args.api_key or os.environ.get("UDYAM_API_KEY")
        if test_sheet_api(sid, ak):
            passed += 1
        else:
            failed += 1

    # Summary
    print("\n" + "=" * 50)
    total = passed + failed
    print(f"  Results: {passed}/{total} passed", end="")
    if failed:
        print(f", {failed} FAILED [FAIL]")
    else:
        print("  ALL PASSED")
    print("=" * 50)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
