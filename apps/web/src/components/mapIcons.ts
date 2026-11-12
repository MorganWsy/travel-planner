/**
 * 地图标注图标库。
 *
 * 颜色区分大类，针形由用户挑；针头里的白色图案进一步区分地点类型，
 * 序号放在右上角的小圆徽标里。图案取自项目自带的 7 个类别图标（components/icons.tsx），
 * 不依赖外部图标字体，也不需要远程 glyphs。
 */

export interface IconShape {
  id: string;
  /** 中文名，用于图标按钮的提示气泡 */
  label: string;
  /** 24×24 视图里的路径，尖底朝下 */
  d: string;
  /** 中心挖空圆的半径（0 表示不挖） */
  hole?: number;
  /** 只描边不填充 */
  outline?: boolean;
}

export const ICON_SHAPES: IconShape[] = [
  {
    id: "drop",
    label: "水滴针",
    d: "M12 2.3c-4.1 0-7.4 3.3-7.4 7.4 0 5.5 7.4 12.6 7.4 12.6s7.4-7.1 7.4-12.6c0-4.1-3.3-7.4-7.4-7.4Z",
    hole: 2.9,
  },
  {
    id: "ring",
    label: "圆环针",
    d: "M12 2.3c-4.1 0-7.4 3.3-7.4 7.4 0 5.5 7.4 12.6 7.4 12.6s7.4-7.1 7.4-12.6c0-4.1-3.3-7.4-7.4-7.4Z",
    hole: 4.4,
  },
  {
    id: "dot",
    label: "圆点针",
    d: "M12 2.3c-4.1 0-7.4 3.3-7.4 7.4 0 5.5 7.4 12.6 7.4 12.6s7.4-7.1 7.4-12.6c0-4.1-3.3-7.4-7.4-7.4Z",
    hole: 2.2,
  },
  {
    id: "square",
    label: "方头针",
    d: "M6.4 2.4h11.2a2.2 2.2 0 0 1 2.2 2.2v8.5a4 4 0 0 1-1.3 2.9L12 22.6l-6.5-6.6a4 4 0 0 1-1.3-2.9V4.6a2.2 2.2 0 0 1 2.2-2.2Z",
    hole: 3.1,
  },
  {
    id: "line",
    label: "描边针",
    d: "M12 2.3c-4.1 0-7.4 3.3-7.4 7.4 0 5.5 7.4 12.6 7.4 12.6s7.4-7.1 7.4-12.6c0-4.1-3.3-7.4-7.4-7.4Z",
    outline: true,
  },
  {
    id: "wide",
    label: "宽头针",
    d: "M12 2.6c-5.2 0-9.2 4-9.2 9 0 6 9.2 10.8 9.2 10.8s9.2-4.8 9.2-10.8c0-5-4-9-9.2-9Z",
    hole: 3.4,
  },
];

export const SHAPE_BY_ID = new Map(ICON_SHAPES.map((shape) => [shape.id, shape]));

/** 图标 id 形如 "meal:ring"；为空或非法时回退到该类别第一个形状 */
export function resolveShape(icon: string | null | undefined): IconShape {
  const [cat, shapeId] = (icon ?? "").split(":");
  if (cat && shapeId && SHAPE_BY_ID.has(shapeId)) return SHAPE_BY_ID.get(shapeId)!;
  return ICON_SHAPES[0];
}

/** 类别图案：与 components/icons.tsx 的七个线性图标一一对应，24×24 视图 */
export const CATEGORY_GLYPHS: Record<string, string[]> = {
  attraction: ["M3.5 18l5.5-9 4 6 2.5-4 5 7z"],
  meal: ["M7 3.5v7M5 3.5v4a2 2 0 002 2h0a2 2 0 002-2v-4M7 10.5V20.5", "M16.5 3.5c-2 2-2.5 4.5-2.5 6.5h3v10"],
  lodging: ["M3.5 18v-11M3.5 14h17v4", "M7 10.5h3.5a1.5 1.5 0 011.5 1.5v2H7z"],
  transport: ["M4 15.5V8a2 2 0 012-2h12a2 2 0 012 2v7.5", "M4 15.5h16M7 15.5v2M17 15.5v2", "M6.5 11h11"],
  shopping: ["M5 8h14l-1.2 11a1.5 1.5 0 01-1.5 1.3H7.7A1.5 1.5 0 016.2 19z", "M9 8V6.5a3 3 0 016 0V8"],
  viewpoint: ["M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z", "M12 9.6a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8z"],
  other: ["M12 4.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15z", "M12 10.4a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2z"],
};

/**
 * 图标图案库：24 个通用符号（3 行 × 8 列），线性风格、24×24 视图。
 * 每个图案属于一个默认类别——用户改类别时自动换成本类默认图案，
 * 但任意图案都能手工换（颜色仍跟类别走，不跟图案走）。
 */
export interface Glyph {
  id: string;
  label: string;
  /** 包围盒（viewBox）：让每个图标在按钮里占同样大小 */
  box: string;
  /** 所属默认类别 */
  category: string;
  paths: string[];
}

export const GLYPH_LIBRARY: Glyph[] = [
  // 景点
  { id: "tower", label: "塔阁", category: "attraction", box: "6 2 10 20", paths: ["M7 21h10M9 21V6M15 21V6M9 6h6M12 3v3M8 12h8"] },
  { id: "mountain", label: "山峰", category: "attraction", box: "2 2 20 18", paths: ["M3 19l6-11 3 5 3-4 6 10z"] },
  { id: "bridge", label: "桥梁", category: "attraction", box: "2 8 20 9", paths: ["M3 16h18M6 16V9M18 16V9M6 9c3-4 9-4 12 0"] },
  { id: "wall", label: "城墙", category: "attraction", box: "3 5 18 16", paths: ["M4 20V8h4V6h3v2h3V6h3v2h3v12M4 14h16"] },
  { id: "temple", label: "古建", category: "attraction", box: "3 4 18 17", paths: ["M4 20h16M6 20v-8M18 20v-8M6 12h12M8 12V8h8v4M12 5v3"] },
  // 餐饮
  { id: "fork", label: "餐具", category: "meal", box: "4 2 13 20", paths: ["M7 3v6M5 3v3a2 2 0 002 2 2 2 0 002-2V3M7 11v10M16 3c-2 2-2.5 5-2.5 7h3v11"] },
  { id: "noodle", label: "面食", category: "meal", box: "3 2 18 19", paths: ["M4 12h16a8 8 0 01-16 0z", "M8 7c0-2 1-3 2-4M12 7c0-2 1-3 2-4"] },
  { id: "cup", label: "杯子", category: "meal", box: "4 7 15 15", paths: ["M6 8h10v6a5 5 0 01-10 0z", "M16 9h2a2 2 0 010 4h-2M5 21h12"] },
  { id: "coffee", label: "咖啡", category: "meal", box: "4 3 16 19", paths: ["M5 9h11v5a5 5 0 01-11 0z", "M16 10h2a2 2 0 010 4h-2M5 21h13M7 6c0-1 1-1 1-2M11 6c0-1 1-1 1-2"] },
  { id: "bar", label: "酒吧", category: "meal", box: "5 2 14 20", paths: ["M6 3h12l-6 8zM12 11v7M8 21h8"] },
  // 住宿
  { id: "bed", label: "床铺", category: "lodging", box: "2 8 20 11", paths: ["M3 18V9M3 14h18v4M21 14v4M7 12h3a1.5 1.5 0 011.5 1.5V14H7z"] },
  { id: "hotel", label: "酒店", category: "lodging", box: "4 4 16 18", paths: ["M5 21V5h14v16M9 9h2M13 9h2M9 13h2M13 13h2M10 21v-4h4v4"] },
  { id: "key", label: "钥匙", category: "lodging", box: "5 3 17 17", paths: ["M10 12a4 4 0 100-8 4 4 0 000 8z", "M13 11l8 8M17 15l2-2M15 17l2-2"] },
  { id: "home", label: "住宅", category: "lodging", box: "3 3 18 18", paths: ["M4 11l8-7 8 7v9H4z", "M10 20v-6h4v6"] },
  // 交通
  { id: "car", label: "汽车", category: "transport", box: "4 9 16 10", paths: ["M5 16V10h14v6M5 16h14M7 16v2M17 16v2M5 10l2-3h10l2 3M8 13h2M14 13h2"] },
  { id: "metro", label: "地铁", category: "transport", box: "4 3 16 20", paths: ["M7 4h10a2 2 0 012 2v9a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z", "M5 9h14M8 20l-2 2M16 20l2 2M8 13h2M14 13h2"] },
  { id: "plane", label: "飞机", category: "transport", box: "3 3 19 19", paths: ["M21 12l-7-2V5a1.5 1.5 0 00-3 0v5l-7 2v2l7-1v4l-2 2v2l3.5-1 3.5 1v-2l-2-2v-4l7 1z"] },
  { id: "bus", label: "公交", category: "transport", box: "2 4 20 17", paths: ["M5 5h14a2 2 0 012 2v8H3V7a2 2 0 012-2z", "M3 15h18v3H3zM7 18v2M17 18v2M6 9h3M15 9h3M7 12h2M15 12h2"] },
  { id: "dock", label: "船运", category: "transport", box: "3 3 18 18", paths: ["M4 17l2-5h12l2 5M6 17c0 2 2 3 6 3s6-1 6-3M12 4v8M8 8h8"] },
  // 购物
  { id: "bag", label: "购物袋", category: "shopping", box: "4 7 16 15", paths: ["M5 8h14l-1.2 11a1.5 1.5 0 01-1.5 1.3H7.7A1.5 1.5 0 016.2 19z", "M9 8V6.5a3 3 0 016 0V8"] },
  { id: "cart", label: "购物车", category: "shopping", box: "2 4 20 19", paths: ["M3 5h2l2 10h10l2-7H6", "M9 19a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM17 19a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"] },
  { id: "gift", label: "礼盒", category: "shopping", box: "3 3 18 19", paths: ["M4 9h16v4H4zM5 13h14v8H5zM12 9v12M9 9a2.5 2.5 0 010-5c2 0 3 5 3 5s1-5 3-5a2.5 2.5 0 010 5"] },
  { id: "basket", label: "生鲜", category: "shopping", box: "4 2 16 18", paths: ["M5 9h14l-1.5 9h-11z", "M8 9V6a4 4 0 018 0v3"] },
  // 观景
  { id: "eye", label: "观景", category: "viewpoint", box: "1 5 22 14", paths: ["M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z", "M12 9.6a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8z"] },
  { id: "binoculars", label: "望远镜", category: "viewpoint", box: "2 7 20 14", paths: ["M6 20a3 3 0 100-6 3 3 0 000 6zM18 20a3 3 0 100-6 3 3 0 000 6z", "M9 17l2-9h2l2 9M8 8h3M13 8h3"] },
  { id: "sunrise", label: "日出", category: "viewpoint", box: "1 3 22 14", paths: ["M12 4v3M5 12H2M22 12h-3M6 7l2 2M18 7l-2 2M8 16h8M4 16h2M18 16h2M7 16a5 5 0 0110 0"] },
  { id: "beach", label: "海滩", category: "viewpoint", box: "3 4 18 16", paths: ["M4 18c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5M6 13l3-6 3 3 3-4 3 7"] },
  { id: "camera", label: "拍照", category: "viewpoint", box: "3 5 18 16", paths: ["M4 8h3l1.5-2h7L17 8h3v11H4z", "M12 16a3 3 0 100-6 3 3 0 000 6z"] },
  { id: "camp", label: "露营", category: "viewpoint", box: "2 3 20 18", paths: ["M12 4L3 20h18z", "M12 4v16M8 20l4-6 4 6"] },
  // 指针形状与通用标记
  { id: "pin", label: "定位", category: "other", box: "6 2 12 16", paths: ["M12 3a5 5 0 015 5c0 4-5 9-5 9s-5-5-5-9a5 5 0 015-5z", "M12 8.5a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z"] },
  { id: "star", label: "星标", category: "other", box: "2 2 20 19", paths: ["M12 3l2.6 5.8 6.4.7-4.8 4.3 1.4 6.2L12 17.2 6.4 20l1.4-6.2L3 9.5l6.4-.7z"] },
  { id: "flag", label: "旗标", category: "other", box: "4 2 16 21", paths: ["M6 21V4M6 4h11l-2 4 2 4H6"] },
  { id: "navigation", label: "导航", category: "other", box: "2 2 21 21", paths: ["M3 11l18-8-8 18-2-8z"] },
  { id: "target", label: "靶心", category: "other", box: "1 1 22 22", paths: ["M12 3v3M12 18v3M3 12h3M18 12h3", "M12 8a4 4 0 100 8 4 4 0 000-8z"] },
  { id: "diamond", label: "菱点", category: "other", box: "5 2 14 20", paths: ["M12 3l5 9-5 9-5-9z"] },
  { id: "dot", label: "圆点", category: "other", box: "3 3 18 18", paths: ["M12 4a8 8 0 100 16 8 8 0 000-16z", "M12 10.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"] },
  { id: "toilet", label: "厕所", category: "other", box: "4 2 16 20", paths: ["M6 4h12M7 4v7a5 5 0 0010 0V4M12 16v4M9 20h6"] },
  { id: "parking", label: "停车", category: "other", box: "4 3 16 18", paths: ["M5 4h14v16H5z", "M9 16V8h3.5a2.5 2.5 0 010 5H9"] },
  { id: "hospital", label: "医院", category: "other", box: "3 3 18 18", paths: ["M4 20V8l8-4 8 4v12M4 20h16M12 9v6M9 12h6"] },
  { id: "bank", label: "银行", category: "other", box: "2 3 20 19", paths: ["M3 9l9-5 9 5M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18"] },
  { id: "cinema", label: "影院", category: "other", box: "3 5 18 14", paths: ["M4 6h16v12H4z", "M4 10h3M4 14h3M17 10h3M17 14h3"] },
  { id: "fuel", label: "加油", category: "other", box: "4 2 18 20", paths: ["M5 21V5a2 2 0 012-2h4a2 2 0 012 2v16M5 21h8M6 9h6M15 8l3 3v6a1.5 1.5 0 003 0V9l-2-2M18 11h-3"] },
  { id: "tree", label: "公园", category: "other", box: "5 2 14 20", paths: ["M12 3l4 6h-2.5l3.5 5H7l3.5-5H8z", "M12 14v7"] },
];

