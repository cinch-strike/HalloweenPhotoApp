# Solution Design — Halloween Costume Contest App

**Owner:** Donnie · **Date:** 2026-10-13 · **Status:** CONFIRMED 2026-10-13 — D-01: CloudFront URL + QR code (short URL later); D-02: SSO profile `halloween`
**Derived from:** `01-requirements-halloween-contest.md` (confirmed 2026-10-13)
**Platform:** AWS (new standalone account), static web front end

---

## 1. Solution summary

This is one mobile-first web app with four screens: `/submit`, `/tv`, `/vote` and `/admin`. It is served from **CloudFront + S3**, with a small serverless API (**API Gateway → one Lambda → DynamoDB**). Photos are resized on the phone and uploaded straight to a private S3 bucket. The TV and the iPad poll the API, so new photos and the winners reveal show up without a reload. Everything is defined in **AWS CDK**, so one `cdk deploy` stands it up and one `cdk destroy` removes all of it, including the photos. Expected run cost is **under US$2 for the whole event**.

## 2. Options assessed

### Option A — Serverless: CloudFront + S3 + HTTP API + one Lambda + DynamoDB *(recommended)*
- **Pros:** Effectively free at this scale. No servers to keep alive on party night. AWS runs it across multiple availability zones by default. Clean `cdk destroy` teardown. Photos never pass through the Lambda (presigned upload), so uploads are fast and there are no payload limits.
- **Cons:** Several AWS pieces to wire together (CDK handles it). Live updates use polling, not push.
- **Effort:** ~22–28 h total.

### Option B — Single container: App Runner (or Lightsail) running Node + SQLite/EFS + S3
- **Pros:** Simplest mental model — one server and one codebase. Easy to run locally.
- **Cons:** ~US$5–25/month while it runs. The data lives on a single instance (SQLite) or needs EFS/RDS. If the instance restarts mid-party the app goes down for a while. Persistence and teardown are fiddlier.
- **Effort:** ~20–26 h.

### Option C — AWS Amplify Gen 2 (Cognito + AppSync + Amplify Storage)
- **Pros:** Scaffolding and hosting come out of the box. Real-time subscriptions are built in.
- **Cons:** Brings in Cognito/GraphQL that we don't need (guests have no logins). More moving parts and more lock-in, and it's harder to reason about guest upload permissions.
- **Effort:** ~22–30 h, plus learning-curve risk.

**Recommendation:** Option A. It's the cheapest and has the fewest failure points on party night. It also tears down cleanly, which matches your plan to destroy everything after Halloween.

## 3. Decisions required

| ID | Decision | Options | Consequence | Default if no answer |
|---|---|---|---|---|
| D-01 | URL | (a) The default `dxxxx.cloudfront.net` link plus a QR code; (b) a custom subdomain of a domain you own (Route 53 + ACM cert) | (a) zero setup but an ugly link; (b) a nicer link but needs DNS access and ~1 h | (a), shared via QR code and a short message |
| D-02 | AWS account access | The new account is accessed via IAM Identity Center (SSO) from your laptop | Needed to deploy. No long-lived keys | SSO profile `halloween` |

---

# Functional design

## 4. User journeys

**J1 — Guest submits (phone):** Open the link → Halloween-themed page → tap a category card → **Take photo / Choose photo** (native iOS/Android picker, which offers camera or library) → preview with a "retake" option → caption (required, ≤80 characters) and optional name → **Submit** → a progress bar → "🎃 You're in!" → *Submit another*.
*Unhappy path:* If the upload fails, the screen shows "Couldn't upload — check your connection" with a **Retry** button, and the form stays filled in. If submissions are closed, it shows "Submissions are closed — see you at the party!"

**J2 — TV display:** Open `/tv` on the TV browser → full screen → category title banner → a 3×3 grid of photos with captions → every 10 seconds (configurable) it moves to the next page with a fade → when a category is finished it goes to the next one → after the last it loops. A small "Submit yours: <QR code>" sits in the corner while submissions are open. When the admin starts the reveal, the TV switches to reveal mode (J5).

