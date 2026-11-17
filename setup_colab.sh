#!/bin/bash
set -e
WANT_JUDGE=${1:-0}
export DEBIAN_FRONTEND=noninteractive
apt-get -qq update
apt-get -qq install -y libegl1 libgl1 libgl1-mesa-dri libglib2.0-0 libosmesa6 ffmpeg > /dev/null
pip -q install uv
cd /content
[ -d cosmos-policy ] || git clone -q --depth 1 https://github.com/NVlabs/cosmos-policy.git
[ -d LIBERO ] || git clone -q --depth 1 https://github.com/Lifelong-Robot-Learning/LIBERO.git
(cd cosmos-policy && uv sync -q --extra cu128 --group libero --python 3.10) &
PIDS=$!
if [ "$WANT_JUDGE" = 1 ]; then
  [ -d robometer ] || git clone -q --depth 1 https://github.com/robometer/robometer.git
  (cd robometer && uv sync -q && uv pip install -q --python .venv/bin/python "torchao==0.13.0" h5py pyyaml pillow) &
  PIDS="$PIDS $!"
fi
hf download nvidia/Cosmos-Policy-LIBERO-Predict2-2B > /dev/null
hf download nvidia/Cosmos-Predict2-2B-Video2World tokenizer/tokenizer.pth > /dev/null
for p in $PIDS; do wait $p; done

cat > /content/env.sh <<'EOF'
export MUJOCO_GL=egl PYOPENGL_PLATFORM=egl
export __EGL_VENDOR_LIBRARY_FILENAMES=/content/10_nvidia.json
export LD_LIBRARY_PATH=/usr/lib64-nvidia:$LD_LIBRARY_PATH
export CPV=/content/cosmos-policy/.venv/bin/python
export RBV=/content/robometer/.venv/bin/python
EOF
echo '{"file_format_version": "1.0.0", "ICD": {"library_path": "/usr/lib64-nvidia/libEGL_nvidia.so.0"}}' > /content/10_nvidia.json
CPV=/content/cosmos-policy/.venv/bin/python
L=$($CPV -c "import importlib.util, os; print(os.path.dirname(importlib.util.find_spec('libero').origin))")
[ -d "$L/libero" ] && L=$L/libero
mkdir -p /root/.libero
printf "benchmark_root: %s\nbddl_files: %s/bddl_files\ninit_states: %s/init_files\ndatasets: %s/../datasets\nassets: /content/LIBERO/libero/libero/assets\n" "$L" "$L" "$L" "$L" > /root/.libero/config.yaml
[ -e $L/assets ] || ln -s /content/LIBERO/libero/libero/assets $L/assets
echo SETUP_DONE
