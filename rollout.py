import argparse
import json
import os
import pickle
from types import SimpleNamespace

import h5py
import numpy as np

os.environ.setdefault('MUJOCO_GL', 'egl')
os.environ.setdefault('PYOPENGL_PLATFORM', 'egl')
os.environ['DETERMINISTIC'] = 'True'

import cosmos_policy._src.imaginaire.utils.checkpoint_db as checkpoint_db

_download = checkpoint_db.get_checkpoint_by_hf
_UNUSED = ('Cosmos-Predict2-2B-Video2World/model-480p-16fps.pt', 'Cosmos-Policy-ALOHA-Predict2-2B/Cosmos-Policy-ALOHA-Predict2-2B.pt')
checkpoint_db.get_checkpoint_by_hf = lambda uri: uri if uri.endswith(_UNUSED) else _download(uri)

from libero.libero import benchmark
from cosmos_policy.experiments.robot.cosmos_utils import get_action, get_model, init_t5_text_embeddings_cache, load_dataset_stats
from cosmos_policy.experiments.robot.libero.libero_utils import get_libero_dummy_action, get_libero_env
from cosmos_policy.experiments.robot.libero.run_libero_eval import TASK_MAX_STEPS, PolicyEvalConfig, prepare_observation
from cosmos_policy.utils.utils import jpeg_encode_image, set_seed_everywhere

p = argparse.ArgumentParser()
p.add_argument('--out', required=True)
p.add_argument('--suite', default='libero_spatial')
p.add_argument('--tasks_manifest', default='', help='tasks/manifest.json to run the custom cluttered tasks instead of a suite')
p.add_argument('--tasks', default='all')
p.add_argument('--episodes', default='25:50')
p.add_argument('--rseed', type=int, default=0)
p.add_argument('--scene_shift', type=float, default=0.10)
p.add_argument('--ckpt', default='nvidia/Cosmos-Policy-LIBERO-Predict2-2B')
p.add_argument('--save_traj', type=int, default=0)
a = p.parse_args()

HF = 'nvidia/Cosmos-Policy-LIBERO-Predict2-2B'
cfg = PolicyEvalConfig(
    config='cosmos_predict2_2b_480p_libero__inference_only', ckpt_path=a.ckpt, config_file='cosmos_policy/config/config.py',
    dataset_stats_path=f'{HF}/libero_dataset_statistics.json', t5_text_embeddings_path=f'{HF}/libero_t5_embeddings.pkl',
    use_wrist_image=True, use_proprio=True, normalize_proprio=True, unnormalize_actions=True,
    chunk_size=16, num_open_loop_steps=16, trained_with_image_aug=True, use_jpeg_compression=True, flip_images=True,
    num_denoising_steps_action=5, num_denoising_steps_future_state=1, num_denoising_steps_value=1,
    task_suite_name=a.suite, seed=195, deterministic=True)
stats = load_dataset_stats(cfg.dataset_stats_path)
init_t5_text_embeddings_cache(cfg.t5_text_embeddings_path)
model, _ = get_model(cfg)

if a.tasks_manifest:
    root = os.path.dirname(os.path.abspath(a.tasks_manifest))
    custom = json.load(open(a.tasks_manifest))
    n_tasks, max_steps = len(custom), 300
else:
    suite = benchmark.get_benchmark_dict()[a.suite]()
    n_tasks, max_steps = suite.n_tasks, TASK_MAX_STEPS[a.suite]
task_ids = range(n_tasks) if a.tasks == 'all' else [int(x) for x in a.tasks.split(',')]
e0, e1 = [int(x) for x in a.episodes.split(':')]


def load_task(tid):
    if not a.tasks_manifest:
        return suite.get_task(tid), suite.get_task_init_states(tid)
    t = custom[tid]
    bddl = os.path.join(root, t['bddl'])
    task = SimpleNamespace(language=t['language'], problem_folder=os.path.dirname(bddl), bddl_file=os.path.basename(bddl))
    return task, pickle.load(open(os.path.join(root, t['init']), 'rb'))


