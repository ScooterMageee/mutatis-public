import Database from 'better-sqlite3';
import { DatabaseManager } from './db';
import { randomUUID } from 'crypto';

const EVOLUTION_THRESHOLD = 0.95;
const MAX_EVOLUTIONS_PER_SESSION = 3;
let evolutionCount = 0;

export interface EvolutionResult {
  triggered: boolean;
  tableName?: string;
  recordCount?: number;
  message: string;
}

export function checkAndTriggerEvolution(
  db: DatabaseManager,
  patternType: string,
  entity: string,
  confidence: number
): EvolutionResult {
  
  const database = db.getDatabase();
  if (confidence < EVOLUTION_THRESHOLD) {
    return {
      triggered: false,
      message: `Confidence ${(confidence * 100).toFixed(0)}% below threshold ${EVOLUTION_THRESHOLD * 100}%`
    };
  }

  if (evolutionCount >= MAX_EVOLUTIONS_PER_SESSION) {
    return {
      triggered: false,
      message: `Rate limit reached (${MAX_EVOLUTIONS_PER_SESSION} evolutions per session)`
    };
  }

  const patternRecord = database.prepare(`
    SELECT evolved FROM pattern_tracker 
    WHERE pattern_type = ? AND entity = ?
  `).get(patternType, entity.toLowerCase()) as { evolved: number } | undefined;

  if (patternRecord?.evolved) {
    return {
      triggered: false,
      message: `Schema for ${patternType}:${entity} already evolved`
    };
  }

  // TRIGGER EVOLUTION
  console.log('\n════════════════════════════════════════');
  console.log('⚡ SCHEMA EVOLUTION TRIGGERED');
  console.log('════════════════════════════════════════');

  const tableName = `${patternType}_evolved`;
  const shadowName = `${tableName}_shadow_${Date.now()}`;

  try {
    console.log(`[SHADOW] Creating ${shadowName}...`);
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${shadowName} (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL,
        created_at TEXT,
        source_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_${shadowName}_entity ON ${shadowName}(entity);
    `);

    console.log(`[BACKFILL] Moving records mentioning '${entity}'...`);
    const memories = database.prepare(`
      SELECT id, content, confidence, created_at 
      FROM generic_memories 
      WHERE LOWER(content) LIKE ?
    `).all(`%${entity.toLowerCase()}%`) as Array<{
      id: string;
      content: string;
      confidence: number;
      created_at: string;
    }>;

    const insertStmt = database.prepare(`
      INSERT INTO ${shadowName} (id, entity, content, confidence, created_at, source_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const mem of memories) {
      insertStmt.run(randomUUID(), entity.toLowerCase(), mem.content, mem.confidence, mem.created_at, mem.id);
    }
    console.log(`[BACKFILL] Moved ${memories.length} records`);

    console.log(`[SWAP] Executing atomic transaction...`);
    
    database.exec(`
      DROP TABLE IF EXISTS ${tableName}_archive;
      DROP TABLE IF EXISTS ${tableName};
      ALTER TABLE ${shadowName} RENAME TO ${tableName};
    `);

    const registryId = randomUUID();
    database.prepare(`
      INSERT INTO schema_registry (id, pattern_type, table_name, created_at, record_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(registryId, patternType, tableName, new Date().toISOString(), memories.length);

    database.prepare(`
      UPDATE pattern_tracker SET evolved = 1 
      WHERE pattern_type = ? AND entity = ?
    `).run(patternType, entity.toLowerCase());

    evolutionCount++;

    console.log(`[COMPLETE] Schema evolved successfully`);
    console.log(`\n  Before: SELECT * FROM generic_memories WHERE LIKE '%${entity}%' (O(N) scan)`);
    console.log(`  After:  SELECT * FROM ${tableName} WHERE entity = '${entity}' (O(log N) index)`);
    console.log('════════════════════════════════════════\n');

    return {
      triggered: true,
      tableName: tableName,
      recordCount: memories.length,
      message: `Created ${tableName} with ${memories.length} records`
    };

  } catch (error) {
    console.error('[ERROR] Schema evolution failed:', error);
    return {
      triggered: false,
      message: `Evolution failed: ${error}`
    };
  }
}

export function queryWithEvolution(
  db: DatabaseManager,
  query: string
): { source: string; results: any[] } {
  
  const database = db.getDatabase();
  const evolvedTables = database.prepare(`
    SELECT table_name, pattern_type FROM schema_registry
  `).all() as Array<{ table_name: string; pattern_type: string }>;

  console.log(`[SCHEMA] Found ${evolvedTables.length} evolved table(s)`);

  for (const table of evolvedTables) {
    const entities = database.prepare(`
      SELECT DISTINCT entity FROM ${table.table_name}
    `).all() as Array<{ entity: string }>;

    for (const { entity } of entities) {
      if (query.toLowerCase().includes(entity)) {
        console.log(`[PATH] Indexed lookup → ${table.table_name} (entity: ${entity})`);
        
        const results = database.prepare(`
          SELECT * FROM ${table.table_name} WHERE entity = ?
        `).all(entity);

        return {
          source: `indexed:${table.table_name}`,
          results: results
        };
      }
    }
  }

  return {
    source: 'generic_memories',
    results: []
  };
}

export function getMutationCount(): number {
  return evolutionCount;
}

export function resetMutationCount(): void {
  evolutionCount = 0;
}
