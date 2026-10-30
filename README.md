# Plantago

**A PayPal donation, turned into food grown or bought as close as possible to the people who need it.**

A donor picks a place in northern Kenya and pays with PayPal. An AI planner searches a network of Kenyan growers, compares buying food now with sending drought-tolerant seed, and explains which option feeds the most people for the money. Plantago then pays the chosen growers directly with PayPal Payouts, and every dollar in and out appears on a public ledger with its PayPal transaction ID.

Built for the PayPal AI Hackathon (2026).

> Demo scope: payments are real **PayPal sandbox** transactions. Grower names are fictional (their towns are real), prices and need levels are approximate, and deliveries are simulated.

## How it works

```
Donor ──PayPal Orders v2──▶ Plantago ──AI planner (Claude + tools)──▶ plan
                                │                                      │
                          public ledger ◀──PayPal Payouts── grower payments ◀┘
                                │
                         delivery tracking (simulated)
```

1. **Give.** The donor chooses a destination on the network map. They can pick what to send from the **plant catalog**: food now (maize, sorghum, millet, beans, cowpeas, green grams…) or drought-tolerant seed to plant. Each item shows delivered price, meals per dollar, growers and distance for that destination, and anything that doesn't fit (it spoils on the road, or doesn't suit arid land) is greyed out with the reason. Or the donor can leave the choice to the planner. Catalog picks are binding: the server checks them and the planner's tools can't go outside them. The donor chooses an amount and can describe what they want ("feed families this month, and help them plant if it's the season"). PayPal checkout creates and captures an order tagged with the donation ID. The server checks that the captured amount matches before accepting it.
2. **Plan.** Claude (`claude-opus-5-5`) runs a tool loop:
   - `get_destination_profile`: need level, climate, planting season and the fixed budget.
   - `list_food_now_options`: ready food ranked by meals per dollar, including transport.
   - `list_grow_there_options`: seed suited to the local climate, with risk-adjusted harvests.
   - `build_allocation`: the optimizer costs a strategy (share of food vs seed, preference for local growers).
   - `submit_plan`: picks one costed allocation and writes the donor-facing explanation.

   **The AI chooses; code does the maths.** The budget is fixed on the server, and Claude can only submit an allocation the optimizer built, so it never sets an amount. If Claude is unavailable, a rule-based planner uses the same optimizer.
3. **Pay growers.** Planned orders are grouped by grower and sent as one PayPal Payouts batch. This happens automatically once a destination's unpaid orders reach a threshold, or when the operator clicks *Run payout batch now*.
   The network is **global**. Kenyan growers sit alongside suppliers in Uganda and Tanzania (cross-border trucking, plus border fees and time) and India and South Africa (sea freight to Mombasa, port handling, then road). It also sells **tools**: hermetic storage bags, family drip-irrigation kits and hand-tool sets, bought in whole units. Their impact is a rough per-season estimate and is labelled that way. Each catalog item has **growth facts** (days to harvest, water per season, typical yield, seed multiplier, drought tolerance, harvest odds at the destination) and a short **Wikipedia article**, fetched from Wikipedia's REST API and shown with CC BY-SA attribution.
4. **Track.** The **Network** page shows the whole plant network on a 3D **globe** (or a flat map): every grower, seed supplier and destination, with routes drawn by status (planned, paid, on the road, delivered) and thickness by kg, and idle growers greyed out. Each grower's shipment moves through sourced → shipped → delivered. The donor's page shows the plan, a map of routes, the deliveries and an impact receipt with PayPal IDs.

### Cash in farmers' hands

Plantago is built to get cash to the people who grow food, not just food to the people who need it.

- **Paid at approval, not on delivery.** Every supplier is paid through PayPal Payouts as soon as their order is approved, so the Farmers page and the ledger can show the **time from a donor's payment to a supplier's cash**.
- **Harvest buy-back.** Seed sent to a destination comes with a promise. The families who plant it form a farmer group in the network, and Plantago commits to buy 30% of the expected (risk-adjusted) harvest at a fair price: the network median plus 10%. When the operator marks the harvest in, it becomes stock that the next donations to that place **buy first**, and the group is paid through PayPal. A donation becomes seed, then income, then food grown a few km from the people who eat it. This is a purchase commitment, not a loan: nothing is paid until the crop exists. A refunded seed plan cancels its promises.
- **Cash-out route.**
  - Kenyan suppliers typically withdraw PayPal balances to M-Pesa.
  - Suppliers in other countries usually withdraw to a local bank.
  - Farmer groups receive the payout into the group account and pay members by M-Pesa, a step that happens outside PayPal.
  - Roadmap: Xoom transfers straight to members' mobile wallets.
- **Farmer shop.** Farmers spend their own money, often their Plantago earnings, on tools and seed from anywhere in the network.
  - **Pricing:** each item shows the price delivered to the farmer's village: the supplier's price plus delivery at cost, with no Plantago fee. The cheapest supplier is preselected.
  - **Paying:** the farmer pays with PayPal checkout, which can use their PayPal balance. Plantago never holds farmers' money as an in-app balance.
  - **Fulfilment:** the supplier is paid in the next Payouts batch and the delivery is tracked like any other. Stock is reserved when the farmer pays (or the payment is refunded automatically if it sold out), and the operator can refund until the supplier is paid.
  - **In the ledger:** purchases are recorded separately from donations.
  - **Caveat:** the demo has no farmer login. A real version would sign farmers in with PayPal.
