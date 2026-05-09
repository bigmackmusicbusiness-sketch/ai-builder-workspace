// apps/api/src/routes/ads/copyPatterns.ts — niche-aware ad copy templates.
//
// The Ads Studio reads the niche from the linked project (or the niche the
// user selects in the modal when there's no project). For each niche we
// store a handful of high-converting headline + primary-text frames. These
// are used to:
//   1. Seed the copy fields when a new ad is created (so the user is never
//      staring at a blank field).
//   2. Generate A/B variants on Render so the user gets multiple angles
//      side-by-side.
//
// Every pattern aims at the "specific value prop / pattern interrupt /
// before-after" framework — no generic "amazing transformative results"
// phrasing. See the slopBlocker module for the words we explicitly reject.

export type FrameworkId = 'specific-value-prop' | 'pattern-interrupt' | 'before-after';

export interface CopyPattern {
  framework: FrameworkId;
  headline:  string;     // short — fits Meta's 27/40/40 char limits where possible
  primary:   string;     // longer — under 125 for Feed
}

/** Patterns map: niche slug → ordered list of patterns. The Studio cycles
 *  through them (or picks deterministically based on the framework button
 *  the user clicked).
 *
 *  Slug names MUST match the canonical website-niche manifests in
 *  apps/api/src/agent/skills/types/website/niches/*.json — that file
 *  set is the source of truth for niche detection. When the planner
 *  tags a project as `gym-fitness` and the Ads Studio later asks for
 *  starter copy, the picker requests `niche=gym-fitness` and this map
 *  has to respond. Keep the keys in lockstep with the manifest filenames. */
