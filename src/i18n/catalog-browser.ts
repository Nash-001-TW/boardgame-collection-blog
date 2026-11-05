// UI labels live here; mechanic translations remain in bgg-zh-TW via translateBggMechanic.
export const catalogAdvancedLabels = {
    "zh-TW": { title: "進階篩選", clear: "清除篩選" },
    en: { title: "Advanced filters", clear: "Clear filters" }
} as const;

export function formatAdvancedFilterCount(count: number, lang: "zh-TW" | "en"): string {
    if (count === 0) return "";
    return lang === "zh-TW" ? `${count} 項條件` : `${count} ${count === 1 ? "filter" : "filters"}`;
}

export const catalogFilters = [
    ["base", "基本", "Base"], ["expansion", "擴充", "Expansions"],
    ["accessory", "配件", "Accessories"], ["unknown", "未知類型", "Unknown"], ["all", "全部", "All"]
] as const;
export const catalogSorts = [
    ["name-asc", "名稱 A → Z", "Name A → Z"], ["name-desc", "名稱 Z → A", "Name Z → A"],
    ["year-desc", "年份：新到舊", "Year: Newest"], ["year-asc", "年份：舊到新", "Year: Oldest"],
    ["bgg-rating-desc", "BGG 評分：高到低", "BGG Rating: High to Low"], ["weight-desc", "複雜度：高到低", "Complexity: High to Low"]
] as const;
export const catalogTimes = [
    ["", "不限", "Any"], ["30", "30 分鐘以內", "Up to 30 min"],
    ["31-60", "31–60 分鐘", "31–60 min"], ["61-120", "61–120 分鐘", "61–120 min"],
    ["over120", "超過 120 分鐘", "Over 120 min"]
] as const;
