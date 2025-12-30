import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { Memory, SchemaRegistry, MemoryTier } from './types';

const DB_PATH = './mutatis.db';

export class DatabaseManager {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
  }

  initializeSchema() {
    // Generic memories table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS generic_memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding TEXT,
        tier TEXT NOT NULL CHECK(tier IN ('transient', 'episodic', 'foundational')),
        confidence REAL NOT NULL,
        schema_eligible BOOLEAN NOT NULL,
        created_at TEXT NOT NULL,
        ttl INTEGER,
        stored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_tier ON generic_memories(tier);
      CREATE INDEX IF NOT EXISTS idx_created ON generic_memories(created_at);
    `);

    // Memory tiers tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_tiers (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL
      );
    `);

    // Pattern tracker for entity mentions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pattern_tracker (
        id TEXT PRIMARY KEY,
        pattern_type TEXT NOT NULL,
        entity TEXT NOT NULL,
        mention_count INTEGER DEFAULT 1,
        base_confidence REAL DEFAULT 0.80,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        evolved BOOLEAN DEFAULT 0,
        UNIQUE(pattern_type, entity)
      );
      CREATE INDEX IF NOT EXISTS idx_pattern_entity ON pattern_tracker(pattern_type, entity);
    `);

    // Schema registry for evolved tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_registry (
        id TEXT PRIMARY KEY,
        pattern_type TEXT NOT NULL,
        table_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        record_count INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_table_name ON schema_registry(table_name);
    `);

    console.log('✓ Database schema initialized');
  }

  insertMemory(memory: Omit<Memory, 'id'> & { id?: string }): string {
    const id = memory.id || randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO generic_memories 
      (id, content, embedding, tier, confidence, schema_eligible, created_at, ttl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      memory.content,
      memory.embedding ? JSON.stringify(memory.embedding) : null,
      memory.tier,
      memory.confidence,
      memory.schema_eligible ? 1 : 0,
      memory.created_at,
      memory.ttl || null
    );

    return id;
  }

  queryMemories(limit: number = 20): Memory[] {
    const stmt = this.db.prepare(`
      SELECT id, content, tier, confidence, embedding, schema_eligible, created_at, ttl
      FROM generic_memories
      ORDER BY created_at DESC
      LIMIT ?
    `);

    return stmt.all(limit).map((row: any) => ({
      id: row.id,
      content: row.content,
      tier: row.tier,
      confidence: row.confidence,
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
      schema_eligible: Boolean(row.schema_eligible),
      created_at: row.created_at,
      ttl: row.ttl
    }));
  }

  getMemoryById(id: string): Memory | null {
    const stmt = this.db.prepare(`
      SELECT id, content, tier, confidence, embedding, schema_eligible, created_at, ttl
      FROM generic_memories
      WHERE id = ?
    `);

    const row: any = stmt.get(id);
    if (!row) return null;

    return {
      id: row.id,
      content: row.content,
      tier: row.tier,
      confidence: row.confidence,
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
      schema_eligible: Boolean(row.schema_eligible),
      created_at: row.created_at,
      ttl: row.ttl
    };
  }

  getMemoriesByTier(tier: MemoryTier): Memory[] {
    const stmt = this.db.prepare(`
      SELECT id, content, tier, confidence, embedding, schema_eligible, created_at, ttl
      FROM generic_memories
      WHERE tier = ?
      ORDER BY created_at DESC
    `);

    return stmt.all(tier).map((row: any) => ({
      id: row.id,
      content: row.content,
      tier: row.tier,
      confidence: row.confidence,
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
      schema_eligible: Boolean(row.schema_eligible),
      created_at: row.created_at,
      ttl: row.ttl
    }));
  }

  registerSchemaEvolution(
    pattern: string,
    table: string,
    hash: string,
    baseTier?: string
  ): string {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO schema_registry 
      (id, pattern_name, table_name, created_at, mutation_hash, base_tier, record_count)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `);

    stmt.run(id, pattern, table, new Date().toISOString(), hash, baseTier || null);
    return id;
  }

  getEvolvedTables(): SchemaRegistry[] {
    const stmt = this.db.prepare(`
      SELECT id, pattern_name, table_name, created_at, record_count, mutation_hash
      FROM schema_registry
      ORDER BY created_at DESC
    `);

    return stmt.all() as SchemaRegistry[];
  }

  getEvolvedTable(tableName: string): SchemaRegistry | null {
    const stmt = this.db.prepare(`
      SELECT id, pattern_name, table_name, created_at, record_count, mutation_hash
      FROM schema_registry
      WHERE table_name = ?
    `);

    return stmt.get(tableName) as SchemaRegistry | null;
  }

  executeDDL(sql: string): void {
    this.db.exec(sql);
  }

  execute(sql: string, params: any[] = []): any {
    const stmt = this.db.prepare(sql);
    return stmt.run(...params);
  }

  close(): void {
    this.db.close();
  }

  reset(): void {
    this.db.exec('DELETE FROM generic_memories; DELETE FROM schema_registry; DELETE FROM pattern_tracker;');
  }

  getDatabase(): Database.Database {
    return this.db;
  }
}
