import type { GameRef, NotBggId } from './game-identity';

export const notBggGameTypes = ['boardgame', 'boardgameexpansion', 'boardgameaccessory'] as const;
export type NotBggGameType = typeof notBggGameTypes[number];
export const accessoryCategories = ['upgrade', 'playmat', 'storage', 'promo', 'sleeves', 'miniatures', 'tokens', 'other'] as const;
export type AccessoryCategory = typeof accessoryCategories[number];
export type NotBggLinkStatus = 'unlinked' | 'pending' | 'linked';

/** Canonical editable data. Unknown numbers are null; empty lists mean no recorded entries. */
export interface NotBggEditableFields {
    name: string;
    type: NotBggGameType;
    alternateNames: string[];
    description: string | null;
    yearPublished: number | null;
    minAge: number | null;
    minPlayers: number | null;
    maxPlayers: number | null;
    minPlaytime: number | null;
    maxPlaytime: number | null;
    /** Editor recommendations, never BGG community best-player votes. */
    recommendedPlayers: number[] | null;
    designers: string[];
    artists: string[];
    publishers: string[];
    categories: string[];
    mechanics: string[];
    families: string[];
    imageUrl: string | null;
    thumbnailUrl: string | null;
    referenceUrls: string[];
    editorNotes: string | null;
    accessoryCategories: AccessoryCategory[];
    relatedGameIds: GameRef[];
    contents: string | null;
}

export type CreateNotBggGameInput = Pick<NotBggEditableFields, 'name' | 'type'> &
    Partial<Omit<NotBggEditableFields, 'name' | 'type'>>;
/** Expected revision belongs in a separate write precondition, not editable fields. */
export type UpdateNotBggGameInput = Partial<NotBggEditableFields>;

export interface NotBggGame extends NotBggEditableFields {
    readonly gameId: number; // Existing v2_games.id; not the NotBGG sequence.
    readonly notBggId: NotBggId;
    readonly source: 'notbgg'; // Provenance does not change after BGG linking.
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly revision: number;
    readonly archivedAt: string | null;
    readonly linkStatus: NotBggLinkStatus;
    /** Active confirmed target only; pending candidates live in link records. */
    readonly linkedBggId: number | null;
    readonly linkedAt: string | null;
    readonly primarySource: 'notbgg' | 'bgg';
}

/** Independent of BggRelationLink/inbound and A-2/A-3. D5 supports dedicated and compatible accessory edges. */
export interface ManualGameRelation {
    readonly id: number;
    readonly source: 'manual';
    readonly relationType: 'accessory_for' | 'compatible_with';
    readonly from: GameRef;
    readonly to: GameRef;
    readonly notes: string | null;
    readonly createdAt: string;
    readonly createdBy: string;
    readonly archivedAt: string | null;
}
