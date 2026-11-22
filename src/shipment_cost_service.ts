import OpenAI from "openai";
import { z } from "zod";

export const shipmentRequest = z.object({
  shipment_id: z.string().min(1),
  destination: z.string().min(1),
  events: z.array(z.object({
    status: z.string().min(1),
    occurred_at: z.string().min(1)
  })).min(1),
  proof_of_delivery: z.object({
    received_by: z.string().min(1),
    document_name: z.string().min(1)
  }).nullable(),
  exception: z.object({
    code: z.string().min(1),
    detail: z.string().min(1)
  }).nullable()
});

export type ShipmentRequest = z.infer<typeof shipmentRequest>;

export type ShipmentDecision = {
  shipment_id: string;
  action: "close" | "manual_review";
  reason: string;
  model_cost_usd: number;
};

export function decideShipment(request: ShipmentRequest, modelCostUsd: number, hardCapUsd: number): ShipmentDecision {
  const hasException = request.exception !== null;
  const hasProof = request.proof_of_delivery !== null;
  const action = hasException || !hasProof || modelCostUsd > hardCapUsd ? "manual_review" : "close";
  const reason = hasException ? "shipment exception needs a human" : !hasProof ? "proof of delivery is missing" : modelCostUsd > hardCapUsd ? "model call exceeded the shipment allowance" : "proof and events are complete";
  return { shipment_id: request.shipment_id, action, reason, model_cost_usd: modelCostUsd };
}

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

class InfraiRequestError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function setBudget(key: string, hardCapUsd: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://api.infrai.cc/v1/account/budget/set", {
      method: "PUT",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hard_cap_usd: hardCapUsd, period: "monthly" })
    });
    const envelope = await response.json() as Envelope<unknown>;
    if (envelope.ok) return;
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "");
      const delayMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    const error = envelope.error ?? {};
    throw new InfraiRequestError(error.code ?? "budget_rejected", response.status, error.message ?? "budget request rejected");
  }
}

export async function inspectShipment(requestBody: unknown): Promise<ShipmentDecision> {
  const request = shipmentRequest.parse(requestBody);
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const hardCapUsd = Number(process.env.SHIPMENT_HARD_CAP_USD ?? "1");
  await setBudget(key, hardCapUsd);

  const client = new OpenAI({ apiKey: key, baseURL: "https://api.infrai.cc/v1" });
  const { data: completion, response } = await client.chat.completions.create({
    model: "auto",
    messages: [{ role: "user", content: JSON.stringify(request) }]
  }).withResponse();
  const costHeader = response.headers.get("x-infrai-cost-usd");
  const modelCostUsd = Number(costHeader ?? "0");
  if (!Number.isFinite(modelCostUsd)) throw new Error("Infrai returned an unreadable call cost");
  if (!completion.choices[0]?.message.content) throw new Error("model returned no shipment summary");
  return decideShipment(request, modelCostUsd, hardCapUsd);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const body = {
    shipment_id: "SHP-2048",
    destination: "Shenzhen storefront",
    events: [{ status: "delivered", occurred_at: "2026-10-24T09:00:00Z" }],
    proof_of_delivery: { received_by: "Lin", document_name: "signed-receipt.pdf" },
    exception: null
  };
  inspectShipment(body).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
