"""扒谱结果与原录音的客观比较（先运行 run.py 生成中间文件）。

    python tools/transcribe/evaluate.py shimian   # 琵琶：用同一个 basic-pitch 分别“听”原录音与合成，比较音符后验图
    python tools/transcribe/evaluate.py bainiao   # 唢呐：合成演奏的音与原录音主旋律基频逐帧比较

合成音频由 src/ 下的物理建模按 src/score/<id>.js 渲染（与网页相同）。
"""
import os
import sys
import json
import subprocess
import numpy as np
from scipy.ndimage import binary_dilation

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
os.environ.setdefault('KMP_DUPLICATE_LIB_OK', 'TRUE')
from run import PIECES  # noqa: E402
from common import time_frame  # noqa: E402


def main():
    pid = sys.argv[1]
    cfg = PIECES[pid]
    work = os.path.join(ROOT, 'output', 'transcribe', pid)
    lead = json.load(open(os.path.join(work, 'score_timing.json')))['lead']
    wav, notes_json = os.path.join(work, 'synth.wav'), os.path.join(work, 'synth_notes.json')
    subprocess.run(['node', os.path.join(HERE, 'render-notes.mjs'), pid, wav, notes_json], check=True, cwd=ROOT)
    if cfg['kind'] == 'pipa':
        from basic_pitch.inference import run_inference, Model
        from basic_pitch import ICASSP_2022_MODEL_PATH
        ns = run_inference(wav, Model(os.path.join(os.path.dirname(ICASSP_2022_MODEL_PATH), 'nmp.onnx')))['note']
        no = np.roll(np.load(os.path.join(work, 'bp.npz'))['note'], cfg['shift'], axis=1)
        pad = int(time_frame(max(0.0, lead)))
        ns = np.concatenate([np.zeros((pad, 88)), ns])
        T = min(len(no), len(ns))
        A, B = no[:T] > 0.4, ns[:T] > 0.4
        Ad, Bd = binary_dilation(A, np.ones((5, 1))), binary_dilation(B, np.ones((5, 1)))
        P = (B & Ad).sum() / max(1, B.sum())
        R = (A & Bd).sum() / max(1, A.sum())
        print(f'音符后验图逐帧比较（±2 帧）：精确率 {P:.3f}，召回率 {R:.3f}，F 值 {2 * P * R / (P + R):.3f}')
    else:
        f = json.load(open(os.path.join(work, 'f0.json')))
        t = np.array(f['t'])
        m = np.array([np.nan if x is None else x - cfg['off'] for x in f['midi']])
        syn = np.full(len(t), np.nan)
        for t0, t1, mm in json.load(open(notes_json)):
            syn[np.searchsorted(t, t0 + lead):np.searchsorted(t, t1 + lead)] = mm
        vo, vs = ~np.isnan(m), ~np.isnan(syn)
        both = vo & vs
        d = np.abs(m[both] - syn[both])
        print(f'有声帧召回 {both.sum() / vo.sum():.3f}；两者都有声的帧中，音高相差半音以内 {np.mean(d < 0.5):.3f}、一个半音以内 {np.mean(d < 1.0):.3f}')


if __name__ == '__main__':
    main()
