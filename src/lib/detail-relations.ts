import type { Game } from './game-catalog';
import { createRelationIndex, getGameRelations } from './game-content';
import type { RelationKind } from './game-content';
import { decodeGameName } from './game-name';
import { resolveRelationDirection } from './relation-direction';
import type { DirectionResult, RelationEvidence } from './relation-direction';

/** Evidence lives once per target. Per-kind results refer to it by stable row-local indexes. */
export type DetailDirectionResult = Omit<DirectionResult, 'evidence' | 'usedEvidence'> & {
    evidenceIndexes: number[];
    usedEvidenceIndexes: number[];
};
export interface DetailRelation {
    id: number;
    name: string;
    href: string;
    internal: boolean;
    image: string;
    kinds: RelationKind[];
    sources: string[];
    evidence: RelationEvidence[];
    directions: Partial<Record<RelationKind, DetailDirectionResult>>;
}
export function detailRelations(game: Game, catalog: Game[], lang: 'en' | 'zh-TW'): DetailRelation[] {
    const index = createRelationIndex(catalog);
    const knownTypes = new Map([...index.targets].map(([id, g]) => [id, g.bgg?.gameType]));
    knownTypes.set(game.bggId, game.bgg?.gameType);
    const grouped = new Map<number, DetailRelation>();
    const logicalGroups = new Map<string, { row: DetailRelation; kind: RelationKind; evidence: RelationEvidence[]; indexes: number[] }>();
    for (const r of getGameRelations(game, catalog, lang, index)) {
        let row = grouped.get(r.targetId);
        if (!row) {
            row = { id: r.targetId, name: decodeGameName(r.name), href: r.href, internal: r.internal,
                image: index.targets.get(r.targetId)?.bgg?.thumbnail || '', kinds: [], sources: [], evidence: [], directions: {} };
            grouped.set(r.targetId, row);
        }
        if (!row.kinds.includes(r.kind)) row.kinds.push(r.kind);
        row.sources.push(`${r.rawType} · inbound=${r.inbound === undefined ? 'UNKNOWN' : r.inbound} · ${r.source} · BGG ${r.originId} → ${r.originalTargetId}`);
        const evidenceIndex = row.evidence.push(r.evidence) - 1;
        const key = `${game.bggId}:${r.targetId}:${r.kind}`;
        let group = logicalGroups.get(key);
        if (!group) { group = { row, kind: r.kind, evidence: [], indexes: [] }; logicalGroups.set(key, group); }
        group.evidence.push(r.evidence);
        group.indexes.push(evidenceIndex);
    }
    for (const group of logicalGroups.values()) {
        const result = resolveRelationDirection(game.bggId, group.row.id, group.kind, group.evidence, knownTypes);
        const indexes = new Map(group.evidence.map((e, i) => [e, group.indexes[i]]));
        const { evidence, usedEvidence, ...summary } = result;
        group.row.directions[group.kind] = { ...summary,
            evidenceIndexes: evidence.map(e => indexes.get(e)!), usedEvidenceIndexes: usedEvidence.map(e => indexes.get(e)!) };
    }
    return [...grouped.values()];
}
