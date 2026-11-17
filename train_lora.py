import runpy

import torch

import cosmos_policy._src.imaginaire.utils.checkpoint_db as checkpoint_db
import cosmos_policy._src.predict2.checkpointer.dcp as dcp

_download = checkpoint_db.get_checkpoint_by_hf
_UNUSED = ('Cosmos-Predict2-2B-Video2World/model-480p-16fps.pt', 'Cosmos-Policy-ALOHA-Predict2-2B/Cosmos-Policy-ALOHA-Predict2-2B.pt')
checkpoint_db.get_checkpoint_by_hf = lambda uri: uri if uri.endswith(_UNUSED) else _download(uri)

_load = dcp.DistributedCheckpointer.load


def load_then_init_lora(self, model, *args, **kwargs):
    out = _load(self, model, *args, **kwargs)
    lora = [m for m in model.modules() if hasattr(m, 'reset_lora_parameters') and 'default' in getattr(m, 'lora_A', {})]
    if lora and all(float(m.lora_A['default'].weight.abs().sum()) == 0.0 for m in lora):
        with torch.no_grad():
            for m in lora:
                m.reset_lora_parameters('default', True)
    print(f'LORA modules {len(lora)}', flush=True)
    return out


dcp.DistributedCheckpointer.load = load_then_init_lora
runpy.run_module('cosmos_policy.scripts.train', run_name='__main__', alter_sys=True)
