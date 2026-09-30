"""从演奏录像扒谱，生成 src/score/<id>.js。

    python tools/transcribe/run.py shimian        # 琵琶《十面埋伏》
    python tools/transcribe/run.py bainiao        # 唢呐《百鸟朝凤》
    python tools/transcribe/run.py shimian --from=condense   # 从某一步重跑

中间文件放在 output/transcribe/<id>/。依赖见 tools/transcribe/README.md。
"""
import os
import sys
import json
import shutil
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
os.environ.setdefault('KMP_DUPLICATE_LIB_OK', 'TRUE')
import stages  # noqa: E402

PIECES = {
    'shimian': {
        'video': '音乐/十面埋伏.mp4', 'kind': 'pipa', 'tonic': 62, 'tonicName': 'D4',
        # 录音比现代标准定弦（A d e a）高约 1.24 个半音（四根空弦实测为 B♭ E♭ F B♭，偏高 24 音分）
        'shift': -1, 'lo': 45, 'hi': 88, 'jiao_from': 183.0, 'start': 3.7,
        'sections': [
            [3.8, '列营'], [33.1, '吹打'], [47.2, '点将'], [78.2, '排阵'], [91.3, '走队'], [140.6, '埋伏'],
            [151.0, '鸡鸣山小战'], [183.4, '九里山大战'], [300.1, '项王败阵'],
        ],
        'header': [
            '《十面埋伏》——琵琶独奏。依据项目“音乐/十面埋伏.mp4”（刘德海演奏的影片录音）自动扒谱。',
            '',
            '扒谱方法（tools/transcribe/）：basic-pitch 复音转写 → 拨弦事件（去泛音）→ 同音高每秒 9 下以上的重复归并为轮指 ~，',
            '同时起音的多个音为和音 / 扫弦，“九里山大战”之后频谱平坦的噪声段为绞弦 x → 节拍跟踪（♩=55–160）→ 2/4 拍、',
            '十六分音符网格量化（同一拍里挤两个音时改用三十二分）。每小节的 !t= 是该小节在录音里的实测速度，保留了演奏的散板与弹性速度；',
            '力度按小节响度分 p–ff 五档，> 为明显强于周围的音。段落名称按乐曲结构与录音中的停顿、织体变化判断。',
            '',
            '音高：录音比现代标准定弦（A d e a）整体高约 1.24 个半音（胶片转速或当年定弦），这里一律移到标准定弦，1 = D。',
            '这是机器转写再经规则整理的结果，不是出版乐谱：快速经过句、密集扫弦与绞弦段的音高只是近似，个别和音可能多出或漏掉泛音。',
        ],
    },
    'bainiao': {
        'video': '音乐/百鸟朝凤.mp4', 'kind': 'suona', 'tonic': 69, 'tonicName': 'A4',
        'off': 0.38, 'lo': 63, 'hi': 101, 'start': 0.0,
        'sections': [
            [0.0, '引子·鸟鸣'], [42.4, '慢板'], [118.0, '鸟鸣'], [150.0, '中板'], [176.3, '鸟鸣对答'],
            [217.1, '快板'], [251.2, '长音鸟鸣'], [288.0, '快板再现'], [311.0, '高音鸟鸣'], [330.0, '尾声'],
        ],
        'header': [
            '《百鸟朝凤》——唢呐与民族乐队。依据项目“音乐/百鸟朝凤.mp4”（唢呐完整版演出录像）自动扒出唢呐声部。',
            '',
            '扒谱方法（tools/transcribe/）：basic-pitch 音高轮廓后验 → “天际线”主旋律（唢呐几乎总在乐队之上，取唢呐音域内最高的可信音高，',
            'Viterbi 平滑）→ 按 20 秒窗口估计局部音准并吸附到 A 大调音阶 → 切分音符：/ \\ 滑音、{ } 倚音（打音）、< > 两音快速交替（颤音 / 鸟鸣），',
            '唢呐停顿时追踪到的乐队声部已删除 → 节拍跟踪 → 2/4 拍、十六分音符网格；休止按实际收音时刻写出。',
            '每小节的 !t= 是录音中的实测速度；力度按小节响度分五档。段落名称按录音里的音区、密度与停顿划分，属描述性标注。',
            '',
            '音高：录音整体比 A4 = 440 Hz 高约 38 音分，这里移到平均律，1 = A（与任同祥演奏谱的 A 大调一致）。',
            '这是机器转写再经规则整理的结果，不是出版乐谱：鸟鸣段的连续滑音被拆成音符加滑音记号，只是近似。',
        ],
    },
}

STEPS = ['audio', 'bp', 'notes', 'beats', 'emit']


def ffmpeg():
    exe = shutil.which('ffmpeg')
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def main():
    pid = sys.argv[1]
    cfg = PIECES[pid]
    start_step = next((a.split('=')[1] for a in sys.argv[2:] if a.startswith('--from=')), 'audio')
    todo = STEPS[STEPS.index(start_step):] if start_step in STEPS else STEPS
    work = os.path.join(ROOT, 'output', 'transcribe', pid)
    os.makedirs(work, exist_ok=True)
    if 'audio' in todo:
        subprocess.run([ffmpeg(), '-y', '-loglevel', 'error', '-i', os.path.join(ROOT, cfg['video']), '-vn', '-ac', '1', '-ar', '44100',
                        os.path.join(work, 'audio.wav')], check=True)
        print('音频已提取')
    if 'bp' in todo:
        stages.run_basic_pitch(work)
    if 'notes' in todo:
        if cfg['kind'] == 'pipa':
            stages.pipa_events(work, cfg['shift'], cfg['lo'], cfg['hi'])
            stages.noise_profile(work)
            stages.pipa_condense(work, cfg['jiao_from'])
        else:
            stages.suona_skyline(work, cfg['lo'], cfg['hi'])
            stages.suona_notes(work, cfg['off'], cfg['tonic'])
    if 'beats' in todo:
        stages.track_beats(work)
    if 'emit' in todo:
        secs = [{'t': t, 'name': n} for t, n in cfg['sections']]
        text, lead = stages.emit_score(work, cfg['tonic'], secs, start=cfg['start'], real_end=cfg['kind'] == 'suona')
        header = '\n'.join(('// ' + h).rstrip() for h in cfg['header'])
        js = (f"{header}\n//\n// 录音 {lead:.2f} 秒处为乐谱第 0 拍。记谱说明见 src/score/jianpu.js 顶部；本文件由 tools/transcribe/run.py 生成。\n\n"
              f"export const text = String.raw`\n@title {'十面埋伏' if pid == 'shimian' else '百鸟朝凤'}\n@tonic {cfg['tonicName']}\n"
              f"@tempo 60\n@meter 2/4\n\n{text}`;\n\nexport default text;\n")
        out = os.path.join(ROOT, 'src', 'score', pid + '.js')
        open(out, 'w', encoding='utf-8', newline='\n').write(js)
        print('写出', os.path.relpath(out, ROOT))


if __name__ == '__main__':
    main()
