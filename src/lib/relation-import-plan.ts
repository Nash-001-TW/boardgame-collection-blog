import type { BggGameData } from './bgg-types.ts';
import { relationKinds } from './game-content.ts';
import type { RelationKind } from './game-content.ts';
import type { RelationEvidence } from './relation-direction.ts';

export type PlanErrorCode = 'INVALID_ROOT_ID' | 'INVALID_LIMIT' | 'CACHE_SHAPE_INVALID' | 'ROOT_NOT_CACHED' | 'ROOT_DATA_INCOMPLETE';
export class RelationPlanError extends Error {
    constructor(public readonly code: PlanErrorCode, public readonly issues: readonly string[] = []) { super(code); }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const validBggId = (id: number): boolean => Number.isSafeInteger(id) && id > 0;

/** Structural completeness, not a freshness or non-empty-statistics assertion. */
export function cachedGameIssues(value: unknown, expectedId: number): string[] {
    if (!object(value)) return ['NOT_GAME_OBJECT'];
    const issues: string[] = [];
    if (value.bggId !== expectedId) issues.push('BGG_ID_MISMATCH');
    if (typeof value.name !== 'string' || !value.name.trim()) issues.push('NAME_MISSING');
    if (typeof value.gameType !== 'string' || !value.gameType.trim()) issues.push('GAME_TYPE_MISSING');
    if (typeof value.description !== 'string') issues.push('DESCRIPTION_FIELD_MISSING');
    for (const key of ['year', 'minPlayers', 'maxPlayers', 'minPlayTime', 'maxPlayTime']) {
        if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0) issues.push(`INVALID_${key}`);
    }
    for (const key of ['bestPlayerCounts', 'designers', 'artists', 'publishers', 'categories', 'mechanics', 'families', ...relationKinds, 'categoryRanks']) {
        if (!Array.isArray(value[key])) issues.push(`ARRAY_FIELD_MISSING_${key}`);
    }
    if (!['Unknown', 'Light', 'Medium Light', 'Medium', 'Medium Heavy', 'Heavy'].includes(String(value.complexity))) issues.push('COMPLEXITY_FIELD_INVALID');
    if (typeof value.isExpansion !== 'boolean') issues.push('EXPANSION_FLAG_MISSING');
    return issues;
}
export interface PlannedRelationTarget {
    id: number;
    names: string[];
    relationTypes: RelationKind[];
    cacheStatus: 'complete' | 'missing' | 'incomplete';
    cacheIssues: string[];
    evidence: RelationEvidence[];
}
export interface RelationAnomaly {
    code: 'INVALID_LINK' | 'INVALID_TARGET_ID' | 'SELF_REFERENCE' | 'RELATION_NAME_MISSING'
        | 'UNRECOGNIZED_INBOUND' | 'MULTIPLE_RELATION_NAMES' | 'INCOMPLETE_CACHED_TARGET';
    relationType?: RelationKind;
    recordIndex?: number;
    targetId?: number;
}

