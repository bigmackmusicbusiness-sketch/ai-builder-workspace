# Manifest-author prompt template

> Reused 101 times during the niche-expansion update. Sub-agents receive
> this prompt with `niche_slug`, `niche_label`, `vertical_context` filled in,
> plus the existing exemplar manifests as read-only reference.

---

## Prompt body

You produce ONE niche manifest JSON for the AI Builder Workspace website
builder. The manifest tells the planner agent which palette, voice, page
structure, image style, and SEO posture to use when a user describes a
project that matches this niche.

### Inputs (filled in by the caller)

```
niche_slug:       <kebab-case>          e.g. "tree-service"
niche_label:      <Title Case>          e.g. "Tree Service"
vertical_context: <category>            e.g. "home-services" | "auto" | "food"
```

### Required fields (must match `NicheManifest` Zod in `apps/api/src/agent/phases/plan.ts:57-70`)

```jsonc
{
  "niche":                "<niche_slug>",
  "label":                "<niche_label>",
  "triggers": [
    // 10-14 lowercase keywords/phrases a real user would type when
    // describing this kind of business. Avoid words that overlap heavily
    // with sibling niches (e.g. don't put "studio" alone — pair with
    // a disambiguator like "yoga studio").
  ],
  "default_sitemap": [
    // 4-7 pages. Slug must come from this allowlist:
    //   index, about, services, menu, gallery, book, contact, visit,
    //   pricing, team, faq, listings, programs, schedule, work,
    //   journal, neighborhoods, story, beans, attorneys, results,
    //   insights, our-craft, locations
    // Each page is { "slug": "<...>", "role": "<short role string>" }
    // The role field is human-readable, e.g. "hero+search+featured-listings"
  ],
  "compliance_blocks": [
    // Empty array unless the niche has regulated content. Examples:
    //   real-estate-agent: ["equal-housing-opportunity-logo", "fair-housing-disclaimer", "broker-license-footer", "mls-attribution", "ada-accessibility-statement"]
    //   law-firm:          ["attorney-advertising-disclaimer", "no-legal-advice-disclaimer", "bar-license-footer"]
    //   dental-practice:   ["hipaa-privacy-link-footer"]
    //   specialty-cafe:    ["allergen-disclaimer-footer"]
    //   chiropractor:      ["chiropractic-disclaimer", "results-may-vary"]
    //   med-spa:           ["medical-supervision-disclaimer", "results-may-vary"]
    //   insurance-agent:   ["insurance-license-footer", "carrier-affiliations"]
    //   mortgage-broker:   ["nmls-id-footer", "equal-housing-lender-logo"]
    //   accounting:        ["cpa-license-footer", "no-tax-advice-disclaimer-without-engagement"]
    // Compliance is the LAW; if you're not sure if a block applies, include it.
  ],
  "schema_org_primary": "<exact schema.org type>",
  // Pick from this vetted list:
  //   AutoBodyShop, AutoDealer, AutoRepair, AutoWash, BeautySalon, Bakery,
  //   Bookstore, Brewery, CafeOrCoffeeShop, ChildCare, Chiropractor,
  //   Dentist, DryCleaningOrLaundry, ElectronicsStore, Electrician,
  //   ExerciseGym, FastFoodRestaurant, FinancialService, Florist,
  //   FoodEstablishment, FurnitureStore, GeneralContractor, HairSalon,
  //   HealthAndBeautyBusiness, HomeAndConstructionBusiness, HVACBusiness,
  //   InsuranceAgency, JewelryStore, LegalService, LocalBusiness,
  //   LodgingBusiness, MovingCompany, MusicSchool, NailSalon, NightClub,
  //   Optician, OutdoorActivities, Painting, PetStore, Pharmacy,
  //   PhotographyBusiness, Physiotherapist, Plumber, ProfessionalService,
  //   RealEstateAgent, Restaurant, RoofingContractor, SkiResort, SportsClub,
  //   Store, TattooParlor, TaxiService, TouristAttraction, TravelAgency,
  //   VeterinaryCare
  "voice_template": "<8-15 word voice description>",
  // Concrete adjectives. No AI-slop.
  // Examples (from existing manifests):
  //   "warm, knowledgeable, slightly nerdy about beans, conversational"
  //   "warm-professional, locally knowledgeable, consultative, confident without pressure"
  //   "authoritative, measured, trust-building, plain-English where possible without diluting precision"
  // Forbidden: amazing, world-class, cutting-edge, transformative,
  //            next-level, unlock, elevate, leverage, revolutionary,
  //            game-changing, take it to the next, unleash.
  "palettes": [
    // EXACTLY 6 palettes, each with name + 4 hex codes.
    // Hexes should be: 1 brand/accent, 1 light bg, 1 mid surface, 1 deep ink.
    // Niche-appropriate (warm earthy for cafes, navy for finance, etc).
    // Avoid pastel-bingo for serious verticals.
    { "name": "<kebab-case-name>", "hexes": ["#XXXXXX", "#XXXXXX", "#XXXXXX", "#XXXXXX"] },
    // ... 5 more
  ],
  "section_library": [
    // 12-18 ABW section IDs. Cross-reference existing manifests.
    // Common ones: hero, page-hero, feature-strip, testimonial-strip,
    //              gallery-grid, contact-form, footer, address-card,
    //              hours-strip, story-strip, pricing-table, faq-accordion,
    //              cta-banner, blog-feed, team-grid
    // Niche-specific examples:
    //   real-estate: search-bar, featured-listing-grid, property-card, neighborhood-card, valuation-cta
    //   cafe: menu-preview, menu-grid, today-pourover, origin-grid, roast-notes
    //   law: practice-area-grid, attorney-card, results-table, free-consult-cta
  ],
  "image_directives": "<3-5 sentences>",
  // Tell the image-gen prompt builder what to produce AND what to avoid.
  // Example: "warm specialty coffee photography. Espresso machines, ceramic cups,
  //           single-origin beans, cafe interiors with natural light. Avoid
  //           generic 'business stock' aesthetics. Candid > posed. Shallow
  //           depth of field. Golden hour or soft natural light preferred."
  "voice_pet_words": [
    // 6-10 jargon words real practitioners use. These get woven into copy.
    // Real-estate examples: "home", "neighborhood", "local", "market",
    //                       "trusted", "guidance", "lifestyle"
    // Cafe examples: "roast", "origin", "varietal", "extraction", "crema",
    //                "tasting notes", "honest", "small-batch"
  ],
  "primary_keywords": [
    // 4-6 SEO-primary words. These go into the title tag template.
  ]
}
```

