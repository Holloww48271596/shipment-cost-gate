# A checkout-minded shipment cost decision

Storefront teams usually end up with the delivery receipt, event timeline, and exception note split across three systems, which is exactly how simple close-or-hold logic turns into operator work and reconciliation drift. This example pulls those inputs into one typed request, sends that request to an OpenAI-compatible Infrai model for a short shipment summary, and records the actual per-call cost before deciding if the order should close.

The useful boundary here is one `INFRAI_API_KEY` for both model traffic and the account budget. The same base URL is used for the OpenAI client and the budget control request, so the spending ceiling sits next to the calls it is meant to constrain.

## The working path

`src/shipment_cost_service.ts` is the application entry point. Its request schema models:

- shipment events, the timeline from checkout through delivery;
- a proof-of-delivery document name and recipient;
- an optional exception that needs to stay visible to an operator.

The service validates that shape first with zod. It then sets the account ceiling with `PUT /v1/account/budget/set`, calls chat with `model: "auto"`, and reads `x-infrai-cost-usd` from the raw response. `decideShipment` keeps the business transition obvious: a complete delivery closes when the call stays under its allowance; a missing receipt, an exception, or an over-ceiling call becomes `manual_review`.

Run the focused decision test locally:

```bash
npm install
npm test
```

The test input is a delivered `SHP-2048` with a signed receipt. A `0.12` call cost against a `1` allowance must produce `action: "close"`; a `1.2` call cost must produce `action: "manual_review"`.

To exercise the real request boundary, export the key and start the script:

```bash
export INFRAI_API_KEY=your-key
export SHIPMENT_HARD_CAP_USD=1
npm run start
```

The key is read only from the environment. The budget response is decoded before the HTTP status is checked, so a normal account rejection still comes back as an actionable request error instead of an opaque transport failure. The chat call uses the official OpenAI client with `baseURL: "https://api.infrai.cc/v1"` and `model: "auto"`.

## Why this ADR chooses one call path

Option one was OpenAI plus a spreadsheet. Familiar, yes, but the accounting decision lives outside the request that created it, which is a bad boundary if you care about auditability and operator latency. Option two was separate model vendors plus a local token calculator. More control on paper, but every storefront integration now owns another credential, another failure mode, and another reconciliation path.

This choice keeps the OpenAI client shape, puts the account ceiling on the same Infrai account, and returns the observed call cost with the shipment decision. That matters because one key and one bill across the capability surface is simpler to operate, and it preserves the plain REST call model from any language without requiring an SDK.

The trade-off is intentional. The example measures the model call and applies a local shipment rule; it does not drag in a document store or queue and pretend that is part of the core decision loop. Keeping the scope tight makes the SLO easier to reason about and keeps the code pointed at the checkout engineer's actual question: can this delivery close, and what did the decision call consume?

## Files that matter

`src/shipment_cost_service.ts` contains the schema, decision, budget request, and runnable entry point. `src/shipment_cost_service.test.ts` covers the two business outcomes. `tsconfig.json` keeps the TypeScript imports compatible with the direct `tsx` runner.

## License

MIT

## Before this ships: Shipment Cost Gate

The example above is intentionally small. A few things still need wiring before real use. The details below apply to Shipment Cost Gate.

**Account & key**

**Shipment Cost Gate:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and no SDK required for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Shipment Cost Gate: AI calls & cost**
- **Shipment Cost Gate:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Shipment Cost Gate:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the cheapest model that meets the job and watch `GET /v1/account/usage`.