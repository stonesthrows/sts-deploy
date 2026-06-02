---
name: sts-drive-bag-scan
description: Daily 6pm scan of Google Drive "STS Order Bags Visual Reads" folder — reads work order bag photos and PDFs with Claude vision and imports new orders into the STS workflow app
---

You are helping Stones Throw Studio (custom jewelry, owner: Kyle) automate intake of work orders by visually reading photos and scanned PDFs of work order bags uploaded to Google Drive.

## YOUR TASK

1. List all files (images AND PDFs) in Google Drive folder ID: `156fZRGrqt7LWWggjcw0fzvIqd4DxRES5` (folder name: "STS Order Bags Visual Reads")
2. Check which files have already been processed (read the tracking file)
3. For each NEW file: read it to extract order information
4. Write the extracted orders to `scanned-orders.json` in the STS deploy folder
5. Deploy the updated file so the app picks it up automatically

---

## STEP 1 — List files in Google Drive folder

Use the Google Drive MCP `search_files` tool with this query:

```
parentId = '156fZRGrqt7LWWggjcw0fzvIqd4DxRES5'
```

Do NOT filter by mimeType — accept everything in the folder including:
- Images: `image/jpeg`, `image/png`, `image/heic`, etc.
- PDFs: `application/pdf` (e.g. Adobe Scan exports)

---

## STEP 2 — Check processed files

Read the tracking file at: `C:\Users\morph\Desktop\sts-deploy\processed-drive-scans.json`

This is a JSON array of Drive file IDs that have already been processed. If the file doesn't exist, treat it as an empty array `[]`.

Skip any file whose ID is already in this list.

---

## STEP 3 — Read each new file

For each new file, use the appropriate method based on mimeType:

**For images** (`image/*`):
- Use `download_file_content` to get the base64 content
- Pass the image directly to Claude vision for reading

**For PDFs** (`application/pdf`):
- Use `read_file_content` to extract text content (this uses OCR automatically)
- The OCR output may be noisy/imperfect — do your best to parse it
- Common OCR artifacts: letters run together, punctuation substituted for letters (e.g. `«` for `w`, `|` for `1`), words split unexpectedly
- Use context clues from the form structure to interpret unclear text

The bag/form contains fields for: customer name, email, phone, order type (Custom/Repair/Estimate/Resize), job description, ring size, materials, due date, pickup location, deposit/price, and notes.

Extract the following fields (leave null if not visible or illegible):
- `customer_name` — Full name of the customer (Last, First format common)
- `phone` — Phone number
- `email` — Email address
- `description` — Description of the jewelry piece or repair (metal type, stone, style, size, ring size)
- `order_type` — Must be one of:
  - `"order"` — if the bag says "Custom Order", "custom", or similar
  - `"repair"` — if the bag says "Repair", "fix", or similar
  - `"estimate"` — if the bag says "Estimate", "quote", or similar
  - Note: "Resize" maps to `"repair"`
- `deadline` — Due date in YYYY-MM-DD format, or null
- `price` — Numeric price/deposit amount, or 0
- `take_in_date` — Date taken in, in YYYY-MM-DD format, or null. If only month/day visible, assume current year.
- `pickup_location` — One of: "Studio", "Bell Market", "Mueller Market", "Chaparral Crossing Market", "Sunset Valley" — or null. The bag has checkboxes for these; look for circled/checked ones.
- `contacted_via` — One of: "Email", "Farmer's Market", "Shopify Email", "Etsy Message", "Instagram Message" — or null. The bag may show "ETSY" checkbox.
- `materials` — Any materials listed (stones, metal type, etc.)
- `notes` — Any other notes visible on the bag
- `drive_file_id` — The Google Drive file ID (from the listing)
- `scanned_at` — Current timestamp in ISO format

---

## STEP 4 — Update scanned-orders.json

Read the existing file at: `C:\Users\morph\Desktop\sts-deploy\scanned-orders.json`

This is a JSON array. If the file doesn't exist, start with `[]`. Append the newly extracted orders and write the updated array back.

---

## STEP 5 — Update the tracking file

Read `C:\Users\morph\Desktop\sts-deploy\processed-drive-scans.json` (or start with `[]`).
Add the Drive file IDs of all newly processed files to the array.
Write it back to `C:\Users\morph\Desktop\sts-deploy\processed-drive-scans.json`.

---

## STEP 6 — Deploy to Cloudflare

**Important:** Cloudflare requires `jewelry-workflow.html` to be touched (not just sw.js) in order to push updates live. Do both:

**6a.** Bump the cache version in sw.js — read the current version number and increment it by 1:
- File: `C:\Users\morph\Desktop\sts-deploy\sw.js`
- Find the line: `const CACHE = 'sts-orders-vXX';`
- Increment XX by 1 and write it back

**6b.** Update the deploy version comment in jewelry-workflow.html:
- File: `C:\Users\morph\Desktop\sts-deploy\jewelry-workflow.html`
- Find the line: `<!-- deploy-version: ... -->`
- Update it to reflect the new version (e.g. `<!-- deploy-version: v50-drivescan -->`)

**6c.** Run the deploy via bash:
```
cd /sessions/*/mnt/sts-deploy && npx wrangler pages deploy . --project-name=stsworkflow --commit-dirty=true
```
Note: The `/sessions/*/mnt/sts-deploy` path uses a wildcard — find the correct session path by running `ls /sessions/` first.

If the deploy fails, end your response with:
"⚠️ Deploy step failed — please run 2-deploy.bat to push the new orders live."

---

## DONE

Summarize what was processed:
- How many new files were found (and their types: image vs PDF)
- What orders were extracted (customer name + order type for each)
- Any fields that were illegible or uncertain
- Whether the deploy succeeded

If no new files were found, say: "No new work order bags found in Drive today."
