# Requirements — Halloween Costume Contest App

**Owner:** Donnie (with Bianca) · **Date:** 2026-10-13 · **Status:** CONFIRMED 2026-10-13

---

## 1. Business outcome

**Outcome:** Guests run the annual costume contest themselves — they submit photos from their phones, watch them on the TV, and vote on an iPad. Donnie and Bianca no longer collect photos and tally votes by hand.

**Problem today:** Photos are collected and votes counted by hand (assumed — A-08).

**Success measure:** Every costume is submitted and shown on the TV. Winners (1st/2nd/3rd in each category) are computed automatically within a minute of voting closing, with no manual counting.

**Sponsor:** Donnie & Bianca

**Driver:** Halloween party, 31 Oct 2026. The submit URL has to go out to guests a few days before.

## 2. Scope

**In scope**
- Admin: create, rename, reorder and delete categories; open/close submissions and voting; hide or delete photos; cast the admin vote; see results.
- Submit: a mobile web page where a guest picks a category, takes a photo or picks one from the library, adds a title/caption, and submits.
- Display: a TV carousel showing 9 photos per screen, category by category, looping.
- Vote: an iPad kiosk where a voter enters their name, picks 3 photos in each category and submits once.
- Scoring: admin vote 50% + public vote 50%, giving 1st/2nd/3rd per category.

