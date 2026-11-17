import argparse
import glob
import os

import torch
import torch.distributed.checkpoint as dcp
from torch.distributed.checkpoint import FileSystemReader

p = argparse.ArgumentParser()
p.add_argument('--ckpt', required=True, help='training checkpoint folder, e.g. .../checkpoints/iter_000002000')
p.add_argument('--out', required=True)
p.add_argument('--save_lora', default='', help='optional small file with only the LoRA weights')
a = p.parse_args()

reader = FileSystemReader(os.path.join(a.ckpt, 'model'))
meta = reader.read_metadata().state_dict_metadata
lora = {k: torch.empty(v.size, dtype=v.properties.dtype) for k, v in meta.items() if '.lora_' in k}
try:
    dcp.load(lora, storage_reader=reader)
except TypeError:
    dcp.load(lora, storage_reader=reader, no_dist=True)

if a.save_lora:
    torch.save(lora, a.save_lora)

snap = glob.glob(os.path.expanduser('~/.cache/huggingface/hub/models--nvidia--Cosmos-Policy-LIBERO-Predict2-2B/snapshots/*'))[0]
sd = torch.load(os.path.join(snap, 'Cosmos-Policy-LIBERO-Predict2-2B.pt'), map_location='cpu', weights_only=False)
n = 0
for k in [k for k in lora if '.lora_A.' in k]:
    w = k.split('.lora_A.')[0] + '.weight'
    sd[w] = (sd[w].float() + lora[k.replace('.lora_A.', '.lora_B.')].float() @ lora[k].float()).to(sd[w].dtype)
    n += 1
sd = {k: v for k, v in sd.items() if not k.endswith('_extra_state')}
torch.save(sd, a.out)
print('merged', n, 'LoRA layers into', a.out)
