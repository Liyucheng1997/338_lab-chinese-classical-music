// 曲目注册表
import yuzhou from './score/yuzhou.js';
import erquan from './score/erquan.js';
import bainiao from './score/bainiao.js';

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
    composer: '任同祥 版结构 · 本谱为编配',
    blurb: '八段体：山雀啼晓、春回大地、燕舞、林间嬉戏、百鸟朝凤、欢乐歌舞、凤凰展翅、并翅凌空。',
    tonic: 'A4',
    text: bainiao,
    timeline: { fermataStretch: 0.8 },
    perform: {},
    reverb: {},
  },
];
