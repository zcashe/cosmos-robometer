import argparse
import json
import os

import numpy as np

p = argparse.ArgumentParser()
p.add_argument('--runs', nargs='*', default=[], help='rollout output folders; the first one is the baseline for paired differences')
p.add_argument('--scores', nargs='*', default=[], help='judge score files')
a = p.parse_args()


def auroc(s, y):
    s, y = np.asarray(s), np.asarray(y, bool)
    pos, neg = s[y], s[~y]
    return float(((pos[:, None] > neg[None]) + 0.5 * (pos[:, None] == neg[None])).mean()) if len(pos) and len(neg) else float('nan')


def boot_ci(x, n=5000):
    rng = np.random.default_rng(0)
    m = [x[rng.integers(0, len(x), len(x))].mean() for _ in range(n)]
    return np.percentile(m, 2.5), np.percentile(m, 97.5)


if a.runs:
    runs = {r: {(e['task'], e['ep']): e['success'] for e in map(json.loads, open(os.path.join(r, 'episodes.jsonl')))} for r in a.runs}
    base = runs[a.runs[0]]
    print('| run | episodes | success | per task | vs first run (paired, 95% CI) |\n|---|---|---|---|---|')
    for r, d in runs.items():
        tasks = sorted({t for t, _ in d})
        per = ' '.join(f'{np.mean([v for (t, _), v in d.items() if t == k]):.2f}' for k in tasks)
        shared = [k for k in d if k in base]
        diff = np.array([d[k] - base[k] for k in shared], float)
        lo, hi = boot_ci(diff) if r != a.runs[0] and len(diff) else (0, 0)
        cmp = '-' if r == a.runs[0] else f'{diff.mean():+.3f} [{lo:+.3f}, {hi:+.3f}]'
        print(f'| {os.path.basename(r.rstrip("/"))} | {len(d)} | {np.mean(list(d.values())):.3f} | {per} | {cmp} |')

for f in a.scores:
    rows = [json.loads(l) for l in open(f)]
    groups = {}
    for r in rows:
        groups.setdefault((r['task'], r['ep']), []).append(r)
    k = max(len(g) for g in groups.values())
    groups = {s: g for s, g in groups.items() if len(g) == k}
    single = np.mean([r['success'] for g in groups.values() for r in g])
    oracle = np.mean([any(r['success'] for r in g) for g in groups.values()])
    mixed = [g for g in groups.values() if 0 < sum(r['success'] for r in g) < len(g)]
    print(f'\n{os.path.basename(f)}: {len(groups)} start states x {k} attempts; single attempt {single:.3f}, best-of-{k} ceiling {oracle:.3f}, mixed states {len(mixed)}')
    print(f'| score | AUROC | best-of-{k} pick success | picks a success on mixed states |\n|---|---|---|---|')
    for key in ('progress', 'success_prob'):
        pick = lambda g: max(g, key=lambda r: r[key][-1])['success']
        print(f'| final {key} | {auroc([r[key][-1] for r in rows], [r["success"] for r in rows]):.3f} | '
              f'{np.mean([pick(g) for g in groups.values()]):.3f} | {sum(pick(g) for g in mixed)}/{len(mixed)} |')
