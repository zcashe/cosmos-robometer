import json
import os
import pickle
import re
import sys

os.environ.setdefault('MUJOCO_GL', 'egl')
import numpy as np
from PIL import Image
from libero.libero import get_libero_path
from libero.libero.envs import OffScreenRenderEnv
from robosuite.utils.camera_utils import get_camera_transform_matrix, project_points_from_world_to_camera

HERE = os.path.dirname(os.path.abspath(__file__))
N_STATES = int(sys.argv[1]) if len(sys.argv) > 1 else 50
SPECS = json.load(open(os.path.join(HERE, 'spec.json')))
JITTER = 0.015


def build_bddl(spec):
    s = open(os.path.join(get_libero_path('bddl_files'), spec['source'])).read()
    s = re.sub(r'\(:language [^\n]*\)', f"(:language {spec['language']})", s)
    table = spec['table']
    regions, objects, inits, count = [], [], [], {}
    for i, (cls, (x, y)) in enumerate(spec['clutter']):
        count[cls] = count.get(cls, 1) + 1
        name, region = f'{cls}_{count[cls]}', f'clutter_region_{i}'
        box = ' '.join(str(round(v, 4)) for v in (x - JITTER, y - JITTER, x + JITTER, y + JITTER))
        regions.append(f'      ({region}\n          (:target {table})\n          (:ranges (\n              ({box})\n            )\n          )\n      )')
        objects.append(f'    {name} - {cls}')
        inits.append(f'    (On {name} {table}_{region})')
    s = s.replace('(:regions\n', '(:regions\n' + '\n'.join(regions) + '\n', 1)
    block = re.search(r'\(:objects\n(.*?)\n  \)', s, re.S)
    by_class = {}
    for line in block.group(1).split('\n') + objects:
        names, cls = line.strip().split(' - ')
        by_class.setdefault(cls.strip(), []).extend(names.split())
    s = s[:block.start(1)] + '\n'.join(f"    {' '.join(v)} - {k}" for k, v in by_class.items()) + s[block.end(1):]
    return s.replace('(:init\n', '(:init\n' + '\n'.join(inits) + '\n', 1)


def check(env, spec):
    sim = env.env.sim
    m = sim.model
    bodies = [(m.jnt_bodyid[j], m.body_id2name(m.jnt_bodyid[j])) for j in range(m.njnt) if m.jnt_type[j] == 0]
    spawn = {b: (sim.data.body_xpos[b].copy(), sim.data.body_xmat[b].reshape(3, 3)[:, 2].copy()) for b, _ in bodies}
    if env.env._check_success():
        return 'success_at_start', None
    for _ in range(10):
        obs, _, _, _ = env.step([0, 0, 0, 0, 0, 0, -1])
    image = obs['agentview_image'][::-1].copy()
    settled = {b: sim.data.body_xpos[b].copy() for b, _ in bodies}
    for _ in range(40):
        env.step([0, 0, 0, 0, 0, 0, -1])
    if env.env._check_success():
        return 'success_after_settle', None
    for b, name in bodies:
        z = sim.data.body_xmat[b].reshape(3, 3)[:, 2]
        if sim.data.body_xpos[b][2] < spawn[b][0][2] - 0.15:
            return f'fell_off:{name}', None
        if np.linalg.norm(settled[b][:2] - spawn[b][0][:2]) > 0.03:
            return f'slid:{name}', None
        if np.linalg.norm(sim.data.body_xpos[b] - settled[b]) > 0.01:
            return f'unstable:{name}', None
        if np.degrees(np.arccos(np.clip(np.dot(z, spawn[b][1]), -1, 1))) > 30:
            return f'tipped:{name}', None
    robot = lambda g: (m.body_id2name(m.body_rootid[m.geom_bodyid[g]]) or '').lower().startswith(('robot', 'mount', 'gripper'))
    for i in range(sim.data.ncon):
        c = sim.data.contact[i]
        if c.dist < -0.004 and not (robot(c.geom1) or robot(c.geom2)):
            return 'penetration', None
    T = get_camera_transform_matrix(sim, 'agentview', 256, 256)
    for name in spec['must_see']:
        b = [b for b in range(m.nbody) if (m.body_id2name(b) or '').startswith(name)][0]
        r, c = project_points_from_world_to_camera(sim.data.body_xpos[b].reshape(1, 3), T, 256, 256)[0]
        if not (8 <= r < 248 and 8 <= c < 248):
            return f'offscreen:{name}', None
    return 'ok', image


for d in ('bddl', 'init', 'preview'):
    os.makedirs(os.path.join(HERE, d), exist_ok=True)
manifest = []
for spec in SPECS:
    name = spec['name']
    bddl = os.path.join(HERE, 'bddl', f'{name}.bddl')
    open(bddl, 'w').write(build_bddl(spec))
    env = OffScreenRenderEnv(bddl_file_name=bddl, camera_heights=256, camera_widths=256)
    env.seed(0)
    states, images, rejected, tries = [], [], {}, 0
    while len(states) < N_STATES and tries < 4 * N_STATES:
        tries += 1
        env.reset()
        state = np.asarray(env.get_sim_state()).copy()
        env.reset()
        env.set_init_state(state)
        why, image = check(env, spec)
        if why != 'ok':
            rejected[why.split(':')[0]] = rejected.get(why.split(':')[0], 0) + 1
            continue
        states.append(state)
        if len(images) < 8:
            images.append(image)
    env.close()
    pickle.dump(states, open(os.path.join(HERE, 'init', f'{name}.pkl'), 'wb'))
    if images:
        Image.fromarray(np.concatenate(images, 1)).save(os.path.join(HERE, 'preview', f'{name}.png'))
    manifest.append(dict(name=name, language=spec['language'], bddl=f'bddl/{name}.bddl', init=f'init/{name}.pkl'))
    print(name, f'{len(states)} valid of {tries}', 'rejected', rejected, flush=True)
json.dump(manifest, open(os.path.join(HERE, 'manifest.json'), 'w'), indent=1)