- **Farmers page.** For every supplier: what they sold, what they were paid, PayPal transaction IDs, time to cash, and any harvest promises.

### Money safety

- All amounts are integer cents. There is no floating-point money anywhere.
- Every PayPal call that moves money sends a `PayPal-Request-Id`, so a retry can't charge or pay twice. Payout batches use our batch ID as `sender_batch_id`.
- Orders are claimed for a payout inside a database transaction *before* PayPal is called, so no order is paid twice. A failed batch is retried with the same ID rather than released.
- Refunds (PayPal Payments API) are only possible before any grower on that plan is paid. The check and the cancellation happen in one transaction.
- Webhooks are verified with PayPal's `verify-webhook-signature`. Duplicates are ignored, and unverified events are logged but never acted on.
- Ledger: received − refunded − paid out = held. The tests check that it balances.

## PayPal APIs used

| API | Used for |
| --- | --- |
| Orders v2 (create, capture) + JS SDK buttons | Donations |
| Payouts (create batch, get batch) | Paying growers |
| Payments (refund capture) | Returning donations that can't be fulfilled |
| Webhooks (verify signature; `PAYMENT.CAPTURE.*`, `PAYMENT.PAYOUTS-ITEM.*`) | Confirming payments and payout status |

**AI:** Claude via the Anthropic TypeScript SDK (tool runner, adaptive thinking, server-side refusal fallback).
**Sponsor tool:** AG Grid (operator console and public ledger).
**Other:** React, react-globe.gl (three.js) with NASA Blue Marble imagery, Leaflet with Natural Earth country shapes (public domain, served by the app), Wikipedia REST API, Express, SQLite.

## Run it locally

Requirements: Node 20+.

```bash
npm install
cp .env.example .env      # leave keys blank for simulation mode
npm run dev               # API on :8787, web on http://localhost:5173
```

With no keys set, the app runs in **simulation mode**. A banner says so, payment IDs start with `SIM-`, and the rule-based planner is used. Everything else works the same.

### Use the PayPal sandbox

1. At <https://developer.paypal.com/dashboard/applications/sandbox>, create an app and copy its **Client ID** and **Secret** into `.env`.
2. Under **Sandbox accounts**, use (or create) a *Personal* account to pay with.
3. To see grower payouts arrive, set `PAYPAL_PAYOUT_RECEIVER_OVERRIDE` to a sandbox personal account email. Without it, payouts go to the seeded grower emails (`*@growers.plantago.example`) and show as `UNCLAIMED`, which is still a real sandbox payout.
4. Optional: add a webhook pointing at `https://<your-host>/api/webhooks/paypal` and put its ID in `PAYPAL_WEBHOOK_ID`.

### Use the AI planner

Set `ANTHROPIC_API_KEY` in `.env`. The model defaults to `claude-opus-5-5` (`PLANNER_MODEL`).

### Tests

```bash
npm test          # money maths, optimizer invariants, end-to-end payment flow
npm run typecheck
```

## Deploy (Render)

`render.yaml` defines a web service with a persistent disk for the SQLite ledger. Create a Blueprint from the repo, fill in the secret env vars and set `OPERATOR_TOKEN`. Use a paid instance so the demo stays awake through judging.

## Testing instructions for judges

- **Hosted demo:** _URL to be added_
- **Sandbox buyer login:** _to be added_ (a PayPal sandbox personal account. It is not a real account.)
- **Operator token:** _to be added_ (opens the Operator page to run payouts and advance deliveries)

Suggested path: Give → pay $50 to Lodwar with the sandbox buyer → watch the plan appear → Operator → *Run payout batch now* → mark shipments shipped and delivered → back to your donation page and the Public ledger.

## Data sources and assumptions

- 1 meal = 700 kcal, a third of the 2,100 kcal/day standard ration (Sphere).
- Truck transport: about $0.15 per tonne-km plus $0.02/kg handling, at 350 km/day. Road distance = straight line × a road factor for each destination.
- Crop energy and protein are typical values for the dry form. Seed yields and drought tolerance are rough figures for rain-fed farming in arid and semi-arid areas, and harvests are risk-adjusted.
- Need levels are illustrative, informed by public IPC and FEWS NET reporting on Kenya's arid north.
- Cross-border road: +$0.03/kg and +2 days. Sea: about $1.7 per tonne per 1,000 km, plus $0.05/kg port handling and 5 days at Mombasa.
- Tool impact per season (rough): a hermetic bag avoids about 15 kg of storage loss (about 75 meals), a 250 m² drip kit grows about 300 kg of vegetables, and a hand-tool set lets a household plant about 0.1 ha more. Each is weighted by the chance it pays off.
- Growth ranges are typical for East African smallholder farms. Real-world imports of seed would also need phytosanitary certification (KEPHIS), which is on the roadmap.

## License

MIT. See [LICENSE](LICENSE).
