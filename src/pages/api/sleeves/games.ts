
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  try {
    const db = env.DB;

    if (!db) {
      return Response.json(
        { success: false, error: 'D1 binding DB not available' },
        { status: 503 }
      );
    }

    const search = (url.searchParams.get('q') ?? '').trim();
    const limit = 50;

    // 最多五組關鍵字
    const keywords = search
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5);

    const conditions: string[] = [];
    const bindings: (string | number)[] = [];

    for (const keyword of keywords) {
      // 跳脫 SQL LIKE 特殊字元
      const escaped = keyword
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');

      conditions.push(`
        (
          c.display_name LIKE ? ESCAPE '\\'
          OR g.primary_name LIKE ? ESCAPE '\\'
          OR CAST(g.bgg_id AS TEXT) = ?
        )
      `);

      bindings.push(
        `%${escaped}%`,
        `%${escaped}%`,
        keyword
      );
    }

    const where = conditions.length > 0
      ? `WHERE c.record_scope = 'production'
        AND ${conditions.join(' AND ')}`
      : `WHERE c.record_scope = 'production'`;

    const query = `
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
        END AS owned,

        g.primary_name AS bgg_name,

        CASE
          WHEN g.game_type = 'expansion' THEN 1
          WHEN g.game_type = 'base' THEN 0
          ELSE NULL
        END AS is_expansion,

        COUNT(r.id) AS requirement_count,
        COALESCE(SUM(r.quantity_sheets), 0) AS total_sheets,
        COUNT(DISTINCT r.size_id) AS size_count

      FROM v2_collection_items c

      LEFT JOIN v2_games g
        ON g.id = c.game_id

      LEFT JOIN v2_sleeve_requirements r
        ON r.collection_item_id = c.id

      ${where}

      GROUP BY c.id

      ORDER BY
        c.display_name COLLATE NOCASE ASC,
        c.id ASC

      LIMIT ?
    `;

    const result = await db
      .prepare(query)
      .bind(...bindings, limit)
      .all();

    return Response.json({
      success: true,
      data: {
        games: result.results,
        limit
      }
    });

  } catch (error) {
    console.error('Sleeve games V2 query error:', error);

    return Response.json(
      {
        success: false,
        error: 'Failed to query sleeve games'
      },
      { status: 500 }
    );
  }
};
