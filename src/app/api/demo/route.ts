import { DemoAction, MutationResponse } from "../../../contracts";
import { getStore } from "../../../server/db/local";
import { identify, authorize, boundedJson } from "../../../server/access";
import { runPending } from "../../../server/investigation/run";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  const access = await identify(request);
  if (access.denied) return access.denied;
  const denied = authorize(access.principal, "read");
  if (denied) return denied;
  try {
    return reply(await (await getStore()).state());
  } catch {
    return reply({ error: "unavailable" }, 503);
  }
}
export async function POST(request: Request) {
  const acceptedAt = Date.now();
  const access = await identify(request);
  if (access.denied) return access.denied;
  let action;
  try {
    action = DemoAction.parse(await boundedJson(request));
  } catch {
    return reply({ error: "invalid_input" }, 400);
  }
  const denied = authorize(access.principal, action.action, action.action === "review" ? action.runId : undefined);
  if (denied) return denied;
  try {
    const store = await getStore();
    let result;
    if (action.action === "inject") {
      result = await store.inject(acceptedAt);
      await runPending(store);
    } else if (action.action === "reset") result = await store.reset();
    else result = await store.review(action.runId);
    return reply(MutationResponse.parse({ ok: true, ...result }));
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_review") return reply({ error: "forbidden" }, 403);
    return reply({ error: "unavailable" }, 503);
  }
}