export const COPY_PATTERNS: Record<string, CopyPattern[]> = {
  'agency-studio': [
    {
      framework: 'specific-value-prop',
      headline:  'Brand identity. Two weeks. Fixed scope.',
      primary:   'Logo system, type stack, color palette, and a 12-page brand book. Two-week turnaround, fixed at $14k. Founders only — three slots a quarter.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  '90% of our work comes from referrals.',
      primary:   "We don't pitch and we don't bid. Every project that lands here came from someone who already worked with us. That's the standard we hold.",
    },
    {
      framework: 'before-after',
      headline:  '"We need a logo" → 14 brand systems shipped.',
      primary:   "What founders ask for is a logo. What they need is a system that holds up across packaging, web, deck, and ads. We build the second one.",
    },
  ],
  'creative-portfolio': [
    {
      framework: 'specific-value-prop',
      headline:  '12 years editorial. 3 SXSW selections.',
      primary:   "Documentary cinematographer based in Austin. Editorial work for The New Yorker, NYT Magazine, ESPN. Available for narrative + commercial projects starting Q3.",
    },
    {
      framework: 'pattern-interrupt',
      headline:  'I shot 41 weddings before quitting them.',
      primary:   "After 41 weddings I learned what I actually love is documentary work. Now I shoot one wedding a year — for friends — and the rest is editorial.",
    },
    {
      framework: 'before-after',
      headline:  'Stock-looking → archival.',
      primary:   "The difference between forgettable and archival is light. I shoot in available light, on film when it matters, and I edit for one mood per frame.",
    },
  ],
  'dental-practice': [
    {
      framework: 'specific-value-prop',
      headline:  'Same-day crowns. No second visit.',
      primary:   'CEREC milling on-site means crowns done in one appointment. No temporaries, no two-week wait. Most insurance accepted; we file for you.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  "We don't have a TV in the waiting room.",
      primary:   "We don't have a TV in the waiting room because no one waits more than 8 minutes. We schedule for actual appointment length, not 'plus or minus 30.'",
    },
    {
      framework: 'before-after',
      headline:  'Dreaded the dentist → looks forward to it.',
      primary:   "If you grew up associating the dentist with pain or judgment, we get it. Modern anesthesia, no lectures about flossing, and a hygienist who'll explain everything before she does it.",
    },
  ],
  'e-commerce-boutique': [
    {
      framework: 'specific-value-prop',
      headline:  'Hand-loomed wool throws. Made in Maine.',
      primary:   'Heirloom-weight wool throws woven on antique looms in our Bath, ME workshop. 60×80, finished edges, a 100-year piece. Free shipping on orders $200+.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  '11 fabrics. 3 cuts. That\'s the whole catalog.',
      primary:   "We don't drop new styles every month. Three silhouettes, eleven fabrics, sized 0-22. Buy one and own it for a decade — that's the brief.",
    },
    {
      framework: 'before-after',
      headline:  'Fast fashion regret → a piece you keep.',
      primary:   "If your closet is 80% pieces you'll donate next year, you've already paid for what we make twice over. One linen shirt, $189, made to last.",
    },
  ],
  'gym-fitness': [
    {
      framework: 'specific-value-prop',
      headline:  '5:30am barbell class. Coach-led, 8 max.',
      primary:   'Strength program written by a USAW-1 coach. 8-person cap so form gets corrected every set. Mon/Wed/Fri 5:30am.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'No mirrors. No music. No screens.',
      primary:   "Old-school weight room. The only feedback you get is your coach's voice and the clock on the wall. 6 weeks, 18 sessions, $240.",
    },
    {
      framework: 'before-after',
      headline:  'Couch → 5K in 9 weeks.',
      primary:   '12-person beginner running group. Coach-led, accountability check-ins, no judgment. 9 weeks from 0 to a Saturday-morning 5K. Next cohort starts Sept 4.',
    },
  ],
  'home-services-contractor': [
    {
      framework: 'specific-value-prop',
      headline:  'Licensed plumber. On-time, every job.',
      primary:   'Master-licensed in MA + RI. Two-hour arrival window — if we miss it, the trip is free. 24/7 emergency, flat-rate pricing, no surprise add-ons.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'We won\'t guess. We\'ll measure.',
      primary:   "Other guys quote a number out of thin air. We carry a moisture meter, a borescope, and a thermal camera. The estimate matches the invoice — that's the whole pitch.",
    },
    {
      framework: 'before-after',
      headline:  'Three estimates → one job done right.',
      primary:   "If you've gotten three wildly different bids on the same project, the cheap one is missing scope and the expensive one is padding. We itemize so you can see why.",
    },
  ],
  'law-firm': [
    {
      framework: 'specific-value-prop',
      headline:  'Federal appellate counsel, 4 circuits.',
      primary:   'Bar-admitted in the 2nd, 3rd, 9th, and DC Circuits. 18 years of federal appellate practice. Free 30-min case review for trial counsel.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  "I've argued 6 times in front of Judge Lin.",
      primary:   "If your case is in the SDNY commercial division, you want a litigator who knows the bench. I've appeared before all four judges in the past 18 months.",
    },
    {
      framework: 'before-after',
      headline:  '$340k judgment → $0 owed.',
      primary:   'Client came in with a $340k state-court verdict against him. Removed to federal court, raised an FAA preemption defense, judgment vacated in 6 months.',
    },
  ],
  'real-estate-agent': [
    {
      framework: 'specific-value-prop',
      headline:  '3-bed lakefront. Showings by appt only.',
      primary:   '3-bed, 2-bath lakefront in Incline Village. 0.4 mi to private beach. Listed at $2.4M, no co-listing. Showings Friday by appointment.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  '7 listings I refused to take last month.',
      primary:   "I turned down 7 listings in March because the seller's price was 12% over comps. The 4 I took all sold above ask. That's the standard.",
    },
    {
      framework: 'before-after',
      headline:  'On the market 47 days. Sold in 4.',
      primary:   "Same house. Same price. Different agent. We re-staged, re-shot, and re-listed Tuesday — under contract Saturday at $14k over ask.",
    },
  ],
  'restaurant': [
    {
      framework: 'specific-value-prop',
      headline:  'Wood-fired Neapolitan. 90 seconds, every time.',
      primary:   "00 flour, San Marzano DOP, fior di latte, 90 seconds at 900°. We do five pies, a cold antipasto, and tiramisu. That's the menu. Reservations open at 5.",
    },
    {
      framework: 'pattern-interrupt',
      headline:  'No substitutions. No exceptions.',
      primary:   "We don't do substitutions because the menu is six items and we tested every one for 14 months. If it's not on the page, we won't make it well.",
    },
    {
      framework: 'before-after',
      headline:  'Frozen-pizza Tuesday → pasta night.',
      primary:   "Tuesday used to be takeout night. Now we do a $24 prix-fixe pasta — appetizer, main, dessert, a glass of house red. Walk-ins welcome.",
    },
  ],
  'specialty-cafe': [
    {
      framework: 'specific-value-prop',
      headline:  'Sourdough fresh out of the oven at 7am.',
      primary:   'Single-origin Ethiopian Yirgacheffe pour-over and sourdough out of the oven by 7am. 1402 Pearl St — open 6:30 to 4.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'We weighed every shot on a $400 scale.',
      primary:   'Every espresso pulled at 18g in / 36g out, ±0.2g. That precision is why our latte tastes the same on Tuesday as it does on Sunday.',
    },
    {
      framework: 'before-after',
      headline:  'Burnt drip → honey-sweet pour-over.',
      primary:   "If your last cup tasted like ash, you've been drinking dark-roast cover-up. Try a light-roast washed Ethiopian — actual fruit, no scorch.",
    },
  ],

  // ── Batch 1 / 12 — Marketing-doc niches (2026-05-09 niche expansion) ────────

  'tree-service': [
    {
      framework: 'specific-value-prop',
      headline:  'ISA-certified arborists, fully insured crews.',
      primary:   'Removal, pruning, and stump grinding by climbers with saddle hours, not handymen with rope. Free on-site estimate, written scope, and a clean drop zone before we cut.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'That oak limb is 1,200 lb of leverage.',
      primary:   'A 14-inch limb over your roof weighs more than a Honda Civic. We rig, lower, and chip it without dropping debris on your shingles. Same-day callback for storm work.',
    },
    {
      framework: 'before-after',
      headline:  'From storm-dropped to driveway-clear.',
      primary:   'Last night a maple split and pinned the driveway. By 4 p.m. the wood is rounds, the brush is chipped, and the lawn is raked. Call for a same-day arborist visit.',
    },
  ],

  'fencing-contractor': [
    {
      framework: 'specific-value-prop',
      headline:  'Free quote with on-site measurement.',
      primary:   'Cedar, vinyl, chain-link, or ornamental aluminum. We measure your run, mark setbacks, check HOA rules, and quote per linear foot in writing before any post goes in.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  '6-foot privacy fence: $42 a foot installed.',
      primary:   'Materials, posts, concrete, gates, and labor in one number. Permit pulled if your county requires it. Most backyards finished in two days, stained or capped on day three.',
    },
    {
      framework: 'before-after',
      headline:  'From open yard to fenced backyard in 48 hours.',
      primary:   'Monday morning the line is just stakes and string. Wednesday evening the gate latches, the dog stays in, and the HOA paperwork is filed. Book a measurement this week.',
    },
  ],

  'junk-removal': [
    {
      framework: 'specific-value-prop',
      headline:  'Same-day pickup. Flat rate by truckload.',
      primary:   'Text a photo, get a price in 15 minutes, crew arrives the same afternoon. We donate reusable items and recycle metal, e-waste, and cardboard. Average single-item haul: $89.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Three guys, one truck, 47 minutes.',
      primary:   "That's the average for a full garage cleanout in our service area. Flat-rate by truckload, no hourly surprises, photo quote before we touch a thing. Booking the same week.",
    },
    {
      framework: 'before-after',
      headline:  'Cluttered garage Friday. Empty floor Saturday.',
      primary:   "Yesterday: boxes you can't park around, a broken treadmill, two mattresses on the wall. Today: swept concrete and a parking spot. The bridge is a flat-rate truckload quote — text a photo to start.",
    },
  ],

  'cleaning-service': [
    {
      framework: 'specific-value-prop',
      headline:  'Bonded, insured, room-by-room checklist.',
      primary:   'Same two-person team every visit, supplies included, 47-point checklist signed off before we leave. Weekly, biweekly, or monthly plans starting at $145. Satisfaction guarantee on every clean.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Your bathroom grout has 11 steps.',
      primary:   "That's how many our checklist runs through — wipe, scrub, rinse, polish, mirror, fixtures, baseboards, vent, floor edge, trash, restock. Same for kitchens. Bonded and insured, supplies included.",
    },
    {
      framework: 'before-after',
      headline:  'Saturday scrubbing → Saturday with the kids.',
      primary:   'Before: three hours of bathrooms and baseboards while the day burns. After: a signed-off checklist by noon, supplies and team included. The bridge is a 20-minute walk-through to lock in your recurring plan.',
    },
  ],

  'mobile-detailing': [
    {
      framework: 'specific-value-prop',
      headline:  'Ceramic coating in your driveway. Booked in 60 seconds.',
      primary:   'Three package tiers from interior refresh to two-stage paint correction plus ceramic. Pick a slot, share an address, we show up with water and power. Before and after photos sent to your phone.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Your car has 14,000 swirl marks. We can count them.',
      primary:   'A paint depth gauge and a 3M inspection light tell us what your eyes miss. Two-stage correction removes the swirls, ceramic locks the gloss, and we do it in your driveway on Saturday.',
    },
    {
      framework: 'before-after',
      headline:  'Daily-driver dust to wedding-day shine, no detour required.',
      primary:   'Before: salt streaks, coffee spills, dog hair welded into the back seat. After: hand-washed paint, decontaminated wheels, vacuumed and steam-cleaned cabin. The bridge is one appointment in your driveway.',
    },
  ],

  'auto-repair-shop': [
    {
      framework: 'specific-value-prop',
      headline:  'ASE-certified repair. 12-month, 12,000-mile written warranty.',
      primary:   'Free written estimate before any wrench turns. NAPA AutoCare parts, plain-English diagnostics, and a loaner when the job runs past lunch. Book a slot online or call the shop direct.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Most check-engine codes are a $40 sensor, not a $4,000 bill.',
      primary:   "We pull the code for free, walk you through what it means, and quote the fix in writing before we start. If it really is the transmission, you'll know before you sign anything.",
    },
    {
      framework: 'before-after',
      headline:  'Mystery dashboard light to a printed work order in one stop.',
      primary:   "Before: warning light, vague phone quote, and a knot in your stomach. After: line-item estimate, ASE-certified tech assigned, written warranty stapled to the receipt. The bridge is a free diagnostic this week.",
    },
  ],

  'car-dealership': [
    {
      framework: 'specific-value-prop',
      headline:  'Every vehicle, free Carfax report.',
      primary:   'Walk our lot or browse online — every car, truck, and SUV ships with a no-charge Carfax history. Pre-qualify for financing in under 4 minutes. Visit us this weekend.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  '312 vehicles. One honest price tag.',
      primary:   'No four-square games, no surprise add-ons at signing. The price you see is the price you sign — financing options shown openly beside it. Test drive any inventory unit today.',
    },
    {
      framework: 'before-after',
      headline:  'From dealership dread to driving home.',
      primary:   'Most car-buying days drag on for hours of back-and-forth. Ours start with an upfront price, a Carfax in hand, and a 20-minute test drive. The bridge is a trade-in valuation you can trust.',
    },
  ],

  'combat-gym': [
    {
      framework: 'specific-value-prop',
      headline:  'Free first class. Boxing, BJJ, Muay Thai.',
      primary:   'Try any class on the schedule before you sign anything. Loaner gloves, mat space, and a coach who actually watches your stance. Adult and kids programs run separately.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Our head coach trained under a Pedro Sauer black belt.',
      primary:   "Lineage matters in combat sports — it's how technique stays honest across generations. Roll with coaches who can name every teacher above them. Walk in this week for a free first class.",
    },
    {
      framework: 'before-after',
      headline:  'From sideline to first sparring round.',
      primary:   'Most beginners freeze the first time gloves come on. Six weeks of fundamentals — footwork, breathing, controlled drilling — and the bell stops sounding scary. The bridge is a no-pressure trial week.',
    },
  ],

  // ── Batch 2 / 12 — Home services umbrella + licensed trades part A ──────────

  'home-services-general': [
    {
      framework: 'specific-value-prop',
      headline:  'From a leaky faucet to a fence repair.',
      primary:   'One call covers the punch list. Insured local crew, flat quote before we start, most jobs wrapped in a single visit. Text a photo for a same-week estimate.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  '37 things on your honey-do list. We do all 37.',
      primary:   'Most homeowners save up small repairs until the list is overwhelming. Send us the list, we knock it out in one Saturday, and you get your weekends back.',
    },
    {
      framework: 'before-after',
      headline:  'Sticky doors, loose railings, peeling trim — fixed.',
      primary:   'Before: half a dozen small annoyances you keep meaning to handle. After: a tighter, quieter, safer house in one afternoon. The bridge is a flat-rate visit from a crew that shows up when promised.',
    },
  ],

  'handyman-service': [
    {
      framework: 'specific-value-prop',
      headline:  'TVs mounted, shelves hung, drywall patched.',
      primary:   'Booked by the hour or by the job, your call. Insured solo handyman, clean shop habits, photo confirmation when the work is done. Most bookings open within 48 hours.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  '$95 an hour, two-hour minimum, no surprises.',
      primary:   'Hourly pricing posted on the site, a written scope before the visit, and a hard stop when the agreed hours run out. The boring kind of contractor — which is exactly the kind you want for small jobs.',
    },
    {
      framework: 'before-after',
      headline:  'A stack of IKEA boxes. A finished bedroom.',
      primary:   'Before: flat boxes, missing hardware, an Allen key with no memory of which screw goes where. After: assembled, leveled, anchored to studs, packaging hauled away. The bridge is one booking on the calendar.',
    },
  ],

  'roofing-contractor': [
    {
      framework: 'specific-value-prop',
      headline:  'Free drone roof inspection in 48 hours.',
      primary:   'Licensed, bonded, insured. We document every shingle with drone photos, walk you through the report, and handle the insurance claim paperwork from intake to final payment.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  '1 in 3 storm-damaged roofs gets denied first.',
      primary:   "Insurance adjusters miss hail strikes the untrained eye doesn't catch. We meet your adjuster on the roof, point out every impact, and rework denied claims with photo evidence.",
    },
    {
      framework: 'before-after',
      headline:  'Curling shingles to 50-year metal roof.',
      primary:   'Old asphalt was patched four times and still leaking at the valleys. New standing-seam metal is rated for 130 mph wind and backed by a manufacturer warranty. The bridge is a free written estimate.',
    },
  ],

  'painting-contractor': [
    {
      framework: 'specific-value-prop',
      headline:  'Free written estimate plus color consultation.',
      primary:   'Licensed, bonded, insured. We pressure-wash, scrape, prime, and apply two finish coats on every exterior. Color consultation included with any whole-house quote.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  '70 percent of a paint job is prep nobody sees.',
      primary:   'A two-coat finish over bare drywall fails inside a year. We sand, fill, prime, and caulk every seam before a brush touches the wall, and we document the prep in writing.',
    },
    {
      framework: 'before-after',
      headline:  'Tired oak cabinets to satin off-white.',
      primary:   'Original cabinets were sticky, yellowed, and brushed twice in the past decade. New finish is sprayed, baked, and rated for kitchen wear. The bridge is a free in-home color consultation.',
    },
  ],

  'garage-door-service': [
    {
      framework: 'specific-value-prop',
      headline:  'Same-day broken-spring repair, flat-rate pricing.',
      primary:   'Licensed, bonded, insured. Most spring replacements done in one visit, parts on the truck, written quote before we turn a wrench. Evening and weekend slots open.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'A broken spring strands your car in 3 seconds.',
      primary:   'A torsion spring snaps without warning and a 200-pound door drops dead. We carry both common spring sizes on every truck and most calls finish in 90 minutes.',
    },
    {
      framework: 'before-after',
      headline:  'Loud chain drive to quiet belt opener.',
      primary:   'Old chain unit shook the bedroom above the garage every time it ran. New belt-drive opener with smartphone control is rated for 1,500 cycles a year. The bridge is a free on-site quote.',
    },
  ],

  'hvac-contractor': [
    {
      framework: 'specific-value-prop',
      headline:  'Same-day AC repair, flat-rate diagnostic.',
      primary:   "Licensed EPA-608 techs, $89 diagnostic credited toward repair, average on-site within 2 hours in metro service area. Book online or call to lock today's slot.",
    },
    {
      framework: 'pattern-interrupt',
      headline:  '94 degrees inside? Your capacitor is the $19 part.',
      primary:   'Most no-cool calls trace to a failed run capacitor or contactor, not a dead system. We carry both on every truck. Diagnostic in 30 minutes, repair the same visit.',
    },
    {
      framework: 'before-after',
      headline:  'From 22-year furnace to 96% AFUE in one day.',
      primary:   'Old single-stage furnace, $340 winter gas bill. New 96% AFUE two-stage with utility rebate, projected $190. Free in-home load calc and financing quote this week.',
    },
  ],

  'plumbing-service': [
    {
      framework: 'specific-value-prop',
      headline:  '24/7 plumber, flat-rate quote before we start.',
      primary:   'Master-plumber-led crew, written flat rate signed before any wrench turns, average arrival under 60 minutes for emergencies. Drain clear from $89, water heaters in stock.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Your sewer line is 47 feet long. We camera all of it.',
      primary:   'Most plumbers quote a clog from the cleanout. We push a camera the full run and email you the video before recommending hydrojet, spot repair, or liner. Same-day appointments.',
    },
    {
      framework: 'before-after',
      headline:  'From cold showers to tankless in under 6 hours.',
      primary:   'Failing 50-gallon tank, recovery time 90 minutes. New gas tankless, endless hot water at 9.5 GPM. Permit pulled, old tank hauled, warranty registered. Quote in writing today.',
    },
  ],

  'electrician': [
    {
      framework: 'specific-value-prop',
      headline:  '200-amp panel upgrade, permit and inspection included.',
      primary:   'Master electrician on every job, NEC-2023 code-compliant, permit pulled and inspection scheduled by us. Flat-rate quote in 24 hours, most upgrades completed in one day.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Your 100-amp panel cannot handle a Level 2 EV charger.',
      primary:   'Before we install a 48-amp charger we run a load calc. Half the homes need a service upgrade first. Free assessment, written tier quote, financing on approved credit.',
    },
    {
      framework: 'before-after',
      headline:  'From knob-and-tube to whole-home rewire in 5 days.',
      primary:   '1928 cloth-insulated wiring, two-prong outlets, no grounds. New copper home runs, AFCI/GFCI per NEC-2023, smart panel with monitoring. Permit, drywall patch, and final inspection handled.',
    },
  ],

  'solar-installer': [
    {
      framework: 'specific-value-prop',
      headline:  'Cut your power bill 70% with rooftop solar.',
      primary:   'Free site survey, production estimate in 48 hours, and a 25-year panel warranty. We file the federal tax credit paperwork for you. Book your survey.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  '30% federal tax credit ends sooner than you think.',
      primary:   'The residential ITC sunsets on a hard schedule. A typical 8 kW system claims roughly $7,800 back. Lock your install before the rate steps down.',
    },
    {
      framework: 'before-after',
      headline:  'From $280 power bill to $14 grid fee.',
      primary:   'Last year you paid the utility every month. This year you pay them once and bank the rest in net-metering credits. The bridge is one rooftop survey.',
    },
  ],

  'landscaping-lawn-care': [
    {
      framework: 'specific-value-prop',
      headline:  'Weekly mowing on the same day, every week.',
      primary:   'Edged, mowed, and blown clean in 35 minutes. Licensed and insured crews, recurring plans from 28 visits a season. Get a quote in under a minute.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  '47 yards on our route, 0 missed weeks.',
      primary:   'Same crew, same day, every week from April to October. That is how you get a striped lawn instead of a coin-flip. Book the route slot before it fills.',
    },
    {
      framework: 'before-after',
      headline:  'From weekend chore to Saturday morning coffee.',
      primary:   'You spent four hours every Saturday on the mower. Now you watch the crew work from the porch with coffee. The bridge is a 10-minute quote and a recurring plan.',
    },
  ],

  'pest-control': [
    {
      framework: 'specific-value-prop',
      headline:  'Quarterly pest plan, kid and pet safe products.',
      primary:   'Four treatments a year, exterior perimeter and interior touchpoints, free re-treats between visits. Licensed applicators, EPA-registered products. Book a free inspection.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'A single termite colony eats 5 lb of wood a week.',
      primary:   'By the time you see frass on the windowsill the damage is years deep. A 45-minute inspection finds entry points, mud tubes, and moisture readings. Schedule yours.',
    },
    {
      framework: 'before-after',
      headline:  'From midnight roach in the kitchen to a quiet pantry.',
      primary:   'Last month it was a flashlight at 2 a.m. and a panic search for spray. Now perimeter bait and quarterly visits keep the kitchen quiet. The bridge is a free inspection.',
    },
  ],

  'pressure-washing': [
    {
      framework: 'specific-value-prop',
      headline:  'Flat-rate driveway washing, no surprise add-ons.',
      primary:   'Up-front price by the square foot. Surface cleaner pass plus post-treatment included. Most driveways done in under 90 minutes. Text a photo for your quote.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Your roof does not need 3,000 PSI.',
      primary:   'Asphalt shingles get soft-washed with a low-pressure biodegradable mix that kills the black streaks at the root. Pressure shortens roof life. Soft wash is the right tool.',
    },
    {
      framework: 'before-after',
      headline:  'Grey concrete to clean concrete in one pass.',
      primary:   'Three years of mildew and tire marks before. Even, bright concrete after, with a rinse that protects your beds and grass. Book a Saturday and have the crew gone by lunch.',
    },
  ],

  'window-cleaning': [
    {
      framework: 'specific-value-prop',
      headline:  'Streak-free interior and exterior, per-pane pricing.',
      primary:   'Flat per-pane rate, tracks and sills wiped, screens hand-washed, booties on every visit. Insured and OSHA-trained on ladders. Get a same-day quote by text.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Your storefront looks closed when the glass is dirty.',
      primary:   "Foot traffic reads a smudged door as 'we are not open.' Weekly or biweekly storefront route service keeps your entry sharp for under the cost of one walk-in customer.",
    },
    {
      framework: 'before-after',
      headline:  'Hard-water spots, then clear glass again.',
      primary:   'Years of sprinkler spray etched into the front windows before. Restored glass after, with a sealant pass so the spots stay gone. Quoted per window, no minimums on residential.',
    },
  ],

  // ── Batch 3 / 12 — Trades part B (interior services + envelope/structure) ───

  'carpet-cleaning': [
    {
      framework: 'specific-value-prop',
      headline:  'Truck-mounted hot-water extraction. Dry in 4 hours.',
      primary:   '230-degree extraction lifts traffic-lane soil portable units cannot. Pet-safe pre-spray, neutral rinse, fast-dry pass. Book a same-week slot.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Your carpet holds 1 lb of soil per square yard.',
      primary:   'That is what a vacuum will not lift. Hot-water extraction with the right dwell time pulls it out and leaves fibers dry to the touch in hours, not days.',
    },
    {
      framework: 'before-after',
      headline:  'Stained traffic lanes to clean fiber, same day.',
      primary:   'Before: matted lanes, set-in pet spots, lingering odor. After: lifted pile, neutralized stains, fresh rinse. The bridge is one truck-mounted appointment.',
    },
  ],

  'chimney-sweep': [
    {
      framework: 'specific-value-prop',
      headline:  'CSIA-certified sweep + Level 1 inspection.',
      primary:   'Annual creosote removal, full flue camera scan, written safety report. Book before burn season and avoid the November waitlist.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  '1 in 8 chimney fires starts with glazed creosote.',
      primary:   'Stage-3 creosote needs more than a brush. CSIA-certified techs identify the build-up, recommend the right removal, and document the flue end-to-end.',
    },
    {
      framework: 'before-after',
      headline:  'Smoky drafts to a clean draw and a clear flue.',
      primary:   'Before: smoky room, glazed flue walls, drafty fireplace. After: full sweep, camera-verified clearance, code-compliant cap. The bridge is a single seasonal visit.',
    },
  ],

  'locksmith': [
    {
      framework: 'specific-value-prop',
      headline:  '30-minute response. Bonded, insured, ALOA-trained.',
      primary:   'Lockouts, rekeys, smart-lock installs, and master-key systems for businesses. Flat service-call pricing quoted on the phone before dispatch.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  "Your old key still works at the last 4 owners' houses.",
      primary:   'Most homes are never rekeyed after closing. A 20-minute rekey replaces every pin in your existing locks and renders all prior keys useless.',
    },
    {
      framework: 'before-after',
      headline:  'Locked out at 11 PM to back inside in 30 minutes.',
      primary:   'Before: cold porch, dead phone, no spare. After: non-destructive entry, working key in hand, door secured behind you. The bridge is a flat-fee call.',
    },
  ],

  'moving-company': [
    {
      framework: 'specific-value-prop',
      headline:  'Free in-home estimates. Binding price. No surprises.',
      primary:   'DOT-licensed and insured for local and long-distance moves. Pad-wrap on every piece, written binding quote, claim-free track record.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  "9 out of 10 'cheap' moves end with an upcharge at the truck.",
      primary:   'Hourly bait quotes turn into surprise stair fees and weight upcharges. A binding in-home estimate locks the price before the boxes leave the house.',
    },
    {
      framework: 'before-after',
      headline:  'Boxes everywhere to keys handed over by sunset.',
      primary:   'Before: stacks in every room, no plan for the piano, no rental countdown. After: pad-wrapped load, even truck distribution, walk-through completed. The bridge is one crew.',
    },
  ],

  'appliance-repair': [
    {
      framework: 'specific-value-prop',
      headline:  'Same-day service. Diagnostic fee credited toward the repair.',
      primary:   "Factory-authorized for Whirlpool, GE, LG, and Samsung. OEM parts on the truck. Honest call: if the repair costs more than replacement, we say so.",
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Most fridges fail on a $40 part, not the compressor.',
      primary:   'A relay, a fan motor, a thermistor. Knowing which one means a 45-minute fix instead of a $1,800 replacement. Bring the diagnostic, keep the receipt.',
    },
    {
      framework: 'before-after',
      headline:  'Dead washer to spinning load by dinner.',
      primary:   'Before: standing water, error code, laundry piling up. After: pump replaced, drum balanced, cycle running. The bridge is a same-day in-home call.',
    },
  ],

  'concrete-masonry': [
    {
      framework: 'specific-value-prop',
      headline:  '4,000 PSI mix, 5-year warranty, finished by hand.',
      primary:   'Driveways, patios, walkways, and retaining walls poured to spec. Stamped and colored options finished by trowel, not by template. Licensed and insured.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Concrete cures for 28 days. Most cracks happen in week one.',
      primary:   "Wrong mix, wrong cure schedule, no rebar. The first seven days set the slab's life. We pour to PSI, score on time, and protect through the cure.",
    },
    {
      framework: 'before-after',
      headline:  'Cracked driveway to a stamped, sealed finish.',
      primary:   'Before: heaving slab, weeds in the joints, settled apron. After: tear-out, compacted base, stamped pour with a release color. The bridge is one crew, one season.',
    },
  ],

  'flooring-contractor': [
    {
      framework: 'specific-value-prop',
      headline:  'Hardwood, tile, LVP — installed by one crew.',
      primary:   "Free in-home estimate with samples, written subfloor-prep scope, and a manufacturer warranty in writing. Book a 30-minute visit and we bring three boxes of samples to your light.",
    },
    {
      framework: 'pattern-interrupt',
      headline:  '73% of floor failures start under the floor.',
      primary:   "We measure moisture and flatness before we order a single plank. If your subfloor needs work, you'll see the readings and the fix in the quote — not a surprise on install day.",
    },
    {
      framework: 'before-after',
      headline:  'From cupping oak to flat, finished floors.',
      primary:   'Old: a kitchen of swelling boards and gaps you could feel through socks. New: refinished or replaced, transitions tight, baseboards back on. The bridge is a free in-home assessment with samples.',
    },
  ],

  'siding-gutters': [
    {
      framework: 'specific-value-prop',
      headline:  'Hardie-certified install with seamless gutters.',
      primary:   'Fiber-cement, vinyl, or engineered wood — paired with seamless gutters cut on our truck to your exact run. Free written quote, manufacturer-certified installer, license and bond on the footer.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Your gutters are 3 feet shorter than they should be.',
      primary:   'Most retrofits leave a gap behind the fascia where ice dams build. We measure the run, replace the fasteners, and seam the corners on-site so water leaves the roof and stays off the siding.',
    },
    {
      framework: 'before-after',
      headline:  'From storm-stripped panels to a tight envelope.',
      primary:   'Old: cracked vinyl, sagging downspouts, daylight at the corner board. New: full-wrap fiber-cement, seamless aluminum, and leaf guards. The bridge is a free written quote and a certified-installer warranty.',
    },
  ],

  'pool-services': [
    {
      framework: 'specific-value-prop',
      headline:  'Weekly pool service with chemistry on the receipt.',
      primary:   'Skim, vacuum, brush, test, balance — every visit. You get a printed reading of pH, alkalinity, and chlorine left at the equipment pad. Construction and equipment repair handled by the same crew.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Most green pools are fixed in 48 hours.',
      primary:   'We test for phosphates and stabilizer first, then dose accordingly — no shock-and-pray. Two visits, written readings, and a plan to keep it clear through the season.',
    },
    {
      framework: 'before-after',
      headline:  'From cloudy water to a balanced backyard.',
      primary:   "Old: green tint, scratched plaster, a pump that hums but won't prime. New: clear water, polished tile line, equipment serviced or replaced with parts on the truck. The bridge is a free site visit and a written plan.",
    },
  ],

  'foundation-waterproofing': [
    {
      framework: 'specific-value-prop',
      headline:  'Engineered foundation repair, transferable warranty.',
      primary:   'Helical piers, push piers, carbon-fiber straps, and full interior drain tile — designed with a structural engineer when scope warrants. Free inspection, written scope, warranty that transfers when you sell.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Stair-step cracks rarely sit still.',
      primary:   'If you marked the crack last spring and it widened, we measure deflection and lateral movement before we propose anything. The inspection is free and the report is yours to keep.',
    },
    {
      framework: 'before-after',
      headline:  'From a wet basement to a dry, monitored foundation.',
      primary:   'Old: efflorescence on the block, a sump that ran every storm, a wall bowing 3/4-inch at mid-height. New: interior drain tile, twin sumps, carbon-fiber on the wall, monitored every 12 months. The bridge is a free inspection.',
    },
  ],

  'restoration-emergency': [
    {
      framework: 'specific-value-prop',
      headline:  'IICRC-certified, 24-hour dispatch, insurance-direct billing.',
      primary:   'Water, fire, smoke, mold — crews on the road inside an hour, documentation your adjuster needs, and direct billing to most major carriers. Stop the loss tonight; sort the claim with us tomorrow.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'After 48 hours, water becomes mold.',
      primary:   'Category-1 water turns Category-3 fast. We extract, set air movers, and document moisture readings hour by hour so the drying is defensible to your carrier — not a guess.',
    },
    {
      framework: 'before-after',
      headline:  'From a flooded first floor to a documented dry-out.',
      primary:   'Old: standing water, swollen baseboards, a thermostat reading 89% humidity. New: structurally dry to spec, photos and psychrometric logs ready for the adjuster. The bridge is one phone call, any hour.',
    },
  ],

  'snow-removal-plowing': [
    {
      framework: 'specific-value-prop',
      headline:  'Pre-storm dispatch, salt on the truck, contract in writing.',
      primary:   'Per-event or seasonal — your driveway or your lot, plowed at the trigger depth you sign for. Salt and de-icer included in the route, insured for slip-and-fall on commercial accounts.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  "We're already moving when the forecast hits 2 inches.",
      primary:   'Routes are loaded the night before. If the trigger fires at 3am, we plow at 3am — not at 8am after your tenants have called. Commercial response time is on the contract, in writing.',
    },
    {
      framework: 'before-after',
      headline:  'From a slick lot at 6am to clear pavement and salt down.',
      primary:   'Old: tenants slipping in the lot, a phone full of complaints, a plow service that shows up after the storm. New: plowed before open, salted, and photo-logged for liability. The bridge is a seasonal contract with a guaranteed trigger.',
    },
  ],

  // ── Batch 4 / 12 — Auto vertical (9 niches) ─────────────────────────────────

  'auto-body-collision': [
    {
      framework: 'specific-value-prop',
      headline:  'I-CAR certified collision repair, factory color match.',
      primary:   'We work direct with your insurer, write the supplement, and coordinate the rental. Most repairs back on the road in 5-9 business days. Free written estimate.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  '97% of our paint matches pass on the first spray.',
      primary:   'Our spectrophotometer reads your panel before we mix. That cuts re-spray time and gets your car back faster. Bring it in any weekday for a free estimate.',
    },
    {
      framework: 'before-after',
      headline:  'Crumpled quarter panel Monday. Driving to work Friday.',
      primary:   'Tow lands at our bay, we open a claim with your carrier same day. Frame straightening, panel work, paint, blend, polish. Lifetime workmanship warranty on every repair.',
    },
  ],

  'tire-shop': [
    {
      framework: 'specific-value-prop',
      headline:  'Mount, balance, alignment in under 90 minutes.',
      primary:   'Out-the-door pricing on Michelin, Goodyear, BFGoodrich. TPMS reset included. Road-hazard warranty available on every set. Book online or walk in any weekday.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'A 1/8 inch alignment drift kills 6 mpg.',
      primary:   'We put your car on a Hunter Hawkeye rack, show you the readout, and tell you straight if it actually needs an alignment. Free check with any tire purchase.',
    },
    {
      framework: 'before-after',
      headline:  'Cupped tires and a wandering steering wheel. Smooth highway by 3 pm.',
      primary:   'Drop in this morning, we mount four new ones, balance to spec, and pull alignment back into the green. Most installs under 90 minutes start to finish.',
    },
  ],

  'mobile-mechanic': [
    {
      framework: 'specific-value-prop',
      headline:  'We fix it in your driveway. No tow needed.',
      primary:   'Brakes, batteries, alternators, starters, sensors, oil changes, scan-tool diagnostics. Flat-rate pricing texted to you before we start. Same-day appointments most weekdays.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Your driveway has a 14-foot bay. We bring the rest.',
      primary:   'Service truck arrives with the tools, parts, scan tool, and torque wrench. You stay home, we do the work. Job-rate quote in writing before any wrench turns.',
    },
    {
      framework: 'before-after',
      headline:  "Car wouldn't start at 7 am. Driving to lunch by noon.",
      primary:   'Text us with the symptoms, we route a tech and a battery to your driveway. Most no-start calls finished inside two hours, no tow charge, no wait at a shop.',
    },
  ],

  'transmission-shop': [
    {
      framework: 'specific-value-prop',
      headline:  'Free tow-in, free diagnostic, written rebuild warranty.',
      primary:   'We pull, tear down, and inspect every transmission before quoting. You get a rebuild-vs-replace recommendation in plain English. Most rebuilds carry a 3-year/100k written warranty.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Three things kill a CVT before 80,000 miles.',
      primary:   'Heat, neglected fluid, and pulley wear. We diagnose all three on a free scan, then tell you whether a flush, a valve-body refresh, or a rebuild is the honest call.',
    },
    {
      framework: 'before-after',
      headline:  'Slipping into third on the freeway. Crisp shifts in two weeks.',
      primary:   'Free tow brings your car to our bench. We split the case, replace seals, clutches, solenoids, and torque converter as needed. Back on the road with a written warranty.',
    },
  ],

  'car-wash': [
    {
      framework: 'specific-value-prop',
      headline:  'Unlimited washes, $24.99 a month.',
      primary:   "Soft-cloth tunnel, ceramic-seal top tier, free vacuums included. Pause your membership any month. RFID windshield tag, drive in any time we're open.",
    },
    {
      framework: 'pattern-interrupt',
      headline:  'We recycle 78% of the water that hits your hood.',
      primary:   "Closed-loop reclaim system, biodegradable detergents, soft cloth that won't scratch ceramic coats. Two-minute tunnel, free vacuums, unlimited memberships from $19.99.",
    },
    {
      framework: 'before-after',
      headline:  'Salt-streaked hood at 8 am. Beading clean by 8:08.',
      primary:   'Pull into the tunnel, foam, soft-cloth, ceramic spray, blow-off. Eight minutes including the vacuum bay. Members skip the line on the express side.',
    },
  ],

  'motorcycle-dealer': [
    {
      framework: 'specific-value-prop',
      headline:  'Honda, Yamaha, Suzuki, Kawasaki under one roof.',
      primary:   'New and pre-owned bikes from cruisers to adventure. Factory-trained service, full gear wall, on-site MSF rider course. Test-ride appointments any weekday.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Your first bike should not be the 1000cc.',
      primary:   'We talk you through what fits your size, license stage, and how you actually plan to ride. Then we set up a no-pressure test ride on something honest.',
    },
    {
      framework: 'before-after',
      headline:  'Curious browser at 10 am. Riding home Saturday afternoon.',
      primary:   'Sit on a few, take one out, run the numbers, walk the gear wall. We finish paperwork, fit a helmet, and watch you pull off. Service-dept relationship starts day one.',
    },
  ],

  'boat-marine-service': [
    {
      framework: 'specific-value-prop',
      headline:  'Outboard, inboard, winterize, store. One yard.',
      primary:   'ABYC-certified techs on Yamaha, Mercury, and Volvo Penta. Travel-lift haul-out, shrink-wrap winterization, indoor and outdoor storage. Spring commissioning slots fill fast.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'A skipped winterize cracks blocks at $4,800 a pop.',
      primary:   'We pull, fog, drain, and antifreeze every powerhead and stern drive in the yard. Shrink-wrap goes on the same day. Reserve your slot before the first freeze.',
    },
    {
      framework: 'before-after',
      headline:  'Boat sitting on the trailer in October. Splashed and running in May.',
      primary:   'Drop her in our yard for haul-out, winterize, and indoor storage. Spring service runs lower units, anodes, fuel-water separators. Back in the water on schedule.',
    },
  ],

  'towing-roadside': [
    {
      framework: 'specific-value-prop',
      headline:  '24/7 dispatch, ETA on every call, flat-rate pricing.',
      primary:   'Light-duty to heavy-duty rotator. Jump starts, fuel delivery, lockouts, accident recovery. Flat-rate quote before the truck rolls. AAA contractor, multiple motor clubs.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Average ETA in our coverage area is 23 minutes.',
      primary:   "Five trucks on rotation, dispatch tracks every job from your call. Drop a pin, we tell you the truck's plate number and the driver's name before we hang up.",
    },
    {
      framework: 'before-after',
      headline:  'Stuck on the shoulder at 11 pm. Home by midnight.',
      primary:   'One call, dispatch confirms ETA, flatbed arrives, your car loads safe, we drop you at your address or your shop. Card on file, no fumbling for cash on the roadside.',
    },
  ],

  'window-tint-vinyl': [
    {
      framework: 'specific-value-prop',
      headline:  'Ceramic tint, full wraps, PPF. Lifetime film warranty.',
      primary:   'M, SunTek, XPEL installs in a clean booth. Edge-wrapped on every panel. State-legal VLT options laid out before we cut. Most sedans done same day.',
    },
    {
      framework: 'pattern-interrupt',
      headline:  'Cheap tint goes purple in 18 months.',
      primary:   'Dyed film fades, ceramic does not. We show you the brand spec sheet and warranty card before you book. If it bubbles or fades on our install, we replace it.',
    },
    {
      framework: 'before-after',
      headline:  'Stock glass and stone-chipped hood. Ceramic tint and PPF by Friday.',
      primary:   'Park Tuesday morning, we strip, prep, cut, and heat-shrink. Pick up Friday with film on every window and self-healing PPF on the front clip. Lifetime warranty in the glove box.',
    },
  ],
};