**J3 — Voter at the iPad kiosk:** "Who's voting?" → type a name → **Start** → category list with progress (e.g. *Best Kid 2/3*) → tap a category → 3×3 grid (paged) → tap a photo to open the single-photo view, swipe left/right, then **Pick** or **Unpick** → back to categories → once every category is complete, **Submit votes** → a "Thanks, Sam! 👻" confirmation → resets after 5 seconds. If the iPad is idle for 2 minutes, the ballot is discarded and the kiosk resets. If the name has already voted, it shows "Someone named Sam already voted — continue?"

**J4 — Admin (Donnie/Bianca, any device):** Enter the passcode → tabs:
- **Categories** — add, rename, reorder, delete.
- **Photos** — grid with hide, delete, edit caption and move category.
- **Contest** — submissions and voting toggles, carousel speed, and **Enable this device as voting kiosk**.
- **Admin ballot** — rank 1st/2nd/3rd per category.
- **Results** — the full scoring breakdown, with ties and duplicate voters flagged.
- **Reveal** — start reveal, then Next/Back through each category's 3rd → 2nd → 1st, then end reveal.

**J5 — Winners reveal (TV, driven from admin):** Category title → "3rd place…" → full-screen photo and caption → Next → 2nd → Next → 1st with a confetti/bats animation → Next category. The TV picks up the admin's current step within about 2 seconds.

## 5. Screens

| Route | Device | Notes |
|---|---|---|
| `/` (= submit) | Guest phones | Portrait-first. Big category cards. Uses `<input type="file" accept="image/*">` so the native camera/library picker appears |
| `/tv` | TV browser | Landscape 16:9. Large type. Preloads the next page of photos before switching |
| `/vote` | iPad | Works in portrait and landscape. Touch targets at least 56px. Swipe gestures in the single-photo view |
| `/admin` | Any | Passcode gate, then tabs |

## 6. Permissions and visibility

| Persona | Sees | Can do | Cannot |
|---|---|---|---|
| Guest | Category names | Upload while submissions are open | See other photos (except on the TV), see votes, see results |
| TV (`/tv`) | Live, non-hidden photos and captions. Reveal data only for steps already revealed | Read only | See vote counts or unrevealed results |
| Kiosk | Live photos and captions | Submit ballots, only with a kiosk token **and** while voting is open | See results |
| Admin | Everything | Everything | — |

## 8. Error and edge cases

| Scenario | Behaviour |
|---|---|
| HEIC photo from an iPhone | iOS Safari converts it to JPEG when it's picked through the file input. The client also re-encodes it to JPEG with a canvas. EXIF orientation is applied by `createImageBitmap(..., {imageOrientation:'from-image'})` |
| Huge photo or slow network | Resized to a 1600px long edge at ~0.85 quality (~300–600 KB) before upload. The server rejects anything over 8 MB |
| The upload reaches S3 but the confirm step fails | The photo stays `pending`, so it's never displayed. The admin can see pending photos and either approve or delete them |
| A category has fewer than 3 photos | The voter must pick all of them (min(3, n)) |
| A photo is hidden after people have voted for it | It's excluded from results and listed in a note on the Results tab |
| A ballot is submitted twice (double tap) | The ballot ID is generated by the client, so the second write is ignored (idempotent) |
| Lambda/API errors | The UI shows a friendly retry. The TV keeps showing its last cached data |

---

# Technical design

## 9. Architecture

```
 Phones / TV / iPad / Admin
            │ HTTPS
            ▼
   CloudFront distribution ── /*         → S3 "site" bucket (private, OAC) — React SPA
            │                └ /photos/* → S3 "photos" bucket (private, OAC)
            └ /api/*  → API Gateway HTTP API → Lambda "api" (Node 22, TypeScript)
                                                  ├─ DynamoDB table "contest" (on-demand)
                                                  ├─ S3 photos: presigned POST for uploads, delete
                                                  └─ SSM Parameter Store: passcode hash, token secret
 Upload: phone ──presigned POST──▶ S3 photos (direct, ≤8 MB, image/jpeg only)
```

- **One domain for everything** (CloudFront in front of the site, the photos and the API), so no CORS is needed.
- **Live updates by polling.** The TV re-fetches the photo list at each category change and polls `/api/state` every 2 seconds for reveal mode. The kiosk fetches when a category is opened. That's a few thousand requests per night, which is negligible cost.
- **Region:** `ap-southeast-2` (Sydney), the closest to NZ.

