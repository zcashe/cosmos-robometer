import argparse
import glob
import io
import json
import os
import re
import sys
import types
from dataclasses import fields
from pathlib import Path

import h5py
import numpy as np
import torch
import yaml
from PIL import Image

JUDGES = {'base': 'robometer/Robometer-4B', 'libero': 'jesbu1/robometer-4b-fft-libero'}
HEADS = ('progress_head.', 'preference_head.', 'success_head.', 'similarity_head.', 'frame_pool_attn.')

p = argparse.ArgumentParser()
p.add_argument('--judge', choices=list(JUDGES), required=True)
p.add_argument('--traj', required=True, help='glob of trajectory .hdf5 files')
p.add_argument('--out', required=True)
p.add_argument('--robometer_repo', default='/content/robometer')
p.add_argument('--frames', type=int, default=8)
a = p.parse_args()

sys.path.insert(0, a.robometer_repo)
sys.modules.setdefault('unsloth', types.SimpleNamespace(FastVisionModel=None))
from huggingface_hub import snapshot_download
from robometer.configs.experiment_configs import ExperimentConfig
from robometer.data.dataset_types import ProgressSample, Trajectory
from robometer.evals.eval_server import compute_batch_outputs
from robometer.models import RBM
from robometer.utils.setup_utils import _add_special_tokens_and_resize, _setup_processor_and_tokenizer, setup_batch_collator
from safetensors import safe_open
from transformers import Qwen3VLModel


def load_judge(model_id):
    ckpt = Path(snapshot_download(model_id, allow_patterns=['*.json', '*.yaml', '*.safetensors']))

    class Loader(yaml.SafeLoader):
        pass

    Loader.add_constructor('tag:yaml.org,2002:python/object:robometer.models.rewind_transformer.ReWINDTransformerConfig',
                           lambda loader, node: loader.construct_mapping(node))
    raw = yaml.load((ckpt / 'config.yaml').read_text(), Loader=Loader)
    cfg = ExperimentConfig(**{k: v for k, v in raw.items() if k in {f.name for f in fields(ExperimentConfig)}})
    cfg.model.use_unsloth = False
    cfg.data.use_multi_image = True
    processor = _setup_processor_and_tokenizer(cfg.model)
    base = Qwen3VLModel.from_pretrained(ckpt, dtype=torch.bfloat16, attn_implementation='sdpa', device_map={'': 'cuda'}, key_mapping={r'^model\.': ''})
    _add_special_tokens_and_resize(cfg.model, processor, base)
    model = RBM(config=base.config, processor=processor, tokenizer=processor.tokenizer, base_model=base,
                base_model_id=cfg.model.base_model_id, model_config=cfg.model)
    heads = {}
    for shard in sorted(ckpt.glob('model-*.safetensors')):
        with safe_open(str(shard), framework='pt') as f:
            heads.update({k: f.get_tensor(k) for k in f.keys() if k.startswith(HEADS)})
    own = model.state_dict().keys()
    model.load_state_dict({k: v for k, v in heads.items() if k in own}, strict=False)
    for name in ('progress_head', 'preference_head', 'success_head', 'frame_pool_attn'):
        if hasattr(model, name):
            getattr(model, name).to(device='cuda', dtype=torch.bfloat16)
    collator = setup_batch_collator(processor, processor.tokenizer, cfg, is_eval=True)
    discrete = getattr(cfg.loss, 'progress_loss_type', 'l2').lower() == 'discrete'
    return model.eval(), processor.tokenizer, collator, discrete, getattr(cfg.loss, 'progress_discrete_bins', None) or 10


model, tokenizer, collator, discrete, bins = load_judge(JUDGES[a.judge])


@torch.no_grad()
def score(frames, task):
    traj = Trajectory(frames=frames, frames_shape=tuple(frames.shape), task=task, id='0', metadata={'subsequence_length': len(frames)})
    inputs = collator([ProgressSample(trajectory=traj, sample_type='progress')])['progress_inputs']
    inputs = {k: v.to('cuda') if hasattr(v, 'to') else v for k, v in inputs.items()}
    out = compute_batch_outputs(model, tokenizer, inputs, sample_type='progress', is_discrete_mode=discrete, num_bins=bins)
    return np.clip(np.asarray(out['progress_pred'][0], float), 0, 1).tolist(), np.asarray(out['outputs_success']['success_probs'][0], float).tolist()


done = set()
if os.path.exists(a.out):
    done = {(r['task'], r['ep'], r['rseed']) for r in map(json.loads, open(a.out))}
files = sorted(glob.glob(a.traj))
print(len(files), 'trajectories,', len(done), 'already scored', flush=True)
for n, path in enumerate(files):
    m = re.search(r'task(\d+)_ep(\d+)_r(\d+)_success(\d)', os.path.basename(path))
    key = tuple(int(m.group(i)) for i in (1, 2, 3))
    if key in done:
        continue
    with h5py.File(path, 'r') as h:
        task = h.attrs['task_description']
        task = task.decode() if isinstance(task, bytes) else str(task)
        idx = np.unique(np.linspace(0, len(h['primary_images_jpeg']) - 1, a.frames).round().astype(int))
        frames = np.stack([np.asarray(Image.open(io.BytesIO(h['primary_images_jpeg'][i].tobytes())).convert('RGB').resize((224, 224), Image.BILINEAR)) for i in idx])
    prog, succ = score(frames, task)
    row = dict(task=key[0], ep=key[1], rseed=key[2], success=bool(int(m.group(4))), progress=prog, success_prob=succ)
    with open(a.out, 'a') as f:
        f.write(json.dumps(row) + '\n')
    if n % 100 == 0:
        print(n, flush=True)
print('SCORED', len(files), flush=True)