export const GLYPH_BY_ID = new Map(GLYPH_LIBRARY.map((glyph) => [glyph.id, glyph]));

/** 每个类别的默认图案；类别里没配时退回「定位」 */
export function defaultGlyphOf(category: string): Glyph {
  return GLYPH_LIBRARY.find((glyph) => glyph.category === category) ?? GLYPH_LIBRARY[GLYPH_LIBRARY.length - 3];
}

/**
 * icon 形如 "meal:drop:fork"。第三段是图案 id；旧数据只到第二段，
 * 就按类别取默认图案。
 */
export function resolveGlyph(icon: string | null | undefined, category: string): Glyph {
  const parts = (icon ?? "").split(":");
  const glyph = parts[2] ? GLYPH_BY_ID.get(parts[2]) : undefined;
  return glyph ?? defaultGlyphOf(category);
}

export function iconId(category: string, shapeId: string, glyphId?: string): string {
  return glyphId ? `${category}:${shapeId}:${glyphId}` : `${category}:${shapeId}`;
}

/** 新建地点用的默认图标：水滴形状 + 该类别默认图案 */
export function defaultIcon(category: string): string {
  return iconId(category, ICON_SHAPES[0].id, defaultGlyphOf(category).id);
}

/**
 * 专题图层的点图标：纯色圆片 + 白色图案（比针形轻，适合成片的 POI）。
 */
