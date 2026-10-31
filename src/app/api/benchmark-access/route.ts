import { NextResponse } from "next/server";
import { BENCHMARK_COOKIE, BENCHMARK_COOKIE_MAX_AGE, benchmarkPasswordMatches, benchmarkToken, safeNext } from "@/lib/benchmark-access";

export const dynamic = "force-dynamic";

/**
 * POST /api/benchmark-access (HTML form): password + next → sets the benchmark cookie and
 * returns to next; a wrong password returns to next with ?access=denied. action=lock clears
 * the cookie. Rate-limited per IP by the proxy ("access" limiter).
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_PARAMETER", message: "Send the form fields password and next." } }, { status: 400 });
  }
  const next = safeNext(String(form.get("next") ?? ""));
  const target = new URL(next, request.url);
  const secure = target.protocol === "https:";

  if (form.get("action") === "lock") {
    const res = NextResponse.redirect(target, 303);
    res.cookies.set(BENCHMARK_COOKIE, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
    return res;
  }
  if (!benchmarkPasswordMatches(String(form.get("password") ?? ""))) {
    target.searchParams.set("access", "denied");
    return NextResponse.redirect(target, 303);
  }
  target.searchParams.delete("access");
  const res = NextResponse.redirect(target, 303);
  res.cookies.set(BENCHMARK_COOKIE, benchmarkToken(process.env.CODERX_BENCHMARK_PASSWORD!), { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: BENCHMARK_COOKIE_MAX_AGE });
  return res;
}
