import glob, json, os
PRICES = [
    (("claude-fable-5-1",), 10, 50, 0.25, 2),
    (("claude-fable-5",), 10, 50, 1.0, 2),
    (("claude-opus-5-5",), 4, 20, 0.2, 2),
    (("claude-opus-5",), 5, 25, 0.5, 2),
    (("claude-opus-4", "claude-4.5-opus", "claude-4.6-opus", "claude-4.7-opus", "claude-4.8-opus"), 5, 25, 0.5, None),
    (("claude-sonnet-5",), 2, 10, 0.2, None),
    (("claude-sonnet-4", "claude-4.5-sonnet", "claude-4.6-sonnet"), 3, 15, 0.3, None),
    (("claude-haiku-4-5", "claude-4.5-haiku"), 1, 5, 0.1, None),
]
def price(model):
    best, length = None, 0
    for prefixes, *rates in PRICES:
        for p in prefixes:
            if model.lower().startswith(p) and len(p) > length:
                best, length = rates, len(p)
    return best
rows = {}
import sys
root = os.path.join(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~"), ".claude", "projects")
for path in glob.glob(root + "/**/*.jsonl", recursive=True):
    for line in open(path, encoding="utf-8", errors="replace"):
        if '"assistant"' not in line:
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        m = d.get("message") or {}
        u = m.get("usage")
        if d.get("type") != "assistant" or not u or not m.get("model") or m["model"] == "<synthetic>" or not d.get("sessionId"):
            continue
        key = m.get("id") or d.get("requestId")
        if not key:
            continue
        cc = u.get("cache_creation") or {}
        w1h = cc.get("ephemeral_1h_input_tokens", 0) or 0
        w5m = max(cc.get("ephemeral_5m_input_tokens", 0) or 0, (u.get("cache_creation_input_tokens") or 0) - w1h)
        vec = [u.get("input_tokens") or 0, w5m, w1h, u.get("cache_read_input_tokens") or 0, u.get("output_tokens") or 0]
        prev = rows.get(key)
        rows[key] = (m["model"], u.get("speed") == "fast", [max(a, b) for a, b in zip(prev[2], vec)] if prev else vec) if not prev else (prev[0], prev[1], [max(a, b) for a, b in zip(prev[2], vec)])
cost = 0.0
unpriced = 0
for model, fast, (i, w5, w1, r, o) in rows.values():
    p = price(model)
    if not p:
        unpriced += 1
        continue
    inp, out, cr, fm = p
    c = (i * inp + w5 * inp * 1.25 + w1 * inp * 2 + r * cr + o * out) / 1e6
    cost += c * (fm if fast and fm else 1)
print(json.dumps({"uniqueMessageIds": len(rows), "costUsd": round(cost, 2), "unpricedRequests": unpriced}))