### Output rules

- Bare JSON only. No markdown fences. No prose before or after.
- Validate against the Zod schema before returning.
- Every string in `voice_template`, `image_directives`, and palette names
  passes the slop-blocker word list above.

### Reference exemplars (read these for tone + depth)

- `apps/api/src/agent/skills/types/website/niches/specialty-cafe.json` —
  taste-driven, warm, earthy palette set, sensory voice
- `apps/api/src/agent/skills/types/website/niches/real-estate-agent.json` —
  regulated industry with 5 compliance blocks, professional voice
- `apps/api/src/agent/skills/types/website/niches/home-services-contractor.json` —
  trade vertical, no-nonsense voice, broad section library
- `apps/api/src/agent/skills/types/website/niches/law-firm.json` —
  authoritative, precise, attorney-advertising compliant

Match the depth of these exemplars. Don't ship a skeleton; the planner uses
every field at runtime.

---

## Companion: ad-copy patterns

After producing the manifest, ALSO produce 3 ad-copy patterns for
`apps/api/src/routes/ads/copyPatterns.ts`. One per framework:

```jsonc
{
  "<niche_slug>": [
    {
      "framework": "specific-value-prop",
      "headline":  "<one short specific claim, ≤60 chars>",
      "primary":   "<one outcome + concrete fact + next step, ≤200 chars>"
    },
    {
      "framework": "pattern-interrupt",
      "headline":  "<opens with a number, named place, or unexpected fact>",
      "primary":   "<connects the pattern interrupt to why the customer should care>"
    },
    {
      "framework": "before-after",
      "headline":  "<old state → new state>",
      "primary":   "<old in one sentence + new in one sentence + the bridge is the offer>"
    }
  ]
}
```

Each line passes the slop blocker. Check yourself before returning.
