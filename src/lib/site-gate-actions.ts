"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SITE_GATE_COOKIE,
  SITE_GATE_MAX_AGE_SEC,
  createSiteGateToken,
  gateEnv,
  pinMatches,
  safeNextPath,
} from "./site-gate";

export async function unlockSiteGate(formData: FormData) {
  const g = gateEnv();
  if (!g) redirect("/");

  const pin = String(formData.get("pin") ?? "").replace(/\D/g, "").slice(0, 12);
  const next = safeNextPath(String(formData.get("next") ?? "/"));

  if (!pinMatches(g.pin, pin)) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const expMs = Date.now() + SITE_GATE_MAX_AGE_SEC * 1000;
  const token = await createSiteGateToken(g.secret, expMs);

  const store = await cookies();
  store.set(SITE_GATE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SITE_GATE_MAX_AGE_SEC,
  });

  redirect(next);
}

export async function lockSiteGate() {
  if (!gateEnv()) redirect("/");
  const store = await cookies();
  store.delete(SITE_GATE_COOKIE);
  redirect("/login");
}
