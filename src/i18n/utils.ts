import {
    ui,
    defaultLanguage
} from "./ui.ts";

import type {
    Language
} from "./ui.ts";

import {
    bggCategoryZhTW,
    bggMechanicZhTW
} from "./bgg-zh-TW.ts";

import type {
    BggLink
} from "../lib/bgg-types.ts";

import {
    gameZhTW
} from "./game-localization.ts";


// ============================================================
// UI Translation
// ============================================================

export function useTranslations(
    lang: Language
) {
    return function t(
        key: keyof typeof ui[typeof defaultLanguage]
    ): string {
        return (
            ui[lang][key] ??
            ui[defaultLanguage][key] ??
            key
        );
    };
}


// ============================================================
// BGG Category Translation
// ============================================================

export function translateBggCategory(
    category: BggLink,
    lang: Language
): string {

    // 英文頁面直接使用 BGG 原始名稱
    if (lang === "en") {
        return category.name;
    }

    // 中文頁面優先使用中文翻譯
    return (
        bggCategoryZhTW[category.id]?.zhTW ??
        category.name
    );
}


// ============================================================
// BGG Mechanic Translation
// ============================================================

export function translateBggMechanic(
    mechanic: BggLink,
    lang: Language
): string {

    // 英文頁面直接使用 BGG 原始名稱
    if (lang === "en") {
        return mechanic.name;
    }

    // 中文頁面優先使用中文翻譯
    return (
        bggMechanicZhTW[mechanic.id]?.zhTW ??
        mechanic.name
    );
}

// ============================================================
// BGG Complexity Translation
// ============================================================

export function translateBggComplexity(
    complexity: string,
    lang: Language
): string {

    // 英文頁面直接顯示原始值
    if (lang === "en") {
        return complexity;
    }

    switch (complexity) {

        case "Light":
            return "輕度";

        case "Medium Light":
            return "中輕度";

        case "Medium":
            return "中度";

        case "Medium Heavy":
            return "中重度";

        case "Heavy":
            return "重度";

        case "Unknown":
        default:
            return "未知";
    }
}

// ============================================================
// Game Name Translation
// ============================================================

export function translateGameName(
    bggId: number,
    originalName: string,
    lang: Language
): string {

    // 英文頁面永遠使用 BGG 原始名稱
    if (lang === "en") {
        return originalName;
    }

    // 中文頁面優先使用我們自己的中文名稱
    return (
        gameZhTW[bggId]?.name ??
        originalName
    );
}


// ============================================================
// Game Description Translation
// ============================================================

export function translateGameDescription(
    bggId: number,
    originalDescription: string,
    lang: Language
): string {

    // 英文頁面使用 BGG 原始介紹
    if (lang === "en") {
        return originalDescription;
    }

    // 有中文介紹就顯示中文，
    // 沒有就退回 BGG 英文介紹
    return (
        gameZhTW[bggId]?.description ??
        originalDescription
    );
}