import { ColorLegend } from './colorLegend';

export const NamedStyles: Record<string, any> = {
  title: { font: { bold: true, size: 14 } },
  hdr: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ColorLegend.YELLOW } } },
  inputY: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ColorLegend.YELLOW } } },
  inputCyan: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ColorLegend.CYAN } } },
  calc: { font: { italic: true } },
  tgt: { font: { bold: true } },
  silver: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ColorLegend.SILVER } } },
  ot: {},
  attn: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: ColorLegend.ATTN } } }
};
