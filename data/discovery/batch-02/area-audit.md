# Batch-02 service-area audit

V1 bounds check on on-file coordinates for the top-10 batch (Overture release 2026-08-19.0).
Verdicts come from bounds math, never from assigned labels. Coordinates are unverified Overture leads: out-of-bounds means reject-from-batch pending verification, not a definitive relocation.

## Findings

## e9845292-8c3a-4ed7-b470-0a06ac43d241 — Cafe Grey

- Assigned area: indiranagar · Coords on file: 12.97920036, 77.64320514
- Address on file: 3rd Floor, No, 421/J, Shri Krishna Temple Rd
- Verdict: in-bounds
- Detail: (12.97920036, 77.64320514) fall inside "indiranagar" bounds (lat 12.97..12.985, lng 77.635..77.645).
- Address check: address names no V1 area

## bbdefb0a-8995-4ec0-99a9-cdd34fc4a713 — ESCAPE ROOM Koramangala (Previously Mystery junkies)

- Assigned area: koramangala · Coords on file: 12.9334769, 77.621912
- Address on file: 12, 3rd Floor Pragati Mansion, 1st Cross Road, 5th Block
- Verdict: in-bounds
- Detail: (12.9334769, 77.621912) fall inside "koramangala" bounds (lat 12.925..12.945, lng 77.61..77.625).
- Address check: address names no V1 area

## df923a9d-91f0-4fc2-b7d3-c02d23fd389d — BOHO Koramangala

- Assigned area: koramangala · Coords on file: 12.9345105, 77.61602946
- Address on file: 105, 1st A cross Rd
- Verdict: in-bounds
- Detail: (12.9345105, 77.61602946) fall inside "koramangala" bounds (lat 12.925..12.945, lng 77.61..77.625).
- Address check: address names no V1 area

## 2927a08c-d8e9-424a-859d-e378efe61116 — Indiranagar Cornerstone Park

- Assigned area: indiranagar · Coords on file: 12.977951, 77.641457
- Address on file: Indiranagar 100 Ft Road
- Verdict: in-bounds
- Detail: (12.977951, 77.641457) fall inside "indiranagar" bounds (lat 12.97..12.985, lng 77.635..77.645).
- Address check: address names its assigned area

## fbda4f0c-4e7b-4f2e-a8cf-d3c6fe032c77 — Blue Tokai Coffee

- Assigned area: koramangala · Coords on file: 12.94071388, 77.62023735
- Address on file: 583 80 Feet Road, 8th Block
- Verdict: in-bounds
- Detail: (12.94071388, 77.62023735) fall inside "koramangala" bounds (lat 12.925..12.945, lng 77.61..77.625).
- Address check: address names no V1 area

## 4cbd052b-2c6a-4af3-8597-1e3bf79e95e8 — St. Patrick's Church

- Assigned area: church-street · Coords on file: 12.97076231, 77.60699654
- Address on file: At Museum Road
- Verdict: in-bounds · Explicit review case
- Detail: Explicit review case. (12.97076231, 77.60699654) fall inside "church-street" bounds (lat 12.97..12.975, lng 77.6..77.61).
- Address check: address names no V1 area

## 6c240e5f-8591-49e6-b4cc-1a30fa5abfe9 — Zion A.G Church

- Assigned area: koramangala · Coords on file: 12.92561631, 77.61541886
- Address on file: 22, Maruthi Nagar Main Rd, beside Amravati Hotel
- Verdict: in-bounds · Explicit review case
- Detail: Explicit review case. (12.92561631, 77.61541886) fall inside "koramangala" bounds (lat 12.925..12.945, lng 77.61..77.625).
- Address check: address names no V1 area

## 8c723c0f-8463-49de-9d39-d71d6ad53471 — Domino's Pizza | Garuda Mall, Bangalore, Karnataka

- Assigned area: church-street · Coords on file: 12.97036447, 77.60858344
- Address on file: Third Floor, Store No. 16, Food Court, Garuda Mall, CTS No. 15, 17, 18, 27, Magarath Road, Mahanagara Palike Ward No. 76
- Verdict: in-bounds
- Detail: (12.97036447, 77.60858344) fall inside "church-street" bounds (lat 12.97..12.975, lng 77.6..77.61).
- Address check: address names no V1 area

## 924377cd-2db0-40c9-ae31-764ee81fe71a — Domino's Pizza | M.G Road, Bangalore

- Assigned area: church-street · Coords on file: 12.97489423, 77.60661881
- Address on file: Church Street Side Entrance Ground Floor, M G Road Metro Station
- Verdict: in-bounds
- Detail: (12.97489423, 77.60661881) fall inside "church-street" bounds (lat 12.97..12.975, lng 77.6..77.61).
- Address check: address names its assigned area

## ee5baef3-0dbe-4e25-9c23-07f0418314f3 — Café Coffee Day

- Assigned area: indiranagar · Coords on file: 12.97547242, 77.64118128
- Address on file: MSK Plaza, 100 Feet Rd
- Verdict: in-bounds
- Detail: (12.97547242, 77.64118128) fall inside "indiranagar" bounds (lat 12.97..12.985, lng 77.635..77.645).
- Address check: address names no V1 area

## Replacements

None — no record was rejected from this batch.

## Coverage after audit

- Areas: {"indiranagar":3,"koramangala":4,"church-street":3}
- Categories: {"Cafe":3,"Activity":1,"Drinks":1,"Outdoor":1,"Culture":2,"Dinner":2}

## Duplicates after audit

None — no shared dedup keys in the final batch.

## Final top 10

## #1 e9845292-8c3a-4ed7-b470-0a06ac43d241
## #2 bbdefb0a-8995-4ec0-99a9-cdd34fc4a713
## #3 df923a9d-91f0-4fc2-b7d3-c02d23fd389d
## #4 2927a08c-d8e9-424a-859d-e378efe61116
## #5 fbda4f0c-4e7b-4f2e-a8cf-d3c6fe032c77
## #6 4cbd052b-2c6a-4af3-8597-1e3bf79e95e8
## #7 6c240e5f-8591-49e6-b4cc-1a30fa5abfe9
## #8 8c723c0f-8463-49de-9d39-d71d6ad53471
## #9 924377cd-2db0-40c9-ae31-764ee81fe71a
## #10 ee5baef3-0dbe-4e25-9c23-07f0418314f3

