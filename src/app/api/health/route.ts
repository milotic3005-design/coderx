import { fail, logError, ok } from "@/lib/api/envelope";
import { getHealth } from "@/lib/data/queries";

export const dynamic = "force-dynamic";

/** Liveness + database connectivity + freshness of each source. */
export async function GET(request: Request) {
  try {
    const health = await getHealth();
    return ok({ status: "ok", ...health }, {}, { request, cache: false });
  } catch (error) {
    logError("api.health", error);
    return fail("SERVICE_UNAVAILABLE", "Database unavailable.", { request });
  }
}
