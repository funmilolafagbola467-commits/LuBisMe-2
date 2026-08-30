# LuBisMe — how to make this a real, live website

This folder has everything needed. Follow these steps in order —
each one unlocks the next.

## Step 1 — Create the database (Supabase)

1. Go to supabase.com, sign in, click "New project"
2. Once it's created, go to the **SQL Editor** tab
3. Open `backend/schema.sql` from this folder, copy all of it,
   paste into the SQL Editor, click Run
4. Go to **Project Settings → API** — you'll see a "Project URL"
   and an "anon public" key. Copy both, you'll need them next.

## Step 2 — Connect the code to your database

1. Open `js/supabase-client.js` in any text editor
2. Replace `YOUR_PROJECT_REF.supabase.co` with the Project URL from Step 1
3. Replace `YOUR_PUBLIC_ANON_KEY` with the anon key from Step 1
4. Save the file

## Step 3 — Set up payments (Paystack)

1. Go to paystack.com, sign in to your account
2. Go to **Payments → Plans**, create two plans:
   - Name: "LuBisMe Regular", Amount: ₦3,500, Interval: Monthly
   - Name: "LuBisMe Premium", Amount: ₦8,500, Interval: Monthly
3. Copy the "Plan Code" for the Premium plan (looks like `PLN_xxxxx`)
4. Go to **Settings → API Keys & Webhooks**, copy your **Public Key**
   (starts with `pk_live_` or `pk_test_` while testing)

## Step 4 — Connect payments to the code

1. Open `dashboard.html` in a text editor
2. Find the line `const PAYSTACK_PUBLIC_KEY = ...` and paste your
   public key from Step 3 in there
3. Find `const PREMIUM_PLAN_CODE = ...` and paste your Premium plan
   code from Step 3

## Step 5 — The webhook (this is the technical part)

This is the piece that actually confirms someone paid and unlocks
Premium for them — it can't run from the website files directly,
it needs to run on a server. `backend/paystack-integration.md` has
the full code for this (search for "Webhook handler"). This gets
deployed as a small serverless function alongside the rest of the
site on Vercel — happy to walk through setting this up together
when you get to this step, it's easiest to do live rather than
from written instructions.

## Step 6 — Put it on the internet (Vercel)

Same process you already know from SchoolManager:
1. Push this whole folder to a GitHub repository
2. In Vercel, import that repository as a new project
3. Deploy — Vercel will automatically pick up `vercel.json` so the
   `/username` style links work correctly
4. Point your domain (or a subdomain) at the new Vercel project,
   same as you did for SchoolManager's subdomain

## What each file is, in plain terms

| File | What it is |
|---|---|
| `index.html` | The homepage |
| `auth.html` | Sign up / log in page |
| `dashboard.html` | What a logged-in user sees to manage their page |
| `profile.html` | The public gift page fans see and use to send crypto |
| `js/` folder | The code that connects the pages to your database |
| `backend/schema.sql` | Sets up your database — run once in Step 1 |
| `backend/paystack-integration.md` | Full instructions + code for payments |
| `vercel.json` | Makes the clean `lubisme.com/username` links work |

## If you get stuck

Come back and tell me exactly which step you're on and what you're
seeing — screenshots help. We can go through any one of these steps
together in detail.
