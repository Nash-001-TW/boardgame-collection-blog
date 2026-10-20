import sleeveData from "../data/game-sleeves.json";

export interface SleeveCardType {
    width: number;
    height: number;
    count: number;
}

export interface SleeveCardSet {
    name: string;
    version: string;
    cardTypes: SleeveCardType[];
}

export interface GameSleeveInfo {
    source: string;
    sourceUrl: string;
    cardSets: SleeveCardSet[];
}

const sleeves = sleeveData as Record<string, GameSleeveInfo>;

export function getGameSleeves(bggId: number | string): GameSleeveInfo | undefined {
    return sleeves[String(bggId)];
}

export function getSleevePackCount(cardCount: number, packSize: number): number {
    if (!Number.isFinite(cardCount) || cardCount < 0 ||
        !Number.isInteger(packSize) || packSize <= 0) {
        throw new Error("Invalid card count or pack size");
    }
    return Math.ceil(cardCount / packSize);
}