/** Fallback for niches without curated patterns — generic but framework-shaped,
 *  not slop. Used as a last-resort seed; the user is expected to edit. */
export const FALLBACK_PATTERNS: CopyPattern[] = [
  {
    framework: 'specific-value-prop',
    headline:  '{One specific thing you do}',
    primary:   "{One specific outcome for one specific customer.} {One concrete number.} {One concrete next step — the address, hours, or how to book.}",
  },
  {
    framework: 'pattern-interrupt',
    headline:  '{A number, named place, or unexpected detail}',
    primary:   "{Open with the surprising fact.} {Connect it to why your customer should care.} {Close with the specific action.}",
  },
  {
    framework: 'before-after',
    headline:  '{Old state} → {New state}',
    primary:   '{Describe the old state in one concrete sentence.} {Describe the new state in one concrete sentence.} {The thing that bridged them is your offer.}',
  },
];

/**
 * Pick patterns for a niche, falling back to a generic frame when the
 * niche is unknown. Always returns at least one pattern.
 */
export function patternsForNiche(niche?: string | null): CopyPattern[] {
  if (!niche) return FALLBACK_PATTERNS;
  return COPY_PATTERNS[niche] ?? FALLBACK_PATTERNS;
}

/**
 * Pick a pattern for a specific framework — used when the user clicks the
 * framework picker. Returns the first pattern matching that framework, or
 * the generic fallback for that framework if no niche pattern matches.
 */
export function patternForFramework(niche: string | undefined, framework: FrameworkId): CopyPattern {
  const patterns = patternsForNiche(niche);
  const match = patterns.find((p) => p.framework === framework);
  if (match) return match;
  const fallback = FALLBACK_PATTERNS.find((p) => p.framework === framework);
  return fallback ?? FALLBACK_PATTERNS[0]!;
}

/**
 * Generate 2 A/B variants from a primary pattern. The variants pick the
 * "other two" frameworks so the user gets visibly different angles.
 */
export function generateVariants(niche: string | undefined, primary: CopyPattern): CopyPattern[] {
  const allFrameworks: FrameworkId[] = ['specific-value-prop', 'pattern-interrupt', 'before-after'];
  return allFrameworks
    .filter((f) => f !== primary.framework)
    .map((f) => patternForFramework(niche, f));
}
