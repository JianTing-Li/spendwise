import { DemoAction, MutationResponse } from "../../../contracts";
import { getStore } from "../../../server/db/local";
import { localRequestAllowed } from "../../../server/access";
import { runPending } from "../../../server/investigation/run";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  if (!localRequestAllowed(request))
    return reply({ error: "unauthorized" }, 403);
  try {
    return reply(await (await getStore()).state());
  } catch {
    return reply({ error: "unavailable" }, 503);
  }
}
export async function POST(request: Request) {
  const acceptedAt = Date.now();
  if (!localRequestAllowed(request))
    return reply({ error: "unauthorized" }, 403);
  let action;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return reply({ error: "invalid_input" }, 400);
    action = DemoAction.parse(JSON.parse(raw));
  } catch {
    return reply({ error: "invalid_input" }, 400);
  }
  try {
    const store = await getStore();
    let result;
    if (action.action === "inject") {
      result = await store.inject(acceptedAt);
      await runPending(store);
    } else if (action.action === "reset") result = await store.reset();
    else result = await store.review(action.runId);
    return reply(MutationResponse.parse({ ok: true, ...result }));
  } catch {
    return reply({ error: "unavailable" }, 503);
  }
}
