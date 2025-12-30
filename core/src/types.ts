// Shared types for Mutatis POC

export type MemoryTier = 'transient' | 'episodic' | 'foundational';

export interface Memory {
  id: string;
  content: string;
  tier: MemoryTier;
  confidence: number;
  embedding?: number[];
  schema_eligible: boolean;
  created_at: string;
  ttl?: number; // in hours, null = permanent
}

export interface RetrievedMemory extends Memory {
  similarity: number;
  raw_score: number;
  boosted_score: number;
  multiplier: number;
  evolved_table?: string;
}

export interface SchemaRegistry {
  id: string;
  pattern_name: string;
  table_name: string;
  created_at: string;
  record_count: number;
  mutation_hash: string;
}

export interface ClassificationResult {
  tier: MemoryTier;
  confidence: number;
  reasoning: string;
}

export interface QueryResult {
  memories: RetrievedMemory[];
  summary: {
    total_searched: number;
    evolved_tables_used: string[];
    gravity_boost_applied: boolean;
  };
}
