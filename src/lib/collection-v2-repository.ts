
// ============================================================
// D1 V2 原始收藏資料
// ============================================================

export interface CollectionV2Row {
    id: number;
    game_id: number | null;
    display_name: string;
    item_type: string;
    acquisition_status: string;
    wishlist: number;
    notes: string | null;
    created_at: string;
    updated_at: string;
    record_scope: string;

    // LEFT JOIN v2_games
    bgg_id: number | null;
    primary_name: string | null;
    game_type: string | null;
    standalone_status: string | null;
    catalog_source: string | null;
}

// ============================================================
// Repository
// ============================================================

export class CollectionV2Repository {
    constructor(private readonly db: D1Database) {}

    /**
     * 讀取所有正式收藏紀錄。
     *
     * 使用 LEFT JOIN：
     * 即使 collection_item 沒有 game_id，
     * 也不會遺失收藏紀錄。
     */
    async getProductionItems(): Promise<CollectionV2Row[]> {
        const result = await this.db
            .prepare(`
                SELECT
                    ci.id,
                    ci.game_id,
                    ci.display_name,
                    ci.item_type,
                    ci.acquisition_status,
                    ci.wishlist,
                    ci.notes,
                    ci.created_at,
                    ci.updated_at,
                    ci.record_scope,

                    g.bgg_id,
                    g.primary_name,
                    g.game_type,
                    g.standalone_status,
                    g.catalog_source

                FROM v2_collection_items AS ci

                LEFT JOIN v2_games AS g
                    ON g.id = ci.game_id

                WHERE ci.record_scope = ?

                ORDER BY ci.id ASC
            `)
            .bind("production")
            .all<CollectionV2Row>();

        if (!result.success) {
            throw new Error(
                "D1 V2 collection query failed"
            );
        }

        return result.results ?? [];
    }

    /**
     * 依收藏 ID 讀取單筆正式收藏。
     */
    async getProductionItemById(
        collectionId: number
    ): Promise<CollectionV2Row | null> {
        if (!Number.isSafeInteger(collectionId) || collectionId <= 0) {
            return null;
        }

        return this.db
            .prepare(`
                SELECT
                    ci.id,
                    ci.game_id,
                    ci.display_name,
                    ci.item_type,
                    ci.acquisition_status,
                    ci.wishlist,
                    ci.notes,
                    ci.created_at,
                    ci.updated_at,
                    ci.record_scope,

                    g.bgg_id,
                    g.primary_name,
                    g.game_type,
                    g.standalone_status,
                    g.catalog_source

                FROM v2_collection_items AS ci

                LEFT JOIN v2_games AS g
                    ON g.id = ci.game_id

                WHERE ci.id = ?
                  AND ci.record_scope = ?

                LIMIT 1
            `)
            .bind(collectionId, "production")
            .first<CollectionV2Row>();
    }

    /**
     * 統計正式收藏紀錄總數。
     */
    async countProductionItems(): Promise<number> {
        const result = await this.db
            .prepare(`
                SELECT COUNT(*) AS total
                FROM v2_collection_items
                WHERE record_scope = ?
            `)
            .bind("production")
            .first<{ total: number }>();

        return result?.total ?? 0;
    }
}
