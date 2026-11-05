import type { RelationKind } from './game-content';
import { relationKinds } from './game-content';
import type { DetailRelation, DetailDirectionResult } from './detail-relations';

type Language = 'en' | 'zh-TW';
/** Presentation only: consumes A-2 results, never interprets raw inbound or gameType. */
export function relationDisplayLabel(kind: RelationKind, result: DetailDirectionResult | undefined, lang: Language): string {
    const zh = lang === 'zh-TW';
    if (kind === 'implementations') return zh ? '版本關聯' : 'Version relation';
    if (kind === 'compilations') return zh ? '合集關聯' : 'Compilation relation';
    const confirmed = result && result.relationType === kind && !result.hasConflict
        && (result.directionStatus === 'explicit' || result.directionStatus === 'derived');
    if (confirmed && result.semanticRole === 'base') return zh ? '本體' : 'Base game';
    if (confirmed && result.semanticRole === 'expansion') return zh ? '擴充' : 'Expansion';
    return zh ? '本體／擴充關聯' : 'Base / expansion relation';
}
export function relationFilterLabels(lang: Language) {
    return lang === 'zh-TW'
        ? { all: '全部', expansions: '本體／擴充', implementations: '版本關聯', compilations: '合集關聯' }
        : { all: 'All', expansions: 'Base / expansions', implementations: 'Version relations', compilations: 'Compilation relations' };
}
export interface RelationDisplayItem {
    id: number;
    name: string;
    href: string;
    internal: boolean;
    image: string;
    kinds: RelationKind[];
    roleLabels: string[];
}
/** Whitelist consumer fields. Evidence stays in the model, not in the public UI payload. */
export function relationDisplayItems(rows: readonly DetailRelation[], lang: Language): RelationDisplayItem[] {
    return rows.map(row => {
        const kinds = relationKinds.filter(kind => row.kinds.includes(kind));
        return { id: row.id, name: row.name, href: row.href, internal: row.internal, image: row.image, kinds,
            roleLabels: kinds.map(kind => relationDisplayLabel(kind, row.directions[kind], lang)) };
    });
}
