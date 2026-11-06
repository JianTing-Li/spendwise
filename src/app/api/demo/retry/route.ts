import { Id, MutationResponse } from "../../../../contracts";
import { getStore } from "../../../../server/db/local";
import { localRequestAllowed } from "../../../../server/access";
import { runPending } from "../../../../server/investigation/run";
import { z } from "zod";
export const runtime = "nodejs";
export const maxDuration = 90;
export async function POST(request: Request) {
  const acceptedAt = Date.now();
  const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
  if (!localRequestAllowed(request))
    return reply({ error: "unauthorized" }, 403);
  let predecessorId: string;
  try {
    const raw = await request.text();
    if (raw.length > 2048)
      throw new Error("invalid_input");
    predecessorId = z.object({ predecessorId: Id }).strict().parse(JSON.parse(raw)).predecessorId;
  }
  catch {
    return reply({ error: "invalid_input" }, 400);
  }
  try {
    const store = await getStore();
    const result = await store.retry(predecessorId, acceptedAt);
    await runPending(store);
    return reply(MutationResponse.parse({ ok: true, ...result }));
  }
  catch (error) {
    if (error instanceof Error && error.message === "invalid_retry")
      return reply({ error: "invalid_retry" }, 409);
    return reply({ error: "unavailable" }, 503);
  }
}