## 10. Data model — DynamoDB single table `contest` (PK, SK)

| Item | PK | SK | Attributes |
|---|---|---|---|
| Category | `CAT` | `<catId>` | name, sortOrder |
| Photo | `PHOTO` | `<photoId>` | catId, caption, submitterName?, s3Key, status (`pending`/`live`/`hidden`), createdAt |
| Public ballot | `BALLOT` | `<ballotId>` (client UUID) | voterName, picks `{catId: [photoId×≤3]}`, createdAt |
| Admin ballot | `ADMIN_BALLOT` | `current` | ranks `{catId: [1st, 2nd, 3rd]}`, updatedAt |
| Settings | `SETTINGS` | `current` | submissionsOpen, votingOpen, carouselSeconds, reveal `{active, catIndex, step}` |

**Volume:** ≤200 photos, ≤150 ballots. Every read is a single-partition Query. There's no scale concern (CS-007). Photo IDs are random UUIDs, so S3 keys are `photos/<uuid>.jpg` and can't be guessed.

## 11. API (single Lambda, routed internally)

| Method + path | Auth | Purpose |
|---|---|---|
| `GET /api/state` | public | Categories, phase flags, carouselSeconds, reveal state, plus revealed winners up to the current step |
| `GET /api/photos?cat=` | public | Live photos (id, catId, caption, url) — no submitter names |
| `POST /api/uploads` | public, only while submissions are open | Validates the category and caption, writes a `pending` Photo, returns a presigned POST (content-type `image/jpeg`, ≤8 MB, 5-minute expiry) |
| `POST /api/uploads/{id}/confirm` | public | Checks the S3 object exists, then sets status to `live` |
| `POST /api/ballots` | kiosk token, only while voting is open | Validates exactly min(3, n) unique live photos per category, then does a conditional put (idempotent) |
| `GET /api/ballots/check?name=` | kiosk token | Tells the kiosk whether this name has already voted |
| `POST /api/admin/login` | passcode | Returns an admin token (HMAC-signed, 12-hour expiry) |
| `POST /api/admin/kiosk-token` | admin | Issues a long-lived kiosk token, stored in the iPad's localStorage |
| `/api/admin/*` | admin | CRUD for categories and photos, settings, the admin ballot, results, reveal controls |

**Scoring** is a pure function in `shared/scoring.ts` (FR-07): crowd ranking with standard competition ties gives 3/2/1 points, the admin ranking gives 3/2/1, the two are summed, and ties are broken by public votes, then admin rank, then flagged. It's shared by the API and the unit tests.

## 13. Security model

- **Admin auth:** a passcode checked against a scrypt hash stored in SSM SecureString. Tokens are HMAC-signed with a secret stored in SSM (CS-031). The passcode is set at deploy time with a one-off command and is never committed to git.
- **Kiosk token:** stops anyone with the URL from casting ballots from their own phone.
- **Photo privacy:** both buckets block all public access and are readable only through CloudFront Origin Access Control. Keys are unguessable. Every page carries `<meta name="robots" content="noindex">` and the site serves a `robots.txt` that disallows everything. Encryption: SSE-S3 at rest and TLS in transit (CS-032).
- **Abuse limits:** API Gateway throttling (20 requests/second with bursts of 40). Uploads are capped at 8 MB and `image/jpeg`. Inputs are validated server-side and captions are rendered as text (React escapes them).
- **Deployment identity:** your IAM Identity Center SSO session. No IAM users or access keys (CS-030). Root is used only to set up the account.

## 14. Limits

| Limit | Ceiling | Expected |
|---|---|---|
| API GW HTTP API | 10k requests/second per account | <5 requests/second |
| Lambda concurrency | 1,000 (new accounts may start lower) | <10 |
| DynamoDB on-demand | effectively unlimited | trivial |
| S3 storage | — | ~100 MB |

## 15. Cost

Under US$2 for the event: CloudFront free tier, Lambda/API GW/DynamoDB at cents, S3 at cents. All resources are tagged `project=halloween-contest`, `owner=donnie` (CS-037), and an **AWS Budget alert at US$10/month** emails you.