/** Discover only root-owned arrays. Never traverse target arrays or add reverse-index targets. */
export function planRelationImport(cacheInput: unknown, rootId: number, limit?: number) {
    if (!validBggId(rootId)) throw new RelationPlanError('INVALID_ROOT_ID');
    if (limit !== undefined && !validBggId(limit)) throw new RelationPlanError('INVALID_LIMIT');
    if (!object(cacheInput)) throw new RelationPlanError('CACHE_SHAPE_INVALID');
    if (!Object.hasOwn(cacheInput, String(rootId))) throw new RelationPlanError('ROOT_NOT_CACHED');
    const rootValue = cacheInput[String(rootId)];
    const issues = cachedGameIssues(rootValue, rootId);
    if (issues.length) throw new RelationPlanError('ROOT_DATA_INCOMPLETE', issues);
    const root = rootValue as unknown as BggGameData;
    const discovered = new Map<number, PlannedRelationTarget>();
    const anomalies: RelationAnomaly[] = [];
    const rawByType = { expansions: 0, implementations: 0, compilations: 0 };
    const directionAttributes = { true: 0, false: 0, missing: 0, unrecognized: 0 };
    const seenEvidence = new Map<string, RelationEvidence>();
    let validDirectRecords = 0, duplicateRelationRecords = 0, invalidRecords = 0, selfReferences = 0;
    for (const kind of relationKinds) {
        const links = root[kind] as unknown[];
        rawByType[kind] = links.length;
        links.forEach((link, recordIndex) => {
            if (!object(link)) { invalidRecords++; anomalies.push({ code: 'INVALID_LINK', relationType: kind, recordIndex }); return; }
            if (typeof link.id !== 'number' || !validBggId(link.id)) { invalidRecords++; anomalies.push({ code: 'INVALID_TARGET_ID', relationType: kind, recordIndex }); return; }
            const id = link.id;
            if (id === rootId) { selfReferences++; anomalies.push({ code: 'SELF_REFERENCE', relationType: kind, recordIndex, targetId: id }); return; }
            validDirectRecords++;
            const name = typeof link.name === 'string' ? link.name : '';
            if (!name.trim()) anomalies.push({ code: 'RELATION_NAME_MISSING', relationType: kind, recordIndex, targetId: id });
            const raw = link.inbound;
            const presence = raw === undefined ? 'missing' : typeof raw === 'boolean' ? 'present' : 'unrecognized';
            directionAttributes[raw === true ? 'true' : raw === false ? 'false' : presence === 'missing' ? 'missing' : 'unrecognized']++;
            if (presence === 'unrecognized') anomalies.push({ code: 'UNRECOGNIZED_INBOUND', relationType: kind, recordIndex, targetId: id });
            let target = discovered.get(id);
            if (!target) {
                const exists = Object.hasOwn(cacheInput, String(id));
                const cacheIssues = exists ? cachedGameIssues(cacheInput[String(id)], id) : [];
                target = { id, names: [], relationTypes: [], cacheStatus: !exists ? 'missing' : cacheIssues.length ? 'incomplete' : 'complete', cacheIssues, evidence: [] };
                discovered.set(id, target);
                if (target.cacheStatus === 'incomplete') anomalies.push({ code: 'INCOMPLETE_CACHED_TARGET', targetId: id });
            }
            if (name && !target.names.includes(name)) target.names.push(name);
            if (!target.relationTypes.includes(kind)) target.relationTypes.push(kind);
            const unrecognizedValue = presence === 'unrecognized' && (raw === null || typeof raw === 'string' || typeof raw === 'number') ? raw : undefined;
            const key = JSON.stringify([kind, id, presence, raw === true ? true : raw === false ? false : null,
                presence === 'unrecognized' ? [typeof raw, unrecognizedValue] : null]);
            const duplicate = seenEvidence.get(key);
            if (duplicate) {
                duplicateRelationRecords++;
                if (!duplicate.rawNames.includes(name)) duplicate.rawNames.push(name);
                return;
            }
            const cachedTarget = cacheInput[String(id)];
            const evidence: RelationEvidence = { sourceGameId: rootId, targetGameId: id, relationType: kind,
                rawInbound: typeof raw === 'boolean' ? raw : undefined, inboundPresence: presence, unrecognizedValue,
                origin: 'direct', sourceGameType: root.gameType,
                targetGameType: object(cachedTarget) && typeof cachedTarget.gameType === 'string' ? cachedTarget.gameType : undefined,
                evidenceSource: 'local-cache', rawNames: [name] };
            seenEvidence.set(key, evidence);
            target.evidence.push(evidence);
        });
    }
    const targets = [...discovered.values()].sort((a, b) => a.id - b.id);
    for (const target of targets) if (target.names.length > 1) anomalies.push({ code: 'MULTIPLE_RELATION_NAMES', targetId: target.id });
    const pendingIds = targets.filter(target => target.cacheStatus !== 'complete').map(target => target.id);
    const plannedIds = pendingIds.slice(0, limit ?? pendingIds.length);
    return {
        mode: 'dry-run' as const, depth: 1 as const, root: { id: rootId, name: root.name, gameType: root.gameType },
        classificationBasis: 'normalized-game-structure-not-freshness' as const,
        ordering: 'ascending-bgg-id' as const, limit: limit ?? null,
        stats: { directRelationRecords: Object.values(rawByType).reduce((n, count) => n + count, 0), validDirectRecords,
            uniqueTargets: targets.length, alreadyCached: targets.filter(t => t.cacheStatus === 'complete').length,
            missingCache: targets.filter(t => t.cacheStatus === 'missing').length,
            incompleteCache: targets.filter(t => t.cacheStatus === 'incomplete').length,
            pendingImport: pendingIds.length, plannedCount: plannedIds.length, deferredCount: pendingIds.length - plannedIds.length,
            duplicateRelationRecords, repeatedTargetReferences: validDirectRecords - targets.length,
            multiTypeTargets: targets.filter(t => t.relationTypes.length > 1).length, invalidRecords, selfReferences },
        relations: { rawByType, uniqueTargetsByType: Object.fromEntries(relationKinds.map(kind => [kind, targets.filter(t => t.relationTypes.includes(kind)).length])), directionAttributes },
        pendingIds, plannedIds, deferredIds: pendingIds.slice(plannedIds.length), anomalies, targets,
        notices: targets.length ? [] : ['NO_DIRECT_RELATION_TARGETS']
    };
}
export type RelationImportPlan = ReturnType<typeof planRelationImport>;
/** Terminal report omits bulky evidence, which remains available on the plan's target model. */
export function dryRunReport(plan: RelationImportPlan) {
    const { targets, ...report } = plan;
    return { ...report, incompleteTargets: targets.filter(t => t.cacheStatus === 'incomplete').map(t => ({ id: t.id, issues: t.cacheIssues })),
        effects: { apiRequests: 0, gameDownloads: 0, cacheWrites: 0, collectionWrites: 0, databaseOperations: 0 } };
}
