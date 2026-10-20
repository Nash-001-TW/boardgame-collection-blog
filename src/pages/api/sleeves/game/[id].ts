
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  try {
    const db = env.DB;

    if (!db) {
      return Response.json(
        { success: false, error: 'D1 binding DB not available' },
        { status: 503 }
      );
    }

    const rawId = params.id ?? '';

    // 僅允許正整數 ID
    if (
      !/^[1-9]\d*$/.test(rawId) ||
      !Number.isSafeInteger(Number(rawId))
    ) {
      return Response.json(
        { success: false, error: 'Invalid game ID' },
        { status: 400 }
      );
    }

    const id = Number(rawId);

    // --------------------------------------------------
    // 1. 讀取 V2 收藏項目及 BGG 遊戲資訊
    // --------------------------------------------------
    const game = await db.prepare(`
      SELECT
        c.id,
        c.display_name,
        g.bgg_id,

        CASE
          WHEN json_valid(c.notes) = 1
               AND json_type(c.notes, '$.owned') IS NOT NULL
          THEN CAST(json_extract(c.notes, '$.owned') AS INTEGER)
          WHEN c.acquisition_status = 'owned' THEN 1
          ELSE 0
        END AS owned

      FROM v2_collection_items c

      LEFT JOIN v2_games g
        ON g.id = c.game_id

      WHERE c.id = ?
        AND c.record_scope = 'production'
    `).bind(id).first();

    if (!game) {
      return Response.json(
        { success: false, error: 'Game not found' },
        { status: 404 }
      );
    }

    // --------------------------------------------------
    // 2. 依牌套尺寸彙總需求
    // --------------------------------------------------
    const result = await db.prepare(`
      SELECT
        s.id AS size_id,
        s.width_tenth_mm / 10.0 AS width_mm,
        s.height_tenth_mm / 10.0 AS height_mm,

        COUNT(r.id) AS requirement_count,
        COALESCE(SUM(r.quantity_sheets), 0) AS total_sheets

      FROM v2_sleeve_requirements r

      JOIN v2_sleeve_sizes s
        ON s.id = r.size_id

      WHERE r.collection_item_id = ?

      GROUP BY
        s.id,
        s.width_tenth_mm,
        s.height_tenth_mm

      ORDER BY
        s.width_tenth_mm ASC,
        s.height_tenth_mm ASC
    `).bind(id).all();

    const sizes = result.results;

    // --------------------------------------------------
    // 3. 計算所有尺寸的牌套需求總張數
    // --------------------------------------------------
    const totalSheets = sizes.reduce(
      (sum, item) => sum + Number(item.total_sheets ?? 0),
      0
    );

    // --------------------------------------------------
    // 4. 保持 V1 API JSON 格式
    // --------------------------------------------------
    return Response.json({
      success: true,
      data: {
        game,
        sizes,
        total_sheets: totalSheets
      }
    });

  } catch (error) {
    console.error('Sleeve game V2 detail error:', error);

    return Response.json(
      {
        success: false,
        error: 'Failed to load game sleeve details'
      },
      { status: 500 }
    );
  }
};
