# Batch-02 top-10 venue identity audit

Exact-identity check for the 10 records ranked highest for production readiness (Overture release 2026-08-19.0).
Overture name/address/coordinates compared against each record's cited website/source identity. No fetching, no invented facts, no enrichment.
Original Overture identity is preserved verbatim; nothing here corrects records.

Counts — verified: 0, conflicting: 1, needs_manual_review: 9.

## #1 Cafe Grey

- Overture ID: e9845292-8c3a-4ed7-b470-0a06ac43d241 · Area: indiranagar · Identity: needs_manual_review
- Overture address: 3rd Floor, No, 421/J, Shri Krishna Temple Rd
- Overture coordinates: 12.97920036, 77.64320514
- Cited source: https://dongle.community/cafe-to-work-in-indiranagar/ ("Café Grey – A Premium Workspace Café in Indiranagar") · reachable: true
- Evidence:
  - Recorded name corroborated by cited source ("Café Grey – A Premium Workspace Café in Indiranagar").
  - On-file pin (12.97920036, 77.64320514) falls inside "indiranagar" V1 bounds (lat 12.97..12.985, lng 77.635..77.645); pin itself still needs human confirmation.
  - Recorded address corroborated by excerpts; preserved verbatim.
- Recommended action: Before enrichment: confirm the pin on site; verify independently of the service-area assignment.

## #2 ESCAPE ROOM Koramangala (Previously Mystery junkies)

- Overture ID: bbdefb0a-8995-4ec0-99a9-cdd34fc4a713 · Area: koramangala · Identity: conflicting
- Overture address: 12, 3rd Floor Pragati Mansion, 1st Cross Road, 5th Block
- Overture coordinates: 12.9334769, 77.621912
- Cited source: https://escapemgm.com/ ("Home") · reachable: true
- Evidence:
  - Recorded name is conflicting in dossier: fetched page title "Home" does not corroborate "ESCAPE ROOM Koramangala (Previously Mystery junkies)". Resolve the operating name against the cited source before enrichment.
  - Name records rename history ("ESCAPE ROOM Koramangala (Previously Mystery junkies)"); confirm the current operating name on site, keep the Overture original.
  - On-file pin (12.9334769, 77.621912) falls inside "koramangala" V1 bounds (lat 12.925..12.945, lng 77.61..77.625); pin itself still needs human confirmation.
  - Recorded address corroborated by excerpts; preserved verbatim.
- Separate entities:
  - No on-file link to b0e262d1-f29f-49d3-9463-4e2353119b69 (The Amazing Escape - Escape Room Adventure) in this record's own source — stays a separate entity.
- Recommended action: Before enrichment: resolve the conflict(s) above against the cited source; confirm the pin on site; keep separate from the listed entity until its own source proves identity; verify independently of the service-area assignment.

## #3 BOHO Koramangala

- Overture ID: df923a9d-91f0-4fc2-b7d3-c02d23fd389d · Area: koramangala · Identity: needs_manual_review
- Overture address: 105, 1st A cross Rd
- Overture coordinates: 12.9345105, 77.61602946
- Cited source: http://www.bohothebar.com/ ("BOHO Bar Bangalore – Rooftop Dining, Cocktails &amp; Nightlife Fun") · reachable: true
- Evidence:
  - Recorded name corroborated by cited source ("BOHO Bar Bangalore – Rooftop Dining, Cocktails &amp; Nightlife Fun").
  - On-file pin (12.9345105, 77.61602946) falls inside "koramangala" V1 bounds (lat 12.925..12.945, lng 77.61..77.625); pin itself still needs human confirmation.
  - Recorded address unconfirmed (status: needs_manual_review); confirm on site, do not rewrite.
- Recommended action: Before enrichment: confirm the address on site; confirm the pin on site; verify independently of the service-area assignment.

## #4 Indiranagar Cornerstone Park

- Overture ID: 2927a08c-d8e9-424a-859d-e378efe61116 · Area: indiranagar · Identity: needs_manual_review
- Overture address: Indiranagar 100 Ft Road
- Overture coordinates: 12.977951, 77.641457
- Cited source: http://www.cornerstoneindia.in/ ("HOME | CornerStone India") · reachable: true
- Evidence:
  - Recorded name corroborated by cited source ("HOME | CornerStone India").
  - On-file pin (12.977951, 77.641457) falls inside "indiranagar" V1 bounds (lat 12.97..12.985, lng 77.635..77.645); pin itself still needs human confirmation.
  - Recorded address unconfirmed (status: needs_manual_review); confirm on site, do not rewrite.
- Recommended action: Before enrichment: confirm the address on site; confirm the pin on site; verify independently of the service-area assignment.

## #5 Blue Tokai Coffee

- Overture ID: fbda4f0c-4e7b-4f2e-a8cf-d3c6fe032c77 · Area: koramangala · Identity: needs_manual_review
- Overture address: 583 80 Feet Road, 8th Block
- Overture coordinates: 12.94071388, 77.62023735
- Cited source: http://www.bluetokaicoffee.com/ ("Buy Freshly Roasted Coffee Beans | Blue Tokai Coffee Roasters") · reachable: true
- Evidence:
  - Recorded name corroborated by cited source ("Buy Freshly Roasted Coffee Beans | Blue Tokai Coffee Roasters").
  - On-file pin (12.94071388, 77.62023735) falls inside "koramangala" V1 bounds (lat 12.925..12.945, lng 77.61..77.625); pin itself still needs human confirmation.
  - Recorded address unconfirmed (status: needs_manual_review); confirm on site, do not rewrite.
- Recommended action: Before enrichment: confirm the address on site; confirm the pin on site; verify independently of the service-area assignment.

