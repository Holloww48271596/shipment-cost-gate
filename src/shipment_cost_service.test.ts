import assert from "node:assert/strict";
import test from "node:test";
import { decideShipment, shipmentRequest } from "./shipment_cost_service.ts";

const completeShipment = {
  shipment_id: "SHP-2048",
  destination: "Shenzhen storefront",
  events: [{ status: "delivered", occurred_at: "2026-10-24T09:00:00Z" }],
  proof_of_delivery: { received_by: "Lin", document_name: "signed-receipt.pdf" },
  exception: null
};

test("a complete delivery closes below the per-call ceiling", () => {
  const parsed = shipmentRequest.parse(completeShipment);
  assert.deepEqual(decideShipment(parsed, 0.12, 1), {
    shipment_id: "SHP-2048",
    action: "close",
    reason: "proof and events are complete",
    model_cost_usd: 0.12
  });
});

test("an over-ceiling call sends the shipment to manual review", () => {
  const parsed = shipmentRequest.parse(completeShipment);
  assert.equal(decideShipment(parsed, 1.2, 1).action, "manual_review");
});
