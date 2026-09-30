"""扒谱流水线的公共部分：basic-pitch 帧时刻、简谱音名、音频读取。"""
import numpy as np

SR_BP = 22050          # basic-pitch 的采样率
BP_FRAMES_PER_WIN = 142  # 每个 2 秒窗口保留的帧数（172 帧去掉两侧各 15 帧重叠）
BP_WIN_HOP = 36164       # 窗口步进（采样）= 43844 − 7680


def frame_time(i):
    """basic-pitch 后验图的帧号 → 秒。

    basic-pitch 按 2 秒窗口推理，窗口内帧移 256 采样，但窗口之间步进 36164 采样（每窗只留 142 帧），
    所以帧率并不是均匀的 86.13 帧/秒（整体约 86.58 帧/秒）。按均匀帧率换算，五分钟后会差出 0.6 秒以上。
    """
    i = np.asarray(i, dtype=float)
    w = np.floor(i / BP_FRAMES_PER_WIN)
    return (w * BP_WIN_HOP + (i - w * BP_FRAMES_PER_WIN) * 256) / SR_BP


def time_frame(t):
    """秒 → basic-pitch 帧号（frame_time 的反函数，取整）。"""
    t = np.asarray(t, dtype=float) * SR_BP
    w = np.floor(t / BP_WIN_HOP)
    return (w * BP_FRAMES_PER_WIN + np.minimum(BP_FRAMES_PER_WIN - 1, (t - w * BP_WIN_HOP) / 256)).astype(int)


DEG = {0: '1', 2: '2', 4: '3', 5: '4', 7: '5', 9: '6', 11: '7', 1: '#1', 3: '#2', 6: '#4', 8: '#5', 10: 'b7'}


def jianpu(midi, tonic):
    """MIDI → 本项目的文字简谱音名（' 高八度，, 低八度）。"""
    r = (midi - tonic) % 12
    o = (midi - tonic) // 12
    return DEG[r] + ("'" * o if o > 0 else ',' * (-o))
