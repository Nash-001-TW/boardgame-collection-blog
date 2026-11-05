import type { RelationEvidence } from "./relation-direction";
import type { BggGameData, BggRelationLink } from "./bgg-types";
import type { Game } from "./game-catalog";

export type CatalogGameType = "base" | "expansion" | "accessory" | "unknown";
export function getCatalogGameType(gameType: string | null | undefined): CatalogGameType {
    switch (gameType) {
        case "boardgame": return "base";
        case "boardgameexpansion": return "expansion";
        case "boardgameaccessory": return "accessory";
        default: return "unknown";
    }
}
export const catalogTypeLabels = {
    base: ["基本遊戲", "Base Game"], expansion: ["擴充", "Expansion"],
    accessory: ["配件", "Accessory"], unknown: ["未知類型", "Unknown Type"]
} as const;

export interface GameSignal {
    kind: "promo-family" | "crowdfunding-family" | "promo-name" | "stretch-goals-name";
    source: "family" | "name";
    value: string;
}
/** Evidence hints only. Never infer exclusivity, price or pledge entitlement. */
export function getGameSignals(game: BggGameData | null): GameSignal[] {
    if (!game) return [];
    const signals: GameSignal[] = [];
    const seen = new Set<string>();
    for (const family of game.families ?? []) {
        const name = family.name?.trim();
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        if (/^Promotional:\s*\S/i.test(name)) signals.push({ kind: "promo-family", source: "family", value: name });
        if (/^Crowdfunding:\s*(Kickstarter|Gamefound)$/i.test(name))
            signals.push({ kind: "crowdfunding-family", source: "family", value: name });
    }
    if (/\bpromos?\b/i.test(game.name)) signals.push({ kind: "promo-name", source: "name", value: "Promo" });
    if (/\bstretch\s+goals?\b/i.test(game.name)) signals.push({ kind: "stretch-goals-name", source: "name", value: "Stretch Goals" });
    return signals;
}

export const relationKinds = ["expansions", "implementations", "compilations"] as const;
export type RelationKind = typeof relationKinds[number];
const rawKinds = { expansions: "boardgameexpansion", implementations: "boardgameimplementation", compilations: "boardgamecompilation" } as const;
export interface GameRelation {
    kind: RelationKind;
    rawType: string;
    targetId: number;
    name: string;
    href: string;
    internal: boolean;
    targetType: CatalogGameType;
    source: "direct" | "reverse-index";
    originId: number;
    originalTargetId: number;
    /** Raw direction belongs to originId -> originalTargetId, even for reverse indexes. */
    inbound: boolean | undefined;
    evidence: RelationEvidence;
}

export interface RelationIndex {
    targets: Map<number, Game>;
    incoming: Map<number, { origin: Game; kind: RelationKind; link: BggRelationLink }[]>;
}
/** Explicit per-processing index; no stale global cache of mutable catalog fixtures. */
export function createRelationIndex(catalog: Game[]): RelationIndex {
    const targets = new Map(catalog.map(game => [game.bggId, game]));
    const incoming: RelationIndex['incoming'] = new Map();
    for (const origin of catalog) {
        for (const kind of relationKinds) {
            for (const link of origin.bgg?.[kind] ?? []) {
                if (!link || !Number.isSafeInteger(link.id) || link.id <= 0) continue;
                const records = incoming.get(link.id) ?? [];
                records.push({ origin, kind, link });
                incoming.set(link.id, records);
            }
        }
    }
    return { targets, incoming };
}

/** Flat source observations remain compatible; a caller's UI must group by target ID.
 * Direct and reverse observations coexist, even when one has no direction value.
 */
export function getGameRelations(
    current: Game, catalog: Game[], lang: "zh-TW" | "en", index = createRelationIndex(catalog)
): GameRelation[] {
    const result: GameRelation[] = [];
    const seen = new Map<string, GameRelation>();
    const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
    function append(kind: RelationKind, origin: Game, link: BggRelationLink, reverse: boolean) {
        if (!link || !validId(link.id) || !validId(origin.bggId) || !validId(current.bggId)) return;
        const targetId = reverse ? origin.bggId : link.id;
        if (targetId === current.bggId) return;
        const raw = (link as { inbound?: unknown }).inbound;
        const inbound = typeof raw === "boolean" ? raw : undefined;
        const presence = raw === undefined ? "missing" : typeof raw === "boolean" ? "present" : "unrecognized";
        const unrecognizedValue = presence === "unrecognized" && (raw === null || typeof raw === "string" || typeof raw === "number") ? raw : undefined;
        const key = JSON.stringify([current.bggId, targetId, kind, origin.bggId, link.id, presence, inbound,
            presence === "unrecognized" ? [typeof raw, unrecognizedValue] : null]);
        const previous = seen.get(key);
        if (previous) {
            if (!previous.evidence.rawNames.includes(link.name)) previous.evidence.rawNames.push(link.name);
            return;
        }
        const target = index.targets.get(targetId);
        const originalTarget = link.id === current.bggId ? current : index.targets.get(link.id);
        const evidence: RelationEvidence = {
            sourceGameId: origin.bggId, targetGameId: link.id, relationType: kind,
            rawInbound: inbound, inboundPresence: presence, unrecognizedValue,
            origin: reverse ? "reverse" : "direct", sourceGameType: origin.bgg?.gameType,
            targetGameType: originalTarget?.bgg?.gameType, evidenceSource: "local-cache", rawNames: [link.name]
        };
        const internal = Boolean(target?.bgg && target.slug);
        const relation: GameRelation = { kind, rawType: rawKinds[kind], targetId,
            name: target?.name?.trim() || (reverse ? origin.name : link.name)?.trim() || `BGG #${targetId}`,
            href: internal ? `${lang === "en" ? "/en" : ""}/games/${encodeURIComponent(target!.slug)}`
                : `https://boardgamegeek.com/boardgame/${targetId}`,
            internal, targetType: getCatalogGameType(target?.bgg?.gameType),
            source: reverse ? "reverse-index" : "direct", originId: origin.bggId,
            originalTargetId: link.id, inbound, evidence };
        seen.set(key, relation);
        result.push(relation);
    }
    // Retain existing direct order; append peer evidence without duplicating UI targets.
    for (const kind of relationKinds) {
        for (const link of current.bgg?.[kind] ?? []) append(kind, current, link, false);
    }
    for (const { origin, kind, link } of index.incoming.get(current.bggId) ?? []) {
        if (origin.bggId !== current.bggId) append(kind, origin, link, true);
    }
    return result;
}
