import { CollectionV2Writer } from "./collection-v2-management";

// ============================================================
// D1 V2 原始收藏資料
// ============================================================

export interface CollectionV2Row {
    identity_seq?:number|null;
    identity_bgg_id?:number|null;
    identity_primary?:'notbgg'|'bgg'|null;
    identity_name?:string|null;
    identity_image?:string|null;
    notbgg_seq?: number|null;
    notbgg_archived_at?: string|null;
    notbgg_image?: string|null;
    notbgg_linked?: number;
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
    readonly management:CollectionV2Writer;
    constructor(private readonly db: D1Database) {this.management=new CollectionV2Writer(db);}

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
                    n.seq AS notbgg_seq,n.archived_at AS notbgg_archived_at,COALESCE(n.thumbnail_url,n.image_url) AS notbgg_image,
                    EXISTS(SELECT 1 FROM notbgg_bgg_links l WHERE l.seq=n.seq AND l.status='linked') AS notbgg_linked,
                    resolved.seq AS identity_seq,il.candidate_bgg_id AS identity_bgg_id,il.primary_source AS identity_primary,
                    resolved.name AS identity_name,COALESCE(resolved.thumbnail_url,resolved.image_url) AS identity_image,
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
                LEFT JOIN notbgg_games n ON n.game_id=g.id
                LEFT JOIN notbgg_bgg_links il ON il.status='linked' AND (il.seq=n.seq OR il.bgg_game_id=g.id)
                LEFT JOIN notbgg_games resolved ON resolved.seq=il.seq AND resolved.archived_at IS NULL
                LEFT JOIN v2_collection_management m ON m.collection_item_id=ci.id

                WHERE m.archived_at IS NULL AND ci.record_scope = ?

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
                    n.seq AS notbgg_seq,n.archived_at AS notbgg_archived_at,COALESCE(n.thumbnail_url,n.image_url) AS notbgg_image,
                    EXISTS(SELECT 1 FROM notbgg_bgg_links l WHERE l.seq=n.seq AND l.status='linked') AS notbgg_linked,
                    resolved.seq AS identity_seq,il.candidate_bgg_id AS identity_bgg_id,il.primary_source AS identity_primary,
                    resolved.name AS identity_name,COALESCE(resolved.thumbnail_url,resolved.image_url) AS identity_image,
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
                LEFT JOIN notbgg_games n ON n.game_id=g.id
                LEFT JOIN notbgg_bgg_links il ON il.status='linked' AND (il.seq=n.seq OR il.bgg_game_id=g.id)
                LEFT JOIN notbgg_games resolved ON resolved.seq=il.seq AND resolved.archived_at IS NULL
                LEFT JOIN v2_collection_management m ON m.collection_item_id=ci.id

                WHERE m.archived_at IS NULL AND ci.id = ?
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
                WHERE record_scope = ? AND NOT EXISTS (SELECT 1 FROM v2_collection_management m WHERE m.collection_item_id=v2_collection_items.id AND m.archived_at IS NOT NULL)
            `)
            .bind("production")
            .first<{ total: number }>();

        return result?.total ?? 0;
    }
}
