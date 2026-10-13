# UAT checklist — run before 31 Oct

Use the deployed URL. Tick each item on the real devices.

| ✔ | AC | Device | Steps | Expected |
|---|---|---|---|---|
| ☐ | AC-01 | Laptop | Admin → Categories → add "Test cat", move it to the top | Shows first on the submit page, TV and kiosk (empty categories are skipped on TV and in voting) |
| ☐ | AC-02 | iPhone | Scan the QR code → pick a category → **Take photo** → caption → Submit | "You're in!" appears and the photo shows on the TV within one cycle |
| ☐ | AC-02 | Android | Same as above | Same |
| ☐ | AC-03 | iPhone | **Choose from library**, using a portrait HEIC photo | Uploads the right way up |
| ☐ | AC-04 | TV | Add 10+ photos to one category | Two screens for that category (9 + rest), then the next category, then it loops |
| ☐ | AC-08 | Phone | Open /admin and enter the wrong passcode | "Wrong passcode" |
| ☐ | — | iPad | Admin → Contest → **Set up this device as the voting kiosk** | Opens /vote |
| ☐ | AC-05 | iPad | Turn voting on. Vote as "Test" and try to Submit with only 2 picks in one category | Submit is disabled |
| ☐ | AC-06 | iPad | In the viewer, try to pick a 4th photo | "Already picked 3" |
| ☐ | AC-05 | iPad | Complete and submit | Thank-you screen, then it resets after 5 seconds |
| ☐ | — | iPad | Start voting as "Test" again | A duplicate-name warning appears |
| ☐ | AC-10 | Laptop | Admin → Photos → hide one | It disappears from the TV and kiosk |
| ☐ | AC-09 | Phone | Turn submissions off and reload the submit page | "Submissions are closed" |
| ☐ | AC-07 | Laptop | Our vote → rank 1/2/3 → Results | Totals = crowd points + our points, and they match a hand calculation |
| ☐ | FR-09 | TV + phone | Reveal → Start → step through | The TV follows within about 2 seconds, showing 3rd → 2nd → 1st |
| ☐ | — | Laptop | Contest → type RESET → delete all | Photos and votes are gone; categories stay |