def shift_scene(env, rng):
    sim = env.env.sim
    m = sim.model
    free = [(j, m.jnt_bodyid[j]) for j in range(m.njnt) if m.jnt_type[j] == 0]
    free_bodies = {b for _, b in free}
    robotish = lambda name: name.startswith(('robot', 'mount', 'gripper'))
    fixtures = [b for b in range(1, m.nbody) if m.body_parentid[b] == 0 and b not in free_bodies
                and not robotish((m.body_id2name(b) or '').lower())
                and 'table' not in (m.body_id2name(b) or '').lower() and 'floor' not in (m.body_id2name(b) or '').lower()]
    touches_robot = lambda g: robotish((m.body_id2name(m.body_rootid[m.geom_bodyid[g]]) or '').lower())

    def contacts():
        sim.forward()
        cs = [sim.data.contact[k] for k in range(sim.data.ncon)]
        deep = sum(c.dist < -0.004 for c in cs)
        robot = sum(c.dist < -0.001 and (touches_robot(c.geom1) or touches_robot(c.geom2)) for c in cs)
        return deep, robot

    base_deep, _ = contacts()
    body_pos, qpos = m.body_pos.copy(), sim.data.qpos.copy()
    for _ in range(50):
        th = rng.uniform(0, 2 * np.pi)
        d = a.scene_shift * np.array([np.cos(th), np.sin(th)])
        for b in fixtures:
            m.body_pos[b, :2] = body_pos[b, :2] + d
        for j, _ in free:
            q = m.jnt_qposadr[j]
            sim.data.qpos[q:q + 2] = qpos[q:q + 2] + d
        deep, robot = contacts()
        if robot == 0 and deep <= base_deep:
            return True
    m.body_pos[:] = body_pos
    sim.data.qpos[:] = qpos
    sim.forward()
    return False


os.makedirs(os.path.join(a.out, 'traj'), exist_ok=True)
results = []
for tid in task_ids:
    task, init_states = load_task(tid)
    env, desc = get_libero_env(task, 'cosmos', resolution=256)
    for ep in range(e0, e1):
        env.reset()
        obs = env.set_init_state(init_states[ep])
        shifted = shift_scene(env, np.random.default_rng([0, tid, ep])) if a.scene_shift > 0 else False
        for _ in range(10):
            obs, _, _, _ = env.step(get_libero_dummy_action('cosmos'))
        prim, wrist, prop, acts, queue, success, t = [], [], [], [], [], False, 10
        while t < max_steps + 10:
            o = prepare_observation(obs, None, True)
            if not queue:
                set_seed_everywhere(a.rseed)
                r = get_action(cfg, model, stats, o, desc, seed=195 + a.rseed, randomize_seed=False,
                               num_denoising_steps_action=cfg.num_denoising_steps_action,
                               generate_future_state_and_value_in_parallel=True, batch_size=1)
                queue = [np.asarray(x) for x in r['actions']]
            act = queue.pop(0)
            prim.append(o['primary_image'])
            wrist.append(o['wrist_image'])
            prop.append(o['proprio'])
            acts.append(act)
            obs, _, done, _ = env.step(act.tolist())
            if done:
                success = True
                break
            t += 1
        row = dict(task=tid, ep=ep, rseed=a.rseed, success=success, steps=t, shifted=shifted)
        results.append(row)
        print(json.dumps(row), flush=True)
        with open(os.path.join(a.out, 'episodes.jsonl'), 'a') as f:
            f.write(json.dumps(row) + '\n')
        if a.save_traj:
            with h5py.File(os.path.join(a.out, 'traj', f'task{tid}_ep{ep}_r{a.rseed}_success{int(success)}.hdf5'), 'w') as f:
                jpeg = h5py.vlen_dtype(np.dtype('uint8'))
                f.create_dataset('primary_images_jpeg', data=[jpeg_encode_image(x, quality=95) for x in prim], dtype=jpeg)
                f.create_dataset('wrist_images_jpeg', data=[jpeg_encode_image(x, quality=95) for x in wrist], dtype=jpeg)
                f.create_dataset('proprio', data=np.stack(prop))
                f.create_dataset('actions', data=np.stack(acts))
                f.attrs['success'] = success
                f.attrs['task_description'] = desc
    env.close()
print(f'SUCCESS {np.mean([r["success"] for r in results]):.4f} over {len(results)} episodes', flush=True)
