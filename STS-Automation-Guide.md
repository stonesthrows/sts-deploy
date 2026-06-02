# Stones Throw Studio — Message Automation Guide
### Getting Instagram, Facebook & Shopify inquiries into your workflow

---

## The Big Picture

Since your order tracker is a standalone web app (no server behind it), the best approach is a **notification pipeline**: when a new message or order arrives on Instagram, Facebook, or Shopify, an automation tool sends you an email summary. You then add it to the app manually in about 10 seconds — same as you do now, but without having to check three separate apps.

**Tool options:** [Zapier](https://zapier.com) (easier, more expensive) or [Make.com](https://make.com) (more flexible, free tier is generous). Both work identically for these use cases. Make's free tier covers ~1,000 operations/month which is plenty for a studio your size.

---

## Setup 1 — Shopify New Orders → Email Notification

This is the highest-value one. Every time someone places an order on your Shopify store, you get an email with their name, what they ordered, and their contact info.

**In Make.com:**
1. Create a new Scenario
2. Add trigger: **Shopify → Watch Orders** (select "New order")
3. Connect your Shopify store (it will ask for your store URL: `your-store.myshopify.com`)
4. Add action: **Gmail → Send an Email**
5. Set **To:** `kyle@stonesthrowjewelry.com`
6. Set **Subject:** `New Shopify Order — {{customer.first_name}} {{customer.last_name}}`
7. Set **Body:**
   ```
   New order from: {{billing_address.first_name}} {{billing_address.last_name}}
   Email: {{email}}
   Phone: {{phone}}
   Order total: ${{total_price}}
   Items: {{line_items[].name}}
   Order date: {{created_at}}
   
   Add to workflow: https://stsworkflow.netlify.app
   ```
8. Turn on the Scenario

**In Zapier (alternative):**
- Trigger: Shopify → New Order
- Action: Gmail → Send Email
- Same fields as above

---

## Setup 2 — Instagram DMs → Email Notification

Instagram DMs require connecting through a **Facebook Business Page** (Meta requires this). If your Instagram is already connected to a Facebook Page, you're halfway there.

**Prerequisites:**
- Instagram Business or Creator account (not personal)
- Connected to a Facebook Page
- Instagram must have "Connected Tools" / messaging enabled in settings

**In Make.com:**
1. Create a new Scenario
2. Add trigger: **Instagram for Business → Watch Direct Messages** (or use **Facebook Pages → Watch Messages** if your IG is linked)
3. Connect your Facebook/Instagram account
4. Add action: **Gmail → Send an Email**
5. Set **To:** `kyle@stonesthrowjewelry.com`
6. Set **Subject:** `New Instagram DM — {{sender.name}}`
7. Set **Body:**
   ```
   From: {{sender.name}}
   Message: {{message.text}}
   Received: {{created_time}}
   
   Reply in Instagram or add to workflow: https://stsworkflow.netlify.app
   ```

> **Note:** If you have a personal Instagram account (not Business/Creator), you'll need to switch it to a Business account in Instagram Settings → Account → Switch to Professional Account. It's free and reversible.

---

## Setup 3 — Facebook Page Messages → Email Notification

If customers message your Stones Throw Studio Facebook Page, this catches those.

**In Make.com:**
1. Create a new Scenario
2. Add trigger: **Facebook Pages → Watch Messages**
3. Connect your Facebook Page (not personal profile — must be your business Page)
4. Add action: **Gmail → Send an Email**
5. Set **To:** `kyle@stonesthrowjewelry.com`
6. Set **Subject:** `New Facebook Message — {{from.name}}`
7. Set **Body:**
   ```
   From: {{from.name}}
   Message: {{message}}
   Received: {{created_time}}
   
   Reply on Facebook or add to workflow: https://stsworkflow.netlify.app
   ```

---

## Adding a New Order to Your Workflow App

Once you get one of these notification emails, adding it to the app takes about 30 seconds:

1. Open [stsworkflow.netlify.app](https://stsworkflow.netlify.app)
2. Click **+ New Order** (or the add button in the appropriate column)
3. Fill in:
   - **Customer name** — from the email
   - **Order type** — Custom Order, Estimate Request, or Repair
   - **Contact source** — Shopify Email, Instagram Message, or Facebook (use the dropdown)
   - **Notes** — paste the message text
4. The card lands in Inquiry (or Needs Estimate for estimates)

---

## Recommended Starting Point

Start with **Shopify orders only** (Setup 1) — it's the simplest and most reliable. Shopify's Make.com integration is rock-solid. Get that running first, then add Instagram/Facebook once you're comfortable.

**Make.com free tier:** 1,000 operations/month, checks every 15 minutes.  
**Make.com Core (~$9/mo):** Unlimited scenarios, checks every 1 minute — worth it once you're set up.

---

*Guide prepared for Stones Throw Studio — May 2026*