export function drawGlyphDot(color: string, glyphPaths: string[]): ImageData | null {
  const size = 32;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.translate(size / 2, size / 2);
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.save();
  ctx.scale(11 / 24, 11 / 24);
  ctx.translate(-12, -12);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of glyphPaths) ctx.stroke(new Path2D(d));
  ctx.restore();
  return ctx.getImageData(0, 0, size * scale, size * scale);
}

/**
 * 在 canvas 上画出针形图标，返回 ImageData 供 map.addImage 使用。
 *
 * 逻辑尺寸 32，按 2 倍分辨率绘制，缩放后边缘不糊。
 */
export function drawPinIcon(
  shape: IconShape,
  color: string,
  options?: { label?: string; category?: string; glyph?: string[] },
): ImageData | null {
  const size = 32;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);

  // path 是 24×24，缩到 26 再居中：四角留给序号徽标
  const inner = 26;
  const offset = (size - inner) / 2;
  ctx.translate(offset, offset);
  ctx.scale(inner / 24, inner / 24);

  const path = new Path2D(shape.d);
  if (!shape.outline) {
    ctx.fillStyle = color;
    ctx.fill(path);
  }
  ctx.lineJoin = "round";
  // 只有「描边针」这一种形状本身需要描边，其余形状不套白色外圈
  if (shape.outline) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.stroke(path);
  }

  // 图标图案：白色线稿画在针头里，类型一眼可辨。图案由图标库决定，不只按类别固定
  const glyphs = options?.glyph ?? CATEGORY_GLYPHS[options?.category ?? "other"] ?? CATEGORY_GLYPHS.other;
  ctx.save();
  ctx.translate(12, 9.6);
  ctx.scale(11 / 24, 11 / 24);
  ctx.translate(-12, -12);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of glyphs) ctx.stroke(new Path2D(d));
  ctx.restore();

  if (options?.label) {
    // 序号画进 canvas，不走 symbol 的 text-field——那条路依赖远程 glyphs。
    // 徽标放右上角，针头留给类别图案。
    ctx.beginPath();
    ctx.arc(19, 5.4, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 0.8;
    ctx.stroke();

    const text = options.label.length > 2 ? "9+" : options.label;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.font = '600 6.4px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 19, 5.7);
    ctx.restore();
  }

  return ctx.getImageData(0, 0, size * scale, size * scale);
}
