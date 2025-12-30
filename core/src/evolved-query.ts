// ============================================================================
// EVOLVED TABLE QUERY PATCH
// Query evolved tables first for O(log N) indexed lookups
// ============================================================================

interface EvolvedQueryResult {
  source: 'indexed' | 'none';
  tableName: string | null;
  entity: string | null;
  results: Array<{
    id: string;
    content: string;
    confidence: number;
    entity: string;
  }>;
  timeMs: number;
}

/**
 * Query evolved tables first for O(log N) indexed lookups
 * Returns results from evolved schema tables if the query mentions a known evolved entity
 */
export function queryEvolvedTables(db: any, queryText: string): EvolvedQueryResult {
  const start = performance.now();
  const queryLower = queryText.toLowerCase();

  // Get all evolved entities from pattern_tracker
  let evolvedEntities: { pattern_type: string; entity: string }[] = [];
  try {
    evolvedEntities = db.prepare(`
      SELECT pattern_type, entity 
      FROM pattern_tracker 
      WHERE evolved = 1
    `).all() as { pattern_type: string; entity: string }[];
  } catch (e) {
    // Table might not exist yet
    return {
      source: 'none',
      tableName: null,
      entity: null,
      results: [],
      timeMs: performance.now() - start
    };
  }

  if (evolvedEntities.length === 0) {
    return {
      source: 'none',
      tableName: null,
      entity: null,
      results: [],
      timeMs: performance.now() - start
    };
  }

  // Check if query mentions any evolved entity
  for (const { pattern_type, entity } of evolvedEntities) {
    const entityRegex = new RegExp(`\\b${entity}\\b`, 'i');
    
    if (entityRegex.test(queryLower)) {
      const tableName = `${pattern_type}_evolved`;
      
      try {
        // O(log N) indexed lookup!
        const results = db.prepare(`
          SELECT id, content, confidence, entity
          FROM "${tableName}"
          WHERE entity = ?
          ORDER BY confidence DESC
        `).all(entity);

        return {
          source: 'indexed',
          tableName,
          entity,
          results,
          timeMs: performance.now() - start
        };
      } catch (e) {
        // Table doesn't exist, continue
        console.log(`[WARN] Evolved table ${tableName} not found`);
      }
    }
  }

  return {
    source: 'none',
    tableName: null,
    entity: null,
    results: [],
    timeMs: performance.now() - start
  };
}

export { EvolvedQueryResult };
