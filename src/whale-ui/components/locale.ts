/** Component chrome follows the host document language without a second locale store. */
export const messages = {
  loadingImage: ["Finding image…", "正在查找图片…"], imageSearchFailed: ["Image search failed", "图片搜索失败"], noImages: ["No images found", "未找到图片"], imagesFailed: ["Images could not be loaded", "图片加载失败"], retry: ["Retry", "重试"],
  noChartData: ["No chart data", "暂无图表数据"], noNumericSeries: ["No numeric series", "没有数值数据系列"], noPositiveValues: ["No positive values to draw", "没有可绘制的正数"],
  chartLegendScope: ["Only shows or hides series in this chart; page filters and summaries stay unchanged.", "仅显示或隐藏图中系列，不改变页面筛选或汇总"],
  copied: ["Copied", "已复制"], copy: ["Copy", "复制"], copyFailed: ["Copy failed", "复制失败"], actionFailed: ["Action failed", "操作失败"], select: ["Select", "选择"], input: ["Input", "输入"], text: ["Text", "文本"], choices: ["Choices", "选项"], value: ["Value", "数值"], date: ["Date", "日期"],
  timer: ["Timer", "计时器"], start: ["Start", "开始"], pause: ["Pause", "暂停"], reset: ["Reset", "重置"], details: ["Details", "详情"], scrollableItems: ["Scrollable items", "可滚动项目"], table: ["Data table", "数据表"],
  video: ["YouTube video", "YouTube 视频"], invalidVideo: ["Invalid YouTube video URL or id", "YouTube 视频网址或编号无效"], front: ["Front of flashcard; reveal answer", "闪卡正面；点击显示答案"], back: ["Back of flashcard; show front", "闪卡背面；点击显示正面"], showFront: ["Tap to show front", "点击显示正面"], reveal: ["Tap to reveal", "点击显示答案"], celebration: ["Celebration", "庆祝"], congratulations: ["Congratulations!", "恭喜！"],
  streetRouteUnavailable: ["Street route unavailable", "街道路线不可用"], noRoute: ["Street route returned no path", "未找到街道路线"], mapTilesUnavailable: ["Map tiles unavailable", "地图瓦片不可用"], mapFailed: ["Map could not be loaded", "地图加载失败"], streetMap: ["Street map", "街道地图"], noLocations: ["No valid map locations", "没有有效的地图位置"], retryMap: ["Retry map", "重试地图"], loadingRoute: ["Loading street route…", "正在加载街道路线…"],
  html: ["Interactive HTML", "交互式 HTML"], drawing: ["Interactive drawing", "交互式绘图"],
} as const;
export type MessageKey = keyof typeof messages;
export function t(key: MessageKey): string {
  const chinese = typeof document !== "undefined" && /^zh\b/i.test(document.documentElement.lang);
  return messages[key][chinese ? 1 : 0];
}
