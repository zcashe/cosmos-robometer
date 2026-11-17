# Cosmos Policy + Robometer best-of-N, clean version

The pipeline:
1. Run Cosmos Policy several times per start state.
2. Let Robometer judge each rollout.
3. Keep the judge's best attempt per start state.
4. LoRA fine-tune the policy on those picks.
5. Evaluate on held-out start states.

## Files

| file | what it does |
|---|---|
| `tasks/` | The 5 cluttered LIBERO tasks: same instructions as LIBERO, lookalike distractors added. Includes `bddl/`, 50 verified start states per task in `init/`, `preview/` images and `manifest.json`. |
| `tasks/make_tasks.py` | Rebuilds `tasks/` from `tasks/spec.json`. Each sampled start state is rejected if objects fall, slide, wobble, tip over or interpenetrate, if the task is already done, or if the target is off camera. |
| `rollout.py` | Runs the policy on a LIBERO suite or on the custom tasks, with the 10 cm scene shift. Writes `episodes.jsonl` and, with `--save_traj 1`, one `.hdf5` trajectory per episode. |
| `judge.py` | Scores trajectories with Robometer (`--judge base` or `--judge libero`). The score is 8 frames of the main camera, giving a per-frame progress and success probability. |
| `select_best.py` | Picks the judge's best attempt per start state, keeps it if its final score is at least 0.5, and writes the fine-tune folder. |
| `train_lora.py` | Cosmos Policy's own trainer, with one fix: the LoRA layers start from zero in the checkpoint and are re-initialized. |
| `merge_lora.py` | Merges the trained LoRA into the base checkpoint so `rollout.py --ckpt` can load it. |
| `report.py` | Success per run with paired differences, and per judge: AUROC, best-of-N pick success and the oracle ceiling. |
| `setup_colab.sh` | Colab VM setup: repos, environments, weights, the gated tokenizer, and the LIBERO and EGL config. |
| `notebooks/1_collect_and_judge.ipynb` | Colab, A100: rollouts with N seeds, base held-out eval, both judges, report, fine-tune set. |
| `notebooks/2_finetune_and_eval.ipynb` | Colab, A100: LoRA fine-tune, merge, held-out eval, report against base. |

## Running on Colab

The notebooks are self-contained: each one carries the scripts it needs in `%%writefile` cells, so only the `.ipynb` files have to be opened in Colab. The scripts still run as subprocesses, not in the notebook's own Python, because the policy and the judges each need their own environment (their torch/transformers versions conflict). Fine-tuning is also launched through `torch.distributed.run`, which needs a script file.

1. Add a Colab secret `HF_TOKEN`. It must come from a Hugging Face account that accepted the license of `nvidia/Cosmos-Predict2-2B-Video2World`.
2. Run notebook 1, then notebook 2. Results land in `MyDrive/cosmos_robometer/runs`. Notebook 1 also saves the built tasks there for notebook 2.

The `.py` files in this folder are the same code, for running locally.

## Results so far

Custom tasks, 10 cm shift, 125 start states × 8 attempts:

| | AUROC | best-of-8 success |
|---|---|---|
| single attempt | – | 0.450 |
| base Robometer, final success | 0.880 | 0.536 |
| LIBERO Robometer, final progress | 0.985 | 0.560 |
| oracle ceiling | – | 0.568 |

The base policy on the held-out states 25–49 scored 0.476 over 2 seeds.

On LIBERO-Spatial, fine-tuning on Robometer-picked rollouts gave about +6 points on held-out states (0.641 → ~0.70).

## What was removed from the research code

This version drops, compared with the research code:
- chunk-level best-of-N (candidate chunks scored in the simulator, on predicted future frames, by the value head, or by preference)
- the camera, lighting, color and layout perturbations
- the "dream" and oracle evals
- the HTTP scoring server
- the Colab CLI orchestration scripts
- the old view-orientation sweeps

## Checks done on this version

- `make_tasks.py` produces BDDL files byte-identical to the ones used, and reproduces the same start states.
- `rollout.py` reproduces the earlier results exactly on 4 held-out episodes (same success and step count).
- `judge.py` reproduces the stored scores: LIBERO judge exactly, base judge within 0.002.
- `report.py` reproduces the table above from the stored scores.
- `train_lora.py` and `merge_lora.py` follow the scripts that produced the fine-tune results, but were not re-run in this form.