## #6 St. Patrick's Church

- Overture ID: 4cbd052b-2c6a-4af3-8597-1e3bf79e95e8 · Area: church-street · Identity: needs_manual_review · Explicit review case
- Review direction: Confirm whether the on-file Museum Road record denotes the Brigade Road church entity or a distinct entity; verify independently of the church-street area assignment.
- Overture address: At Museum Road
- Overture coordinates: 12.97076231, 77.60699654
- Cited source: http://stpatricksblr.com ("St. Patrick's Church") · reachable: true
- Evidence:
  - Recorded name corroborated by cited source ("St. Patrick's Church").
  - On-file pin (12.97076231, 77.60699654) falls inside "church-street" V1 bounds (lat 12.97..12.975, lng 77.6..77.61); pin itself still needs human confirmation.
  - Recorded address unconfirmed (status: needs_manual_review); confirm on site, do not rewrite.
- Recommended action: Before enrichment: confirm the address on site; confirm the pin on site; verify independently of the service-area assignment.

## #7 Zion A.G Church

- Overture ID: 6c240e5f-8591-49e6-b4cc-1a30fa5abfe9 · Area: koramangala · Identity: needs_manual_review · Explicit review case
- Review direction: Preserve the on-file address verbatim; confirm which address the venue's own site states before any correction.
- Overture address: 22, Maruthi Nagar Main Rd, beside Amravati Hotel
- Overture coordinates: 12.92561631, 77.61541886
- Cited source: https://www.zionagmadiwala.com/ ("Zion AG Church") · reachable: true
- Evidence:
  - Recorded name corroborated by cited source ("Zion AG Church").
  - On-file pin (12.92561631, 77.61541886) falls inside "koramangala" V1 bounds (lat 12.925..12.945, lng 77.61..77.625); pin itself still needs human confirmation.
  - Recorded address unconfirmed (status: needs_manual_review); confirm on site, do not rewrite.
- Recommended action: Before enrichment: confirm the address on site; confirm the pin on site; verify independently of the service-area assignment.

## #8 Domino's Pizza | Garuda Mall, Bangalore, Karnataka

- Overture ID: 8c723c0f-8463-49de-9d39-d71d6ad53471 · Area: church-street · Identity: needs_manual_review
- Overture address: Third Floor, Store No. 16, Food Court, Garuda Mall, CTS No. 15, 17, 18, 27, Magarath Road, Mahanagara Palike Ward No. 76
- Overture coordinates: 12.97036447, 77.60858344
- Cited source: https://dominos.co.in/ ("Domino’s Pizza – Order Online | Get 2 Regular Pizza @99 Each") · reachable: true
- Evidence:
  - Recorded name corroborated by cited source ("Domino’s Pizza – Order Online | Get 2 Regular Pizza @99 Each").
  - On-file pin (12.97036447, 77.60858344) falls inside "church-street" V1 bounds (lat 12.97..12.975, lng 77.6..77.61); pin itself still needs human confirmation.
  - Recorded address unconfirmed (status: needs_manual_review); confirm on site, do not rewrite.
- Branches:
  - Treat as a separate entity from 924377cd-2db0-40c9-ae31-764ee81fe71a (Domino's Pizza | M.G Road, Bangalore); each branch cites only its own source below.
- Recommended action: Before enrichment: confirm the address on site; confirm the pin on site; confirm this branch outlet (never merge branches); verify independently of the service-area assignment.

## #9 Domino's Pizza | M.G Road, Bangalore

- Overture ID: 924377cd-2db0-40c9-ae31-764ee81fe71a · Area: church-street · Identity: needs_manual_review
- Overture address: Church Street Side Entrance Ground Floor, M G Road Metro Station
- Overture coordinates: 12.97489423, 77.60661881
- Cited source: https://dominos.co.in/ ("Domino’s Pizza – Order Online | Get 2 Regular Pizza @99 Each") · reachable: true
- Evidence:
  - Recorded name corroborated by cited source ("Domino’s Pizza – Order Online | Get 2 Regular Pizza @99 Each").
  - On-file pin (12.97489423, 77.60661881) falls inside "church-street" V1 bounds (lat 12.97..12.975, lng 77.6..77.61); pin itself still needs human confirmation.
  - Recorded address unconfirmed (status: needs_manual_review); confirm on site, do not rewrite.
- Branches:
  - Treat as a separate entity from 8c723c0f-8463-49de-9d39-d71d6ad53471 (Domino's Pizza | Garuda Mall, Bangalore, Karnataka); each branch cites only its own source below.
- Recommended action: Before enrichment: confirm the address on site; confirm the pin on site; confirm this branch outlet (never merge branches); verify independently of the service-area assignment.

## #10 Café Coffee Day

- Overture ID: ee5baef3-0dbe-4e25-9c23-07f0418314f3 · Area: indiranagar · Identity: needs_manual_review
- Overture address: MSK Plaza, 100 Feet Rd
- Overture coordinates: 12.97547242, 77.64118128
- Cited source: http://www.pinterest.com/cafecoffeeday ("Cafe Coffee Day (cafecoffeeday) - Profile | Pinterest") · reachable: true
- Evidence:
  - Recorded name corroborated by cited source ("Cafe Coffee Day (cafecoffeeday) - Profile | Pinterest").
  - On-file pin (12.97547242, 77.64118128) falls inside "indiranagar" V1 bounds (lat 12.97..12.985, lng 77.635..77.645); pin itself still needs human confirmation.
  - Recorded address unconfirmed (status: needs_manual_review); confirm on site, do not rewrite.
- Recommended action: Before enrichment: confirm the address on site; confirm the pin on site; verify independently of the service-area assignment.