## 16. Environments and deployment

- **Repo layout:** `web/` (Vite + React + TypeScript), `api/` (Lambda TypeScript), `shared/` (types and scoring), `infra/` (CDK TypeScript), `docs/`.
- **Local dev:** `npm run dev` runs the Vite front end against a local Node server that wraps the same Lambda handler. Storage is behind an interface: an in-memory store plus a local folder for photos in dev, and DynamoDB/S3 in AWS. No Docker or AWS is needed to develop.
- **Environments:** one, `prod`, in the new account. A dry run happens in prod before the party, followed by an admin "reset data" before the real event.
- **Deploy:** `npm run deploy` runs the build and then `cdk deploy --profile halloween`. CI/CD is out of scope (a single developer for a single event).
- **Teardown (FR-10):** optionally `aws s3 sync s3://<photos-bucket> ./halloween-2026-photos` to keep the photos, then `cdk destroy`. Every resource has `RemovalPolicy.DESTROY`, and the buckets have `autoDeleteObjects`. The steps are documented in the README.
- **Rollback:** redeploy the previous git commit.

## 17. Test approach

| Layer | What | How |
|---|---|---|
| Unit | Scoring (including the worked example and tie cases) and ballot validation | Vitest |
| API | Handlers against the in-memory store | Vitest |
| Device | AC-02/03 on a real iPhone and Android, AC-05 on the iPad, AC-04 on the TV | Manual script in `docs/uat.md` |
| Dry run | ~10 photos and 5 ballots end to end, then reset | Before 31 Oct |

## Component inventory (CS-052)

| Component | Type | Why it exists |
|---|---|---|
| Web SPA (`web/`) | React app | All four screens. One app means shared styling, types and API client |
| Site bucket | S3 | Hosts the built SPA |
| Photos bucket | S3 | Kept separate from the site so a site redeploy (which prunes files) can never delete photos |
| CloudFront | CDN | Serves the site, photos and API on one HTTPS domain. Keeps the buckets private (OAC) |
| HTTP API | API Gateway | HTTPS entry to the Lambda, with throttling |
| `api` Lambda | Function | All business logic. One function rather than one per route (CS-052) |
| `contest` table | DynamoDB | Atomic writes for ballots and settings. A JSON file in S3 would lose concurrent votes |
| 2 × SSM parameters | Config | Passcode hash and token secret, kept out of code (CS-031) |
| Budget | Billing alert | Cost guardrail for the new personal account |

Not included, deliberately: WebSockets/AppSync (polling is enough), Cognito (no user accounts), WAF (throttling plus the kiosk token are enough for a private link), CI/CD, and separate dev/test environments.

## 18. Solution review findings

Reviewed against the bundled C+S principles (shared sheet not reached) and the AWS Well-Architected baseline. Platform: AWS. 9 components — proportionate.

| Finding | Severity | Principle | Resolution |
|---|---|---|---|
| Photos of children are stored in the cloud | block → resolved | CS-015, CS-032 | Private buckets with OAC, unguessable keys, noindex, encryption, full destruction after Halloween. Approved by Donnie |
| A public upload endpoint is open to abuse | warn | AWS › Security › Infrastructure protection | Throttling, size and type limits, submissions toggle, admin moderation. WAF not needed for the risk at hand |
| Public ballot endpoint | warn | AWS › Security | Kiosk token plus a votingOpen check. Honour system accepted (A-04) |
| No CI/CD; deploys are run manually from your laptop | info | CS-035 | Still IaC (CDK), so there's no click-ops. Accepted: one developer, one event |
| Single environment | info | AWS › Ops excellence | A dry run plus a data reset stands in for staging. Accepted |
| Observability | info | CS-036 | CloudWatch Logs on the Lambda and the budget alert. No error alarm — admins are on site watching. Accepted |
| Multi-AZ | met | CS-033 | S3, DynamoDB and Lambda are multi-AZ by default |
| Secrets | met | CS-030/031 | SSM, SSO, no static keys |
| Upload has two steps (create then confirm), so an abandoned upload leaves a `pending` record | info | CS-034 | Pending photos are never shown. The admin can view and clean them up |
