/**
 * 地图标注图标库。
 *
 * 颜色区分大类；地图直接绘制 Glyph.fill 的实心图案，不再套针形或圆底。
 * 序号和名称由 MapCanvas 的 DOM 标签展示。图案全部是本地路径，
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

// 兼容旧 icon 字符串（category:shape:glyph）里的 shape 段；地图已不再绘制这些针形。
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
  /** 线性路径：用于需要描边的旧场景 */
  paths: string[];
  /**
   * 实心路径：地图标注和图标选择器统一用这一份。
   * 24×24 坐标系，闭合形状；需要镂空的图标（钥匙孔、镜头、靶心等）
   * 通过 fillRule="evenodd" 让内部子路径变成透明孔。
   */
  fill: string[];
  fillRule?: "nonzero" | "evenodd";
}

export const GLYPH_LIBRARY: Glyph[] = [
  // 景点
  {
    id: "tower", label: "塔阁", category: "attraction", box: "0 0 24 24",
    paths: ["M7 21h10M9 21V6M15 21V6M9 6h6M12 3v3M8 12h8"],
    fill: ["M7 21h10v-2H7z", "M9 19V8h6v11z", "M10 3h4v5h-4z", "M7 10h10v1.6H7z", "M7 14h10v1.6H7z"],
  },
  {
    id: "mountain", label: "山峰", category: "attraction", box: "0 0 24 24",
    paths: ["M3 19l6-11 3 5 3-4 6 10z"],
    fill: ["M2.5 20L9 7l3.5 6.5L15 9l6.5 11z"],
  },
  {
    id: "bridge", label: "桥梁", category: "attraction", box: "0 0 24 24",
    paths: ["M3 16h18M6 16V9M18 16V9M6 9c3-4 9-4 12 0"],
    fill: ["M2 9h20v2h-2.5v9h-2.5v-6a5 5 0 00-10 0v6H4.5V11H2z"],
  },
  {
    id: "wall", label: "城墙", category: "attraction", box: "0 0 24 24",
    paths: ["M4 20V8h4V6h3v2h3V6h3v2h3v12M4 14h16"],
    fill: ["M3 20V7h3v2h3V7h3v2h3V7h3v2h2v11zM4 13h16v2H4z"],
  },
  {
    id: "temple", label: "古建", category: "attraction", box: "0 0 24 24",
    paths: ["M4 20h16M6 20v-8M18 20v-8M6 12h12M8 12V8h8v4M12 5v3"],
    fill: ["M2.5 9.5L12 4l9.5 5.5V11H2.5z", "M5 12h14v2H5z", "M4.5 20v-5h3v5z", "M16.5 15h3v5z", "M8 20v-6h2v6z", "M14 20v-6h2v6z", "M11 20v-6h2v6z"],
  },
  // 餐饮
  {
    id: "fork", label: "餐具", category: "meal", box: "0 0 24 24",
    paths: ["M7 3v6M5 3v3a2 2 0 002 2 2 2 0 002-2V3M7 11v10M16 3c-2 2-2.5 5-2.5 7h3v11"],
    fill: ["M6 2h2v7H6z", "M10 2h2v7h-2z", "M6 2h6v4a3 3 0 01-3 3 3 3 0 01-3-3z", "M10 9h2v13h-2z", "M16 2c1.3 2 1.8 5 1.8 7H15V2z", "M15 9h2.8v13H15z"],
  },
  {
    id: "noodle", label: "面食", category: "meal", box: "0 0 24 24",
    paths: ["M4 12h16a8 8 0 01-16 0z", "M8 7c0-2 1-3 2-4M12 7c0-2 1-3 2-4"],
    fill: ["M3 11h18a9 9 0 01-18 0z", "M7 20h10v1.8H7z", "M8 2c0 2-1.5 2-1.5 4S8 8 8 10h1.6C9.6 8 8.1 8 8.1 6S9.6 4 9.6 2z", "M12 2c0 2-1.5 2-1.5 4S12 8 12 10h1.6C13.6 8 12.1 8 12.1 6S13.6 4 13.6 2z", "M16 2c0 2-1.5 2-1.5 4S16 8 16 10h1.6C17.6 8 16.1 8 16.1 6S17.6 4 17.6 2z"],
  },
  {
    id: "cup", label: "杯子", category: "meal", box: "0 0 24 24",
    paths: ["M6 8h10v6a5 5 0 01-10 0z", "M16 9h2a2 2 0 010 4h-2M5 21h12"],
    fill: ["M5 7h11v6a5.5 5.5 0 01-11 0z", "M16 8h2a2.5 2.5 0 010 5h-2v-1.6h2a.9.9 0 000-1.8h-2z", "M4 20h14v1.8H4z"],
  },
  {
    id: "coffee", label: "咖啡", category: "meal", box: "0 0 24 24",
    paths: ["M5 9h11v5a5 5 0 01-11 0z", "M16 10h2a2 2 0 010 4h-2M5 21h13M7 6c0-1 1-1 1-2M11 6c0-1 1-1 1-2"],
    fill: ["M4 8h12v6a6 6 0 01-12 0z", "M16 9h2a2.5 2.5 0 010 5h-2v-1.6h2a.9.9 0 000-1.8h-2z", "M4 21h15v1.6H4z", "M8 2c0 2-1 2-1 3.5S8 7 8 8h1.5C9.5 7 8.5 7 8.5 5.5S9.5 4 9.5 2z", "M12 2c0 2-1 2-1 3.5S12 7 12 8h1.5C13.5 7 12.5 7 12.5 5.5S13.5 4 13.5 2z"],
  },
  {
    id: "bar", label: "酒吧", category: "meal", box: "0 0 24 24",
    paths: ["M6 3h12l-6 8zM12 11v7M8 21h8"],
    fill: ["M4 3h16l-7 9v7h4v2H7v-2h4v-7z"],
  },
  // 住宿
  {
    id: "bed", label: "床铺", category: "lodging", box: "0 0 24 24",
    paths: ["M3 18V9M3 14h18v4M21 14v4M7 12h3a1.5 1.5 0 011.5 1.5V14H7z"],
    fill: ["M2 9h2v9H2z", "M4 14h18v4h-2v-2H6v2H4z", "M6 10h6a3 3 0 013 3v1H6z", "M15 11h4a2 2 0 012 2v1h-6z"],
  },
  {
    id: "hotel", label: "酒店", category: "lodging", box: "0 0 24 24",
    paths: ["M5 21V5h14v16M9 9h2M13 9h2M9 13h2M13 13h2M10 21v-4h4v4"],
    fill: ["M5 21V4h14v17h-4v-5h-6v5H5z", "M9 7h2v2H9z", "M13 7h2v2h-2z", "M9 11h2v2H9z", "M13 11h2v2h-2z"],
  },
  {
    id: "key", label: "钥匙", category: "lodging", box: "0 0 24 24",
    paths: ["M10 12a4 4 0 100-8 4 4 0 000 8z", "M13 11l8 8M17 15l2-2M15 17l2-2"],
    fill: ["M9.5 3a5.5 5.5 0 014.8 8.2L22 18.9V22h-3.1v-2.2h-2.2v-2.2h-2.2l-2.5-2.5A5.5 5.5 0 119.5 3zm0 3a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"],
    fillRule: "evenodd",
  },
  {
    id: "home", label: "住宅", category: "lodging", box: "0 0 24 24",
    paths: ["M4 11l8-7 8 7v9H4z", "M10 20v-6h4v6"],
    fill: ["M12 3l9 8h-3v10h-5v-6h-2v6H6V11H3z"],
  },
  // 交通
  {
    id: "car", label: "汽车", category: "transport", box: "0 0 24 24",
    paths: ["M5 16V10h14v6M5 16h14M7 16v2M17 16v2M5 10l2-3h10l2 3M8 13h2M14 13h2"],
    fill: ["M4 11l2-4h12l2 4h1v7h-2v2h-2v-2H7v2H5v-2H4z", "M7 13h2v2H7z", "M15 13h2v2h-2z"],
    fillRule: "evenodd",
  },
  {
    id: "metro", label: "地铁", category: "transport", box: "0 0 24 24",
    paths: ["M7 4h10a2 2 0 012 2v9a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z", "M5 9h14M8 20l-2 2M16 20l2 2M8 13h2M14 13h2"],
    fill: ["M6 3h12a3 3 0 013 3v10a3 3 0 01-3 3h-1l2 2h-3l-2-2h-2l-2 2H7l2-2H6a3 3 0 01-3-3V6a3 3 0 013-3z", "M6 6v5h12V6z", "M8 14h2v2H8z", "M14 14h2v2h-2z"],
    fillRule: "evenodd",
  },
  {
    id: "plane", label: "飞机", category: "transport", box: "0 0 24 24",
    paths: ["M21 12l-7-2V5a1.5 1.5 0 00-3 0v5l-7 2v2l7-1v4l-2 2v2l3.5-1 3.5 1v-2l-2-2v-4l7 1z"],
    fill: ["M21 12l-7-2V5a1.5 1.5 0 00-3 0v5l-7 2v2l7-1v4l-2 2v2l3.5-1 3.5 1v-2l-2-2v-4l7 1z"],
  },
  {
    id: "bus", label: "公交", category: "transport", box: "0 0 24 24",
    paths: ["M5 5h14a2 2 0 012 2v8H3V7a2 2 0 012-2z", "M3 15h18v3H3zM7 18v2M17 18v2M6 9h3M15 9h3M7 12h2M15 12h2"],
    fill: ["M4 4h16a2 2 0 012 2v11H2V6a2 2 0 012-2z", "M2 17h20v3h-3v-1H5v1H2z", "M6 8h4v4H6z", "M14 8h4v4h-4z", "M7 18h2v2H7z", "M15 18h2v2h-2z"],
  },
  {
    id: "dock", label: "船运", category: "transport", box: "0 0 24 24",
    paths: ["M4 17l2-5h12l2 5M6 17c0 2 2 3 6 3s6-1 6-3M12 4v8M8 8h8"],
    fill: ["M3 16l2-5h14l2 5H3z", "M6 17c0 2.5 2.5 4 6 4s6-1.5 6-4H6z", "M11 3h2v9h-2z", "M7 7h10v2H7z"],
  },
  // 购物
  {
    id: "bag", label: "购物袋", category: "shopping", box: "0 0 24 24",
    paths: ["M5 8h14l-1.2 11a1.5 1.5 0 01-1.5 1.3H7.7A1.5 1.5 0 016.2 19z", "M9 8V6.5a3 3 0 016 0V8"],
    fill: ["M5 8h14l-1.2 11a1.5 1.5 0 01-1.5 1.3H7.7A1.5 1.5 0 016.2 19z", "M9 8V6.5a3 3 0 016 0V8h-2V6.5a1 1 0 00-2 0V8z"],
    fillRule: "evenodd",
  },
  {
    id: "cart", label: "购物车", category: "shopping", box: "0 0 24 24",
    paths: ["M3 5h2l2 10h10l2-7H6", "M9 19a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM17 19a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"],
    fill: ["M2 4h3l1 3h16l-3 8H7L5 4z", "M7 17h12v2H8a2 2 0 01-2-2z", "M9 20a1.5 1.5 0 110 3 1.5 1.5 0 010-3z", "M17 20a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"],
  },
  {
    id: "gift", label: "礼盒", category: "shopping", box: "0 0 24 24",
    paths: ["M4 9h16v4H4zM5 13h14v8H5zM12 9v12M9 9a2.5 2.5 0 010-5c2 0 3 5 3 5s1-5 3-5a2.5 2.5 0 010 5"],
    fill: ["M3 8h18v4H3z", "M4 12h16v9H4z", "M11 8h2v13h-2z", "M8 8a3 3 0 010-6c2 0 3 3 4 6H8z", "M16 8a3 3 0 000-6c-2 0-3 3-4 6h4z"],
  },
  {
    id: "basket", label: "生鲜", category: "shopping", box: "0 0 24 24",
    paths: ["M5 9h14l-1.5 9h-11z", "M8 9V6a4 4 0 018 0v3"],
    fill: ["M4 8h16l-2 12H6z", "M8 8V5a4 4 0 018 0v3h-2V5a2 2 0 00-4 0v3z"],
    fillRule: "evenodd",
  },
  // 观景
  {
    id: "eye", label: "观景", category: "viewpoint", box: "0 0 24 24",
    paths: ["M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z", "M12 9.6a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8z"],
    fill: ["M12 5C6 5 2.5 12 2.5 12S6 19 12 19s9.5-7 9.5-7S18 5 12 5zm0 3.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7zm0 2a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"],
    fillRule: "evenodd",
  },
  {
    id: "binoculars", label: "望远镜", category: "viewpoint", box: "0 0 24 24",
    paths: ["M6 20a3 3 0 100-6 3 3 0 000 6zM18 20a3 3 0 100-6 3 3 0 000 6z", "M9 17l2-9h2l2 9M8 8h3M13 8h3"],
    fill: ["M5 6h4l1 3h4l1-3h4l2 8a4 4 0 01-8 0v-3h-2v3a4 4 0 01-8 0z", "M6 15a2.5 2.5 0 100 5 2.5 2.5 0 000-5z", "M18 15a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"],
  },
  {
    id: "sunrise", label: "日出", category: "viewpoint", box: "0 0 24 24",
    paths: ["M12 4v3M5 12H2M22 12h-3M6 7l2 2M18 7l-2 2M8 16h8M4 16h2M18 16h2M7 16a5 5 0 0110 0"],
    fill: ["M2 17h20v2H2z", "M7 17a5 5 0 0110 0z", "M11 3h2v4h-2z", "M4.2 8.2l1.4-1.4 2.8 2.8-1.4 1.4z", "M18.4 6.8l1.4 1.4-2.8 2.8-1.4-1.4z"],
  },
  {
    id: "beach", label: "海滩", category: "viewpoint", box: "0 0 24 24",
    paths: ["M4 18c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5M6 13l3-6 3 3 3-4 3 7"],
    fill: ["M12 3a9 9 0 019 9H3a9 9 0 019-9z", "M11 12h2v8a2 2 0 01-4 0h2z", "M3 20c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1v2c-2 0-2-1-4-1s-2 1-4 1-2-1-4-1-2 1-4 1z"],
  },
  {
    id: "camera", label: "拍照", category: "viewpoint", box: "0 0 24 24",
    paths: ["M4 8h3l1.5-2h7L17 8h3v11H4z", "M12 16a3 3 0 100-6 3 3 0 000 6z"],
    fill: ["M3 7h4l2-3h6l2 3h4v13H3z", "M12 10a3.5 3.5 0 110 7 3.5 3.5 0 010-7z", "M12 12a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"],
    fillRule: "evenodd",
  },
  {
    id: "camp", label: "露营", category: "viewpoint", box: "0 0 24 24",
    paths: ["M12 4L3 20h18z", "M12 4v16M8 20l4-6 4 6"],
    fill: ["M12 3L2 21h20z", "M12 8l5 10h-3l-2-4-2 4H7z"],
    fillRule: "evenodd",
  },
  // 指针形状与通用标记
  {
    id: "pin", label: "定位", category: "other", box: "0 0 24 24",
    paths: ["M12 3a5 5 0 015 5c0 4-5 9-5 9s-5-5-5-9a5 5 0 015-5z", "M12 8.5a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z"],
    fill: ["M12 2a7 7 0 017 7c0 5-7 13-7 13S5 14 5 9a7 7 0 017-7zm0 4a3 3 0 100 6 3 3 0 000-6z"],
    fillRule: "evenodd",
  },
  {
    id: "star", label: "星标", category: "other", box: "0 0 24 24",
    paths: ["M12 3l2.6 5.8 6.4.7-4.8 4.3 1.4 6.2L12 17.2 6.4 20l1.4-6.2L3 9.5l6.4-.7z"],
    fill: ["M12 3l2.6 5.8 6.4.7-4.8 4.3 1.4 6.2L12 17.2 6.4 20l1.4-6.2L3 9.5l6.4-.7z"],
  },
  {
    id: "flag", label: "旗标", category: "other", box: "0 0 24 24",
    paths: ["M6 21V4M6 4h11l-2 4 2 4H6"],
    fill: ["M6 2h2v20H6z", "M8 3h11l-2 4 2 4H8z"],
  },
  {
    id: "navigation", label: "导航", category: "other", box: "0 0 24 24",
    paths: ["M3 11l18-8-8 18-2-8z"],
    fill: ["M3 11l18-8-8 18-2-8z"],
  },
  {
    id: "target", label: "靶心", category: "other", box: "0 0 24 24",
    paths: ["M12 3v3M12 18v3M3 12h3M18 12h3", "M12 8a4 4 0 100 8 4 4 0 000-8z"],
    fill: ["M12 2a10 10 0 100 20 10 10 0 000-20zm0 3a7 7 0 110 14 7 7 0 010-14zm0 3a4 4 0 100 8 4 4 0 000-8zm0 2.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"],
    fillRule: "evenodd",
  },
  {
    id: "diamond", label: "菱点", category: "other", box: "0 0 24 24",
    paths: ["M12 3l5 9-5 9-5-9z"],
    fill: ["M12 3l5 9-5 9-5-9z"],
  },
  {
    id: "dot", label: "圆点", category: "other", box: "0 0 24 24",
    paths: ["M12 4a8 8 0 100 16 8 8 0 000-16z", "M12 10.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"],
    fill: ["M12 3a9 9 0 100 18 9 9 0 000-18zm0 6a3 3 0 100 6 3 3 0 000-6z"],
    fillRule: "evenodd",
  },
  {
    id: "toilet", label: "厕所", category: "other", box: "0 0 24 24",
    paths: ["M6 4h12M7 4v7a5 5 0 0010 0V4M12 16v4M9 20h6"],
    fill: ["M7 3a2 2 0 110 4 2 2 0 010-4z", "M5.5 8h3v7H7v6H5.5v-6H4.5V8z", "M16.5 3a2 2 0 110 4 2 2 0 010-4z", "M15 8h3l2 7h-2v6h-1.5v-6h-2z"],
  },
  {
    id: "parking", label: "停车", category: "other", box: "0 0 24 24",
    paths: ["M5 4h14v16H5z", "M9 16V8h3.5a2.5 2.5 0 010 5H9"],
    fill: ["M4 3h16v18H4z", "M8 7v10h2v-3h2.5a3.5 3.5 0 000-7H8zm2 2h2.5a1.5 1.5 0 010 3H10z"],
    fillRule: "evenodd",
  },
  {
    id: "hospital", label: "医院", category: "other", box: "0 0 24 24",
    paths: ["M4 20V8l8-4 8 4v12M4 20h16M12 9v6M9 12h6"],
    fill: ["M4 21V8l8-4 8 4v13H4z", "M11 10h2v3h3v2h-3v3h-2v-3H8v-2h3z"],
    fillRule: "evenodd",
  },
  {
    id: "bank", label: "银行", category: "other", box: "0 0 24 24",
    paths: ["M3 9l9-5 9 5M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18"],
    fill: ["M2 9l10-6 10 6v2H2z", "M4 12h3v7H4z", "M10 12h3v7h-3z", "M16 12h3v7h-3z", "M2 20h20v2H2z"],
  },
  {
    id: "cinema", label: "影院", category: "other", box: "0 0 24 24",
    paths: ["M4 6h16v12H4z", "M4 10h3M4 14h3M17 10h3M17 14h3"],
    fill: ["M3 5h18v14H3z", "M6 7v2h2V7z", "M10 7v2h2V7z", "M14 7v2h2V7z", "M18 7v2h1V7z", "M6 15v2h2v-2z", "M10 15v2h2v-2z", "M14 15v2h2v-2z", "M18 15v2h1v-2z"],
    fillRule: "evenodd",
  },
  {
    id: "fuel", label: "加油", category: "other", box: "0 0 24 24",
    paths: ["M5 21V5a2 2 0 012-2h4a2 2 0 012 2v16M5 21h8M6 9h6M15 8l3 3v6a1.5 1.5 0 003 0V9l-2-2M18 11h-3"],
    fill: ["M5 3h8v18H5z", "M7 5v5h4V5z", "M14 7h2l2 2v8a2 2 0 01-4 0v-3h2v3a1 1 0 002 0v-7l-2-2z"],
  },
  {
    id: "tree", label: "公园", category: "other", box: "0 0 24 24",
    paths: ["M12 3l4 6h-2.5l3.5 5H7l3.5-5H8z", "M12 14v7"],
    fill: ["M12 2l5 8h-3l4 6H6l4-6H7z", "M11 16h2v6h-2z"],
  },
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

/** 新建地点用的默认图标 id：保留 shape 段兼容旧数据，地图实际只渲染实心图案 */
export function defaultIcon(category: string): string {
  return iconId(category, ICON_SHAPES[0].id, defaultGlyphOf(category).id);
}

/**
 * 地图标注图标：直接把图标本体画成实心色块。
 *
 * 不再套针形或圆底，避免“图标里再嵌一层图案”的观感。
 * paths 来自 Glyph.fill；fillRule="evenodd" 用来保留钥匙孔、镜头、靶心等镂空。
 * 逻辑尺寸 32，按 2 倍分辨率绘制，缩放后边缘不糊。
 */
export function drawFilledGlyph(
  color: string,
  paths: string[],
  options?: { fillRule?: "nonzero" | "evenodd"; size?: number },
): ImageData | null {
  const size = options?.size ?? 32;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);

  // 24×24 的路径缩到 26 再居中：四周留一点空间，白色细边不会被裁掉
  const inner = 26;
  const offset = (size - inner) / 2;
  ctx.translate(offset, offset);
  ctx.scale(inner / 24, inner / 24);
  ctx.lineJoin = "round";

  const pathList = paths.map((d) => new Path2D(d));
  // 先统一描白边，再统一填色：多路径图标不会出现后画的白色边压住前一块颜色
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1.2;
  for (const path of pathList) ctx.stroke(path);
  ctx.fillStyle = color;
  for (const path of pathList) ctx.fill(path, options?.fillRule ?? "nonzero");

  return ctx.getImageData(0, 0, size * scale, size * scale);
}
