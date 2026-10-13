# Build Tasks — Halloween Costume Contest App

**Derived from:** `02-design-halloween-contest.md` (confirmed 2026-10-13) · **Env:** local dev → AWS `halloween` account (ap-southeast-2)

| ID | Task | Component | Depends on | Est (h) | Acceptance test |
|---|---|---|---|---|---|
| T-01 | Scaffold an npm-workspaces monorepo (`shared`, `api`, `web`, `infra`), TS config, Vitest, `.gitignore`, README | repo | — | 1 | `npm install` and `npm test` run clean |
| T-02 | Domain types and the rank-points scoring function, plus ballot validation | `shared/` | T-01 | 2 | Unit tests: worked example, crowd ties, final ties, <3 photos |
| T-03 | Storage interface with an in-memory/local-disk implementation and a DynamoDB/S3 implementation | `api/src/store*` | T-02 | 3 | API tests pass on the memory store |
| T-04 | API router: state, photos, uploads + confirm, ballots, admin (login, kiosk token, categories, photos, settings, admin ballot, results, reveal, reset) | `api/src/handler.ts` | T-03 | 4 | Vitest API tests cover AC-06/08/09/10 |
| T-05 | Local dev server wrapping the handler, plus local photo upload/serve | `api/src/dev-server.ts` | T-04 | 1 | `npm run dev` gives a working app at localhost |
| T-06 | Web shell: router, Halloween theme, API client | `web/` | T-01 | 1.5 | All four routes render |
| T-07 | Submit screen with client-side resize/orientation | `web/src/pages/Submit.tsx` | T-05, T-06 | 3 | AC-02/03 on iPhone and Android |
| T-08 | TV carousel, QR code, reveal mode | `web/src/pages/Tv.tsx` | T-06 | 3 | AC-04, FR-09 on the TV |
| T-09 | Voting kiosk: name, categories, grid, swipe view, submit, idle reset | `web/src/pages/Vote.tsx` | T-06 | 4 | AC-05/06 on the iPad |
| T-10 | Admin: categories, photos, contest settings, admin ballot, results, reveal | `web/src/pages/Admin.tsx` | T-06 | 4 | AC-01/07/08 |
| T-11 | CDK stack: buckets, CloudFront (OAC), HTTP API, Lambda, DynamoDB, SSM, budget, tags, destroy policies | `infra/` | T-04 | 3 | `cdk synth` is clean, then `cdk deploy` succeeds |
| T-12 | Deploy plus admin passcode setup script | `scripts/` | T-11, AWS account | 1 | The prod URL works end to end |
| T-13 | UAT script and dry run (10 photos, 5 ballots), then reset | `docs/uat.md` | T-12 | 2 | All ACs ticked on real devices |
| T-14 | Teardown runbook | README | T-11 | 0.5 | Documented |

**Total ≈ 33 h.** No Flow components, so `cs-flow-build` isn't needed.
