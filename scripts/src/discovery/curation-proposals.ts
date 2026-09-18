/**
 * Curated proposals for the 9 non-rejected Batch-01 places.
 *
 * Each proposal was judged by hand from existing verified evidence
 * (official-site copy already fetched into evidence files, dossier values)
 * plus the enrichment rubric. Every value carries its reason and evidence
 * basis; fields without an honest basis are simply absent (left missing).
 * Nothing here touches verified facts, prices, hours, ratings, addresses,
 * or coordinates — and nothing is promoted to production by this file.
 *
 * Validate with curateAttributes before use; the propose CLI refuses to
 * emit anything that fails the rubric.
 */

export interface PlaceProposal {
  overture_id: string;
  name: string;
  service_area: string;
  category: string;
  bundle: Record<string, unknown>;
}

export const PROPOSALS: PlaceProposal[] = [
  {
    overture_id: "b4c6442a-5bf8-4a88-80eb-8c1a25882f4c",
    name: "The Reservoire",
    service_area: "koramangala",
    category: "Drinks",
    bundle: {
      typicalVisitDuration: {
        value: 75,
        reason: "Evening cocktail-bar visit: drinks plus music, per the Drinks planning band.",
      },
      activities: {
        values: ["drinks"],
        reason: "Over 200 cocktails on the official menu; music nights support drinks-first outing.",
      },
      vibe: {
        value: "Lively Manhattan-style cocktail bar",
        reason: "Official site describes Manhattan-style cocktail culture with music nights.",
      },
    },
  },
  {
    overture_id: "debcb6e0-1cb7-49ea-bc85-77009d6626c4",
    name: "Shades Creative Gallery",
    service_area: "koramangala",
    category: "Culture",
    bundle: {
      typicalVisitDuration: {
        value: 60,
        reason: "Gallery walkthrough of current exhibitions, per the Culture planning band.",
      },
      activities: {
        values: ["culture", "art"],
        reason: "Contemporary art gallery with rotating exhibitions on the official site.",
      },
      vibe: {
        value: "Spacious, inspiring gallery",
        reason: "Official site presents a spacious venue for viewing diverse paintings.",
      },
    },
  },
  {
    overture_id: "ecd46ce8-af8c-49a5-820e-9c19777ecd40",
    name: "Third Wave Coffee",
    service_area: "indiranagar",
    category: "Cafe",
    bundle: {
      typicalVisitDuration: {
        value: 35,
        reason: "Coffeehouse stop per the Cafe planning band.",
      },
      activities: {
        values: ["coffee"],
        reason: "Specialty coffee house per the official store page.",
      },
    },
  },
  {
    overture_id: "b0e262d1-f29f-49d3-9463-4e2353119b69",
    name: "The Amazing Escape - Escape Room Adventure",
    service_area: "indiranagar",
    category: "Activity",
    bundle: {
      activities: {
        values: ["active"],
        reason: "Escape rooms plus mini-golf per the official site; participatory play.",
      },
      suitableFor: {
        values: ["family", "friends"],
        reason: "Official site addresses families and friends directly for games and parties.",
      },
      vibe: {
        value: "High-energy and playful",
        reason: "Official site frames high-energy excitement and playful competition.",
      },
    },
  },
  {
    overture_id: "282cffac-5afb-41f7-9e3b-536e9aed9681",
    name: "Dyu Art Cafe",
    service_area: "koramangala",
    category: "Cafe",
    bundle: {
      typicalVisitDuration: {
        value: 35,
        reason: "Art-cafe coffee stop per the Cafe planning band.",
      },
      activities: {
        values: ["coffee"],
        reason: "Signature coffee menu on the official site.",
      },
      vibe: {
        value: "Lively yet peaceful art cafe",
        reason: "Official site describes an atmosphere both lively and peaceful with art throughout.",
      },
    },
  },
  {
    overture_id: "5ae1d62d-713f-4794-a7cf-8bbf068557fe",
    name: "Smoor Lounge",
    service_area: "koramangala",
    category: "Dessert",
    bundle: {
      typicalVisitDuration: {
        value: 20,
        reason: "Chocolate lounge tasting stop per the Dessert planning band.",
      },
      activities: {
        values: ["food"],
        reason: "Chocolates and desserts per the official brand site.",
      },
      vibe: {
        value: "Premium chocolate lounge",
        reason: "Official site positions premium couverture indulgence.",
      },
    },
  },
  {
    overture_id: "9ca66fd1-ad63-4223-981a-308be6c20065",
    name: "Amoeba",
    service_area: "church-street",
    category: "Activity",
    bundle: {
      typicalVisitDuration: {
        value: 75,
        reason: "Bowling-alley session per the Activity planning band.",
      },
      activities: {
        values: ["active"],
        reason: "Bowling, arcade, and sports bar per the official site.",
      },
      suitableFor: {
        values: ["couple", "friends", "family"],
        reason: "Official site addresses dates for two, besties groups, and extended family.",
      },
      vibe: {
        value: "Neon-lit, high-energy arcade",
        reason: "Official site presents neon, high-energy bowling and arcade play.",
      },
    },
  },
  {
    overture_id: "5e0b86a0-0860-4bcd-be56-fc4ea08c4db3",
    name: "Polar Bear Ice Cream Sundaes",
    service_area: "koramangala",
    category: "Dessert",
    bundle: {
      typicalVisitDuration: {
        value: 20,
        reason: "Sundae stop per the Dessert planning band.",
      },
      activities: {
        values: ["food"],
        reason: "Ice cream sundaes per the official brand site.",
      },
    },
  },
  {
    overture_id: "7ef6492f-c7c3-4890-b17a-d32d4afdabf5",
    name: "The Grid",
    service_area: "koramangala",
    category: "Activity",
    bundle: {
      typicalVisitDuration: {
        value: 75,
        reason: "Multi-game arena session per the Activity planning band.",
      },
      activities: {
        values: ["active"],
        reason: "Seven bookable games (bowling, laser tag, VR) on the official pricing page.",
      },
      vibe: {
        value: "High-energy gaming arena",
        reason: "Official site frames high-energy excitement across all attractions.",
      },
    },
  },
];