**Out of scope**
- Guest accounts and logins.
- Native iOS/Android apps.
- Fraud-proof voting (it's a family party — honour system, A-04).

- Winners reveal on the TV: the admin triggers it, and it shows 3rd → 2nd → 1st for each category (FR-09).
- Teardown after Halloween: the whole stack and all photos are destroyed (FR-10).

**Deferred**
- Reusing the app next year (it gets torn down instead; it can be redeployed from the repo).

## 3. Actors

| Persona | Count | What they do here | Access method |
|---|---|---|---|
| Guest (submitter) | ~30–60 households (A-01) | Submit 1+ costume photos | Own phone, public URL, no login |
| Voter | ~50–100 people (A-01) | Vote once, 3 picks per category | Shared iPad kiosk at the party |
| Admin | 2 (Donnie, Bianca) | Configure, moderate, vote, see results | Any browser + admin passcode |
| TV | 1 | Shows the carousel | Laptop/Chromecast/smart-TV browser |

## 4. Functional requirements

### FR-01 — Manage categories (admin)
- **Happy path:** The admin adds a category (name), renames it, reorders it, or deletes it. The display and voting screens follow the configured order.
- **Rules:** Seeded with *Best Family Costume*, *Best Kid Costume* and *Best Adult Individual Costume*. A category that already has photos can't be deleted until its photos are moved or removed. A "reset for new year" action archives all photos and votes.
- **Edge cases:** An empty category is skipped on the display and in voting.

### FR-02 — Contest phases (admin)
- Admin toggles: **Submissions open/closed** and **Voting open/closed**. The submit page shows "submissions closed" when they're closed, and the vote page shows "voting not open yet" or "voting closed".

### FR-03 — Submit a photo (guest)
- **Happy path:** Open the URL → pick a category → *Take photo* (camera) or *Choose from library* → see a preview → enter a title/caption (required, ≤80 characters) and optionally a name → Submit → see a confirmation with a "submit another" option.
- **Rules:** The photo is resized on the phone before upload (long edge ≈1600px, JPEG) so uploads are fast on party Wi-Fi/4G. HEIC from iPhones has to work. The same person can submit multiple photos.
- **On failure:** The upload error is shown with a Retry button, and the form isn't cleared.

### FR-04 — TV display carousel
- **Happy path:** Full-screen dark Halloween theme. It shows the category title plus a 3×3 grid of up to 9 photos with captions, and advances to the next 9 every *N* seconds (default 10, configurable). When a category is finished it moves to the next category, and after the last one it loops back to the first.
- **Rules:** New submissions show up on the next cycle without a page reload. Hidden photos never appear. It shows **caption only** — no submitter name, no vote counts.
- **Edge cases:** A screen with fewer than 9 photos is centred. When there are zero photos it shows "Submit your costume at <URL/QR code>".

### FR-05 — Vote (iPad kiosk)
- **Happy path:** Enter your name → see the category list with progress (e.g. "2/3 picked") → tap a category → 3×3 grid (paged) → tap a photo to open the single-photo view, swipe left/right to browse, tap "Vote for this" to pick it → back to categories → repeat → **Submit** is enabled once every category has 3 picks → thank-you screen → it resets to a blank name for the next voter after ~5 seconds.
- **Rules:** Exactly 3 different photos per category (or all of them if the category has fewer than 3). Picks can be toggled off before submitting. A ballot is saved only on Submit — one atomic ballot. Kiosk-friendly: big touch targets, no browser chrome needed, and it auto-resets after 2 minutes of inactivity.
- **Edge cases:** If a name has already voted, the voter is warned but allowed to continue, and the admin sees duplicates flagged (A-04).

### FR-06 — Admin vote
- Donnie and Bianca cast **one joint admin ballot**, ranking 1st/2nd/3rd per category (Bianca enters it).

### FR-07 — Results (admin only)
- Per category: each photo's public votes, crowd points, admin points, total, and place, with 1st/2nd/3rd highlighted.
- **Scoring — rank points, two equal juries (confirmed):**
  - **Crowd jury:** photos are ranked by public vote count. The top 3 get **3 / 2 / 1** crowd points. Photos tied on vote count share the higher place (e.g. two photos tied for 2nd both get 2 points, and the next one gets nothing — standard competition ranking).
  - **Admin jury:** admin 1st / 2nd / 3rd = **3 / 2 / 1** admin points.
  - **Total** = crowd points + admin points.
  - **Tie-breakers:** (1) more public votes, (2) the higher admin rank, (3) still tied → flagged for a manual decision in admin.
  - Worked example (validated with Donnie): public A35 B30 C25 D20 E10, admin D>C>E → A 1st (3+0, 35 votes), C 2nd (1+2), D 3rd (0+3).

### FR-09 — Winners reveal (TV)
- The admin switches the TV into reveal mode and steps through each category: 3rd → 2nd → 1st, with the full-screen photo and caption. Results are never shown on the TV until the admin triggers it.

### FR-10 — Teardown
- After Halloween, one documented command deletes all AWS resources and stored photos. Optionally, the admin downloads a zip of all photos first.

### FR-08 — Moderation
- The admin can hide/unhide a photo, delete it, edit its caption, or move it to a different category.

## 5. Data

| Entity | Fields (indicative) | Volume | PII? |
|---|---|---|---|
| Category | name, sort order | 3–6 | No |
| Photo | category, image, caption, submitter name (optional), hidden, created | ≤ 200 | **Yes — photos of children and guests' faces** |
| Ballot | voter name, picks per category, created, is_admin | ≤ 150 | Names only |
| Settings | submissions open, voting open, carousel seconds, admin passcode hash | 1 | No |

**Retention:** Photos and ballots are destroyed in the teardown after Halloween (FR-10). Nothing is shared outside the app.

## 6. Integration
None. One possible exception: a hosted backend/storage provider (a design decision).

## 7. Non-functional requirements

| Category | Requirement |
|---|---|
| Performance | Submit completes in under 10s on 4G. The carousel never shows a blank grid while loading (images preloaded). |
| Availability | It must be up on party night and the few days before. The admin needs a way to export all photos as a fallback (download zip). |
| Scale | Tiny — see the volumes above. |
| Mobile | Submit: iOS Safari + Android Chrome. Vote: iPad Safari (landscape and portrait). Display: 1080p/4K TV browser. |
| Accessibility | Large text and touch targets, good contrast on the dark theme. |
| Localisation | English, NZ time (A-07). |

## 8. Security and access

- **Guests:** no login. Anyone with the submit URL can submit — acceptable for a private party link.
- **Voting:** the kiosk URL isn't advertised. Voting is only possible while the admin has it open.
- **Admin:** protected by a shared passcode (A-05). Results and the admin ballot are visible only to admins.
- **Photos of children:** the gallery isn't publicly indexed (`noindex`, unguessable image URLs, no public listing outside display/vote). Approved by Donnie; destroyed after Halloween.

## 11. Delivery constraints

- **Deadline:** Submit URL live several days before 31 Oct 2026. Full dry run before the party.
- **Hosting:** AWS, in a **new separate AWS account** under the existing AWS setup so costs are tracked as personal. Donnie creates the account; the app deploys there (exact AWS services decided in design).
- **Source:** github.com/cinch-strike/HalloweenPhotoApp.

## 12. Acceptance criteria

| ID | Criterion |
|---|---|
| AC-01 | Given the admin adds a 4th category, when the submit, display and vote pages load, then the new category appears in the configured order. |
| AC-02 | Given an iPhone, when a guest takes a photo with the camera and submits it with a caption, then it appears on the TV display within one carousel cycle. |
| AC-03 | Given a photo from the iPhone library (HEIC) or Android gallery, when it's submitted, then it uploads and displays correctly oriented. |
| AC-04 | Given 20 photos in a category, the display shows 3 screens (9, 9, 2) for that category, then moves to the next category, and loops after the last. |
| AC-05 | Given a voter has picked 3 in only 2 of 3 categories, then Submit is disabled. Once they have 3 in each, they can submit, and the kiosk resets for the next voter. |
| AC-06 | A voter can't pick the same photo twice or more than 3 in a category. |
| AC-07 | Given public and admin votes, the results page shows final = 50% public share + 50% admin share and ranks 1st/2nd/3rd per category, matching a hand calculation on test data. |
| AC-08 | Without the admin passcode, the admin and results pages and their API calls are refused. |
| AC-09 | When submissions are closed, the submit page shows that they're closed and the API rejects uploads. |
| AC-10 | A hidden photo doesn't appear on the display or in voting. |

**Definition of done:** All ACs pass on a real iPhone, an iPad and the TV, and a dry run with ~10 test photos and ~5 ballots has been done before 31 Oct.

## 13. Assumptions

| ID | Assumption | Impact if wrong |
|---|---|---|
| A-01 | ≤ 200 photos, ≤ 150 voters. | Only affects hosting tier/costs. |
| A-02 | A guest can submit more than one photo (e.g. one per kid). | Would add a limit per device. |
| A-03 | Voters must make **exactly 3** picks per category before submitting. | Would allow partial ballots. |
| A-04 | Honour-system voting: name only, duplicates flagged but not blocked. | Would need per-guest codes. |
| A-05 | Admin access uses one shared passcode, not individual logins. | Would need real auth. |
| A-06 | The submit URL must work from guests' homes days before the party, so the app must be **internet-hosted**, not just on home Wi-Fi. | Drives the hosting choice. |
| A-07 | NZ timezone/English. | Trivial. |
| A-08 | Today it's done manually. | None. |

## 14. Open items

All resolved 2026-10-13: ranked joint admin ballot with rank-points scoring (FR-07); TV shows the caption only; winners reveal is in scope (FR-09); photos in AWS are acceptable, and everything is destroyed after Halloween (FR-10); the camera uses the phone's native picker.
