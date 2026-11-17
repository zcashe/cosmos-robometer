import argparse
import glob
import json
import os
import shutil

import h5py
import numpy as np

p = argparse.ArgumentParser()
p.add_argument('--scores', required=True)
p.add_argument('--traj_dirs', required=True, help='glob of the run traj/ folders the scores came from')
p.add_argument('--out', required=True)
p.add_argument('--by', choices=['progress', 'success_prob', 'true_success'], default='progress')
p.add_argument('--threshold', type=float, default=0.5)
p.add_argument('--suite', default='libero_spatial')
a = p.parse_args()

paths = {}
for d in glob.glob(a.traj_dirs):
    for f in glob.glob(os.path.join(d, '*.hdf5')):
        name = os.path.basename(f)
        t, e, r = name.split('_')[:3]
        paths[(int(t[4:]), int(e[2:]), int(r[1:]))] = f

groups = {}
for r in map(json.loads, open(a.scores)):
    groups.setdefault((r['task'], r['ep']), []).append(r)
score = (lambda r: float(r['success'])) if a.by == 'true_success' else (lambda r: r[a.by][-1])

out = os.path.join(a.out, f'suite={a.suite}')
shutil.rmtree(a.out, ignore_errors=True)
os.makedirs(out)
kept = []
for state, rows in sorted(groups.items()):
    best = max(rows, key=score)
    if score(best) < a.threshold:
        continue
    dst = os.path.join(out, os.path.basename(paths[(best['task'], best['ep'], best['rseed'])]))
    shutil.copyfile(paths[(best['task'], best['ep'], best['rseed'])], dst)
    with h5py.File(dst, 'a') as f:
        f.attrs['success'] = True
    kept.append(best)
print(f'kept {len(kept)} of {len(groups)} start states; truly successful among them {np.mean([r["success"] for r in kept]):.3f}')
