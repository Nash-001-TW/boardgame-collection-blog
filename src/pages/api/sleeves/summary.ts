
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const db = env.DB;

    if (!db) {
      return Response.json(
        { success: false, error: 'D1 binding DB not available' },
        { status: 503 }
      );
    }


    // V2 正式收藏項目
    // 排除 record_scope = 'test' 的測試資料
    // 相容 Migration 0012 的 owned 歷史欄位
    const importedItems = `
      SELECT
        id,
        CASE
          WHEN json_valid(notes) = 1 THEN
            CASE
              WHEN json_type(notes, '$.owned') IS NOT NULL
              THEN CAST(json_extract(notes, '$.owned') AS INTEGER)
              WHEN acquisition_status = 'owned' THEN 1
              ELSE 0
            END
          WHEN acquisition_status = 'owned' THEN 1
          ELSE 0
        END AS owned
      FROM v2_collection_items
      WHERE record_scope = 'production'
    `;


    // --------------------------------------------------
    // 1. 全部匯入資料的基本統計
    // --------------------------------------------------
    const summary = await db.prepare(`
      WITH imported AS (
        ${importedItems}
      )
      SELECT
        (SELECT COUNT(*)
         FROM v2_sleeve_sizes) AS size_count,

        (SELECT COUNT(*)
         FROM v2_sleeve_requirements r
         JOIN imported c ON c.id = r.collection_item_id
        ) AS requirement_count,

        (SELECT COALESCE(SUM(r.quantity_sheets), 0)
         FROM v2_sleeve_requirements r
         JOIN imported c ON c.id = r.collection_item_id
        ) AS total_sheets,

        (SELECT COUNT(*)
         FROM imported) AS collection_count,

        (SELECT COUNT(*)
         FROM imported
         WHERE owned = 1) AS owned_collection_count,

        (SELECT COALESCE(SUM(r.quantity_sheets), 0)
         FROM v2_sleeve_requirements r
         JOIN imported c ON c.id = r.collection_item_id
         WHERE c.owned = 1
        ) AS owned_total_sheets
    `).first();

    // --------------------------------------------------
    // 2. 依標準牌套尺寸統計
    // --------------------------------------------------
    const sizes = await db.prepare(`
      WITH imported AS (
        ${importedItems}
      )
      SELECT
        s.id AS size_id,
        s.width_tenth_mm / 10.0 AS width_mm,
        s.height_tenth_mm / 10.0 AS height_mm,

        COUNT(r.id) AS requirement_count,

        COALESCE(SUM(r.quantity_sheets), 0)
          AS total_sheets,

        COALESCE(SUM(
          CASE
            WHEN c.owned = 1
            THEN r.quantity_sheets
            ELSE 0
          END
        ), 0) AS owned_sheets

      FROM v2_sleeve_sizes s

      LEFT JOIN v2_sleeve_requirements r
        ON r.size_id = s.id
        AND r.collection_item_id IN (
          SELECT id FROM imported
        )

      LEFT JOIN imported c
        ON c.id = r.collection_item_id

      GROUP BY
        s.id,
        s.width_tenth_mm,
        s.height_tenth_mm

      ORDER BY
        s.width_tenth_mm ASC,
        s.height_tenth_mm ASC
    `).all();

    return Response.json({
      success: true,
      data: {
        summary,
        sizes: sizes.results
      }
    });

  } catch (error) {
    console.error('Sleeve summary V2 error:', error);

    return Response.json(
      {
        success: false,
        error: 'Failed to load sleeve summary'
      },
      { status: 500 }
    );
  }
};
