# 🎃 Halloween Costume Contest

A mobile-friendly web app for the annual costume contest:

| Screen | URL | Used on |
|---|---|---|
| **Submit** | `/` | Guests' phones — pick a category, take or choose a photo, add a title |
| **TV** | `/tv` | The TV — a 3×3 carousel per category, then the winners reveal |
| **Vote** | `/vote` | The iPad kiosk — enter your name, pick 3 per category, submit |
| **Admin** | `/admin` | Donnie & Bianca — categories, moderation, our vote, results, reveal |

**Scoring:** two equal juries. The crowd's top 3 by votes get 3/2/1 points and our 1st/2nd/3rd get 3/2/1 points. Total = both. Ties go to more public votes, then our ranking.

Requirements, design and build tasks are in [`docs/`](docs/).

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173 (admin passcode in dev: `boo`). Data is kept in `.dev-data/` (git-ignored). Delete that folder to start fresh.

```bash
npm test          # scoring + API tests
npm run typecheck
```

## Deploy to AWS

One-off account setup: see [docs/aws-account-setup.md](docs/aws-account-setup.md). Then:

```bash
aws sso login --profile halloween
BUDGET_EMAIL=you@example.com npm run deploy          # prints SiteUrl
AWS_PROFILE=halloween npm run set-passcode            # first deploy only
```

Then open `<SiteUrl>/admin`, log in, and on the iPad use **Contest → Set up this device as the voting kiosk**.

**Before the party:** run through [docs/uat.md](docs/uat.md), then use **Admin → Contest → Reset** to clear the test data.

## Teardown (after Halloween)

```bash
# Optional: keep a copy of the photos
aws s3 sync s3://<PhotosBucketName> ./halloween-photos --profile halloween

npm run destroy -w infra                               # deletes everything, photos included
aws ssm delete-parameters --names /halloween-contest/admin-passcode-hash /halloween-contest/token-secret --profile halloween
```

Then, if you no longer need the AWS account: **Organizations → halloween-contest → Close account**.
