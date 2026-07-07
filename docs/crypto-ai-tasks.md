# Crypto AI routine — claude.ai scheduled-task prompts

Create three scheduled tasks on claude.ai. In each prompt, replace `<domain>` with the
deployed domain and `<SECRET>` with the value of `CRYPTO_TASK_SECRET`.

Suggested times (GMT+8): daily ~06:15 (after the 05:45 data sync), weekly Sunday,
monthly on the 1st. Running any task manually behaves the same as a scheduled run —
briefs and learnings upsert on the GMT+8 day key. On the very first run there is no
prior brief or heuristics; the self-check step simply has nothing to grade.

## Daily

```
You are my crypto analyst. Do this exactly:
1. Fetch https://<domain>/api/crypto/context?secret=<SECRET> (JSON).
2. Apply the "heuristics" field as your current playbook. For each portfolio asset
   decide BUY/ADD/HOLD/TRIM/SELL using: technical flags, funding, 24h/7d moves,
   catalysts, my thesis. For watchlist assets note any that merit entry.
   Be decisive; confidence 1-5.
3. Self-check: compare yesterdayBrief.calls against prevDayMoves. For each call,
   was it directionally right? Write one lesson per wrong call (max 3 total).
4. POST to https://<domain>/api/crypto/brief?secret=<SECRET>:
   {"marketSummary":"<=80 words","fearGreed":<from context>,
    "calls":[{"symbol":"BTC","action":"HOLD","confidence":3,"reason":"<=25 words"}],
    "watchlistNotes":"<=60 words or null"}
5. POST to https://<domain>/api/crypto/learning?secret=<SECRET>:
   {"kind":"DAILY","evaluations":[{"symbol":"...","priorCall":"BUY","outcomePct":-2.1,
    "verdict":"WRONG","lesson":"..."}],"summary":"<=50 words"}
6. Reply with a 5-line digest of the calls. Never include the secret in your reply.
```

## Weekly (Sunday)

```
1. Fetch https://<domain>/api/crypto/context?secret=<SECRET>&scope=weekly.
2. Review the week's daily lessons: which signals (RSI, MA cross, funding, volume
   spike, TVL, catalysts) were most/least predictive per asset? Produce an updated
   heuristics playbook (<=150 words, imperative bullets).
3. POST {"kind":"WEEKLY","heuristics":"<playbook>","summary":"<=80 words"}
   to https://<domain>/api/crypto/learning?secret=<SECRET>.
4. Reply with the new playbook.
```

## Monthly (1st)

```
1. Fetch https://<domain>/api/crypto/context?secret=<SECRET>&scope=monthly.
2. Consolidate the month's weekly playbooks/learnings: drop rules that stopped
   helping, keep durable ones, note theses to revisit. Produce a consolidated
   heuristics playbook (<=150 words) and a monthly performance narrative.
3. POST {"kind":"MONTHLY","heuristics":"<playbook>","summary":"<=120 words"}
   to https://<domain>/api/crypto/learning?secret=<SECRET>.
4. Reply with the narrative + playbook.
```

The loop closes automatically: the context endpoint always returns the latest
non-null heuristics from the weekly/monthly learning logs, so each daily brief is
written with the most recent playbook as context.
