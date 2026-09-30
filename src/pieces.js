// 曲目注册表
import yuzhou from './score/yuzhou.js';
import erquan from './score/erquan.js';
import bainiao from './score/bainiao.js';
import shimian from './score/shimian.js';

export const PIECES = [
  {
    id: 'yuzhou',
    title: '渔舟唱晚',
    instrument: 'guzheng',
    instrumentName: '古筝',
    composer: '娄树华 改编 · 曹正 订谱',
    blurb: '以老八板为素材：如歌的慢板刻画渔舟荡桨归来的暮色，快板以模进手法层层推向高潮。',
    tonic: 'D4',
    text: yuzhou,
    timeline: { fermataStretch: 0.9 },
    perform: {},
    reverb: {},
  },
  {
    id: 'erquan',
    title: '二泉映月',
    instrument: 'erhu',
    instrumentName: '二胡',
    composer: '华彦钧（阿炳）曲 · 杨荫浏 记谱',
    blurb: '盲艺人阿炳倾诉一生的悲歌：叹息式的下行、八度上跳的长音、滑音与揉弦，主题层层升高。',
    tonic: 'D4',
    text: erquan,
    timeline: { fermataStretch: 0.9, rubato: { amp: 0.07, period: 4 } },
    perform: {},
    reverb: {},
  },
  {
    id: 'bainiao',
    title: '百鸟朝凤',
    instrument: 'suona',
    instrumentName: '唢呐',
    composer: '唢呐与民族乐队 · 据演出录像扒谱（唢呐声部）',
    blurb: '散板引子的鸟鸣、如歌的慢板、鸟鸣对答、快板、长音与高音区的百鸟齐鸣：滑音、打音、颤音模仿林间群鸟。',
    tonic: 'A4',
    text: bainiao,
    timeline: { fermataStretch: 0.8 },
    perform: {},
    reverb: {},
  },
  {
    id: 'shimian',
    title: '十面埋伏',
    instrument: 'pipa',
    instrumentName: '琵琶',
    composer: '传统琵琶武曲 · 据刘德海演奏影片扒谱',
    blurb: '楚汉垓下之战：列营、吹打、点将、排阵、走队、埋伏、鸡鸣山小战、九里山大战、项王败阵。扫弦、轮指、绞弦与推拉写金鼓战声。',
    tonic: 'D4',
    text: shimian,
    timeline: { fermataStretch: 0.8 },
    perform: {},
    reverb: {},
  },
];
