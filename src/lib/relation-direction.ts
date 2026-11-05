import type { RelationKind } from './game-content';

export interface RelationEvidence {
    /** XML enumeration ownership, never rewritten to the inferred dependency direction. */
    sourceGameId: number;
    targetGameId: number;
    relationType: RelationKind;
    rawInbound: boolean | undefined;
    /** Missing means no normalized value; a historical parser's lexical loss cannot be recovered. */
    inboundPresence: 'present' | 'missing' | 'unrecognized';
    unrecognizedValue?: string | number | null;
    origin: 'direct' | 'reverse';
    sourceGameType: string | undefined;
    targetGameType: string | undefined;
    evidenceSource: 'local-cache';
    rawNames: string[];
}
export type SemanticRole = 'base' | 'expansion' | 'unknown';
export type DirectionStatus = 'explicit' | 'derived' | 'unknown' | 'conflict';
export type DirectionBasis = 'EXPANSION_DIRECT_TRUE' | 'EXPANSION_REVERSE_TRUE'
    | 'UNVERIFIED_RELATION_SEMANTICS' | 'FALSE_SEMANTICS_UNVERIFIED'
    | 'INSUFFICIENT_EVIDENCE' | 'MUTUALLY_EXCLUSIVE_ROLES' | 'PREINTERPRETED_ROLE';
export interface DirectionResult {
    currentGameId: number;
    relatedGameId: number;
    relationType: RelationKind;
    semanticRole: SemanticRole;
    directionStatus: DirectionStatus;
    directionBasis: DirectionBasis[];
    evidence: readonly RelationEvidence[];
    usedEvidence: readonly RelationEvidence[];
    hasConflict: boolean;
}
/** Only the semantic interpreter may construct these; raw flags are not role claims. */
export interface InterpretedRoleClaim {
    semanticRole: 'base' | 'expansion';
    directionBasis: 'EXPANSION_DIRECT_TRUE' | 'EXPANSION_REVERSE_TRUE' | 'PREINTERPRETED_ROLE';
    evidence: RelationEvidence;
}
/** Independent reducer: conflicting already-interpreted roles are never hidden by precedence. */
export function combineRoleClaims(
    currentGameId: number, relatedGameId: number, relationType: RelationKind,
    evidence: readonly RelationEvidence[], claims: readonly InterpretedRoleClaim[]
): DirectionResult {
    const comparable = relationType === 'expansions' && Number.isSafeInteger(currentGameId)
        && Number.isSafeInteger(relatedGameId) && currentGameId > 0 && relatedGameId > 0 && currentGameId !== relatedGameId
        ? claims.filter(c => c.evidence.relationType === relationType && evidence.includes(c.evidence)
            && ((c.evidence.origin === 'direct' && c.evidence.sourceGameId === currentGameId && c.evidence.targetGameId === relatedGameId)
                || (c.evidence.origin === 'reverse' && c.evidence.sourceGameId === relatedGameId && c.evidence.targetGameId === currentGameId))) : [];
    const roles = new Set(comparable.map(c => c.semanticRole));
    const hasConflict = roles.size > 1;
    return {
        currentGameId, relatedGameId, relationType, evidence, usedEvidence: comparable.map(c => c.evidence), hasConflict,
        semanticRole: hasConflict || !comparable.length ? 'unknown' : comparable[0].semanticRole,
        directionStatus: hasConflict ? 'conflict' : !comparable.length ? 'unknown'
            : comparable.some(c => c.directionBasis === 'EXPANSION_DIRECT_TRUE') ? 'explicit' : 'derived',
        directionBasis: hasConflict ? ['MUTUALLY_EXCLUSIVE_ROLES']
            : [...new Set(comparable.map(c => c.directionBasis))]
    };
}

/** Conservative contract from A-1: an expansion's explicit true link identifies a boardgame base.
 * No false/omitted default, names, implementation precedence, or compilation containment rule.
 */
export function resolveRelationDirection(
    currentGameId: number, relatedGameId: number, relationType: RelationKind,
    observations: readonly RelationEvidence[], knownTypes: ReadonlyMap<number, string | undefined>
): DirectionResult {
    const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
    const evidence = observations.filter(e => validId(currentGameId) && validId(relatedGameId)
        && currentGameId !== relatedGameId && e.relationType === relationType
        && ((e.origin === 'direct' && e.sourceGameId === currentGameId && e.targetGameId === relatedGameId)
            || (e.origin === 'reverse' && e.sourceGameId === relatedGameId && e.targetGameId === currentGameId)));
    const claims: InterpretedRoleClaim[] = [];
    if (relationType === 'expansions') {
        for (const e of evidence) {
            if (e.inboundPresence !== 'present' || e.rawInbound !== true
                || knownTypes.get(e.sourceGameId) !== 'boardgameexpansion'
                || knownTypes.get(e.targetGameId) !== 'boardgame'
                || e.sourceGameType !== knownTypes.get(e.sourceGameId)
                || e.targetGameType !== knownTypes.get(e.targetGameId)) continue;
            claims.push({ semanticRole: e.origin === 'direct' ? 'base' : 'expansion',
                directionBasis: e.origin === 'direct' ? 'EXPANSION_DIRECT_TRUE' : 'EXPANSION_REVERSE_TRUE', evidence: e });
        }
    }
    const result = combineRoleClaims(currentGameId, relatedGameId, relationType, evidence, claims);
    if (!claims.length) result.directionBasis = [relationType !== 'expansions' ? 'UNVERIFIED_RELATION_SEMANTICS'
        : evidence.some(e => e.rawInbound === false) ? 'FALSE_SEMANTICS_UNVERIFIED' : 'INSUFFICIENT_EVIDENCE'];
    return result;
}
