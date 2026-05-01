import { unlockSiteGate } from "@/lib/site-gate-actions";
import { gateConfigured, safeNextPath } from "@/lib/site-gate";

export const metadata = { title: "Unlock · Invoice App" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const configured = gateConfigured();
  const showError = params.error === "1";

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="card w-full max-w-sm p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Unlock Invoice App</h1>
          <p className="text-sm text-gray-500 mt-1">
            {configured ? "Enter your 6-digit PIN to continue." : "PIN gate is not configured on this deployment."}
          </p>
        </div>

        {!configured ? (
          <div className="rounded-md bg-amber-50 border border-amber-100 text-amber-900 text-sm px-3 py-2">
            Set <code className="text-xs bg-amber-100/80 px-1 rounded">APP_PIN</code> (six digits) and{" "}
            <code className="text-xs bg-amber-100/80 px-1 rounded">APP_GATE_SECRET</code>{" "}
            (16+ chars) on the server, then redeploy or restart locally.
          </div>
        ) : (
          <form action={unlockSiteGate} className="space-y-4">
            <input type="hidden" name="next" value={next} />
            {showError && (
              <div className="rounded-md bg-red-50 border border-red-100 text-red-800 text-sm px-3 py-2">Incorrect PIN. Try again.</div>
            )}
            <div>
              <label className="label" htmlFor="pin">
                PIN
              </label>
              <input
                id="pin"
                name="pin"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                className="input text-center tracking-[0.35em] text-lg font-medium"
                placeholder="••••••"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-2">Exactly 6 digits. Session lasts up to 30 days in this browser.</p>
            </div>
            <button type="submit" className="btn btn-primary w-full">
              Continue
            </button>
          </form>
        )}

        {configured && (
          <p className="text-xs text-gray-400 text-center pt-2">
            After unlocking, returns to <span className="text-gray-500">{next === "/" ? "home" : next}</span>.
          </p>
        )}
      </div>
    </div>
  );
}
