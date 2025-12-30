// ============================================================================
// MUTATIS OPTIMIZED RETRIEVAL
// Float32Array buffers + SIMD-style batch processing + In-memory cache
// Target: Sub-3ms retrieval
// ============================================================================

// ============================================================================
// TYPES
// ============================================================================

interface MemoryRecord {
  id: string;
  content: string;
  tier: 'foundational' | 'episodic' | 'transient';
  confidence: number;
  embedding: Float32Array;
  created_at: number;
}

interface ScoredMemory {
  id: string;
  content: string;
  tier: 'foundational' | 'episodic' | 'transient';
  rawScore: number;
  boostedScore: number;
  multiplier: number;
}

// ============================================================================
// IN-MEMORY VECTOR STORE
// All vectors stored as contiguous Float32Arrays for cache efficiency
// ============================================================================

export class OptimizedVectorStore {
  private memories: Map<string, MemoryRecord> = new Map();
  
  // Contiguous buffers for SIMD-style batch operations
  private foundationalVectors: Float32Array = new Float32Array(0);
  private foundationalIds: string[] = [];
  
  private episodicVectors: Float32Array = new Float32Array(0);
  private episodicIds: string[] = [];
  
  private transientVectors: Float32Array = new Float32Array(0);
  private transientIds: string[] = [];
  
  private embeddingDim: number = 64; // Reduced for POC, use 1536 for OpenAI
  
  // Gravity multipliers
  private readonly SQRT2 = 1.4142135623730951;
  private readonly FOUNDATIONAL_MULT = 1.4142135623730951; // √2
  private readonly EPISODIC_MULT = 1.0;
  private readonly TRANSIENT_MULT = 0.5;

  constructor(embeddingDim: number = 64) {
    this.embeddingDim = embeddingDim;
  }

  // -------------------------------------------------------------------------
  // FAST TEXT TO EMBEDDING (mock for POC, replace with real embeddings later)
  // -------------------------------------------------------------------------
  
  textToEmbedding(text: string): Float32Array {
    const embedding = new Float32Array(this.embeddingDim);
    const words = text.toLowerCase().split(/\s+/);
    
    // Simple hash-based embedding (deterministic, fast)
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      for (let j = 0; j < word.length; j++) {
        const idx = (word.charCodeAt(j) * 31 + i * 17 + j * 13) % this.embeddingDim;
        embedding[idx] += 1.0 / words.length;
      }
    }
    
    // Normalize to unit vector
    let norm = 0;
    for (let i = 0; i < this.embeddingDim; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.embeddingDim; i++) {
        embedding[i] /= norm;
      }
    }
    
    return embedding;
  }

  // -------------------------------------------------------------------------
  // ADD MEMORY (maintains contiguous buffers)
  // -------------------------------------------------------------------------
  
  addMemory(
    id: string,
    content: string,
    tier: 'foundational' | 'episodic' | 'transient',
    confidence: number
  ): void {
    const embedding = this.textToEmbedding(content);
    
    const record: MemoryRecord = {
      id,
      content,
      tier,
      confidence,
      embedding,
      created_at: Date.now()
    };
    
    this.memories.set(id, record);
    
    // Add to tier-specific buffer
    if (tier === 'foundational') {
      this.appendToBuffer('foundational', id, embedding);
    } else if (tier === 'episodic') {
      this.appendToBuffer('episodic', id, embedding);
    } else {
      this.appendToBuffer('transient', id, embedding);
    }
  }

  private appendToBuffer(
    tier: 'foundational' | 'episodic' | 'transient',
    id: string,
    embedding: Float32Array
  ): void {
    let vectors: Float32Array;
    let ids: string[];
    
    if (tier === 'foundational') {
      vectors = this.foundationalVectors;
      ids = this.foundationalIds;
    } else if (tier === 'episodic') {
      vectors = this.episodicVectors;
      ids = this.episodicIds;
    } else {
      vectors = this.transientVectors;
      ids = this.transientIds;
    }
    
    // Expand buffer
    const newVectors = new Float32Array(vectors.length + this.embeddingDim);
    newVectors.set(vectors);
    newVectors.set(embedding, vectors.length);
    
    ids.push(id);
    
    // Update reference
    if (tier === 'foundational') {
      this.foundationalVectors = newVectors;
      this.foundationalIds = ids;
    } else if (tier === 'episodic') {
      this.episodicVectors = newVectors;
      this.episodicIds = ids;
    } else {
      this.transientVectors = newVectors;
      this.transientIds = ids;
    }
  }

  // -------------------------------------------------------------------------
  // SIMD-STYLE BATCH COSINE SIMILARITY
  // Process 4 vectors at a time for cache efficiency
  // -------------------------------------------------------------------------
  
  private batchCosineSimilarity(
    queryVec: Float32Array,
    vectors: Float32Array,
    count: number
  ): Float32Array {
    const scores = new Float32Array(count);
    const dim = this.embeddingDim;
    
    // Process in batches of 4 for better cache utilization
    const batchSize = 4;
    const fullBatches = Math.floor(count / batchSize);
    
    for (let batch = 0; batch < fullBatches; batch++) {
      const baseIdx = batch * batchSize;
      
      // Compute 4 dot products simultaneously
      let dot0 = 0, dot1 = 0, dot2 = 0, dot3 = 0;
      
      const offset0 = (baseIdx + 0) * dim;
      const offset1 = (baseIdx + 1) * dim;
      const offset2 = (baseIdx + 2) * dim;
      const offset3 = (baseIdx + 3) * dim;
      
      for (let d = 0; d < dim; d++) {
        const q = queryVec[d];
        dot0 += q * vectors[offset0 + d];
        dot1 += q * vectors[offset1 + d];
        dot2 += q * vectors[offset2 + d];
        dot3 += q * vectors[offset3 + d];
      }
      
      scores[baseIdx + 0] = dot0;
      scores[baseIdx + 1] = dot1;
      scores[baseIdx + 2] = dot2;
      scores[baseIdx + 3] = dot3;
    }
    
    // Handle remaining vectors
    for (let i = fullBatches * batchSize; i < count; i++) {
      let dot = 0;
      const offset = i * dim;
      for (let d = 0; d < dim; d++) {
        dot += queryVec[d] * vectors[offset + d];
      }
      scores[i] = dot;
    }
    
    return scores;
  }

  // -------------------------------------------------------------------------
  // SIMD-STYLE GRAVITY WEIGHTING
  // Apply multiplier to 4 scores at a time
  // -------------------------------------------------------------------------
  
  private applyGravityBatch(scores: Float32Array, multiplier: number): Float32Array {
    const boosted = new Float32Array(scores.length);
    
    // Process 4 at a time
    const len = scores.length;
    const fullBatches = Math.floor(len / 4);
    
    for (let i = 0; i < fullBatches * 4; i += 4) {
      boosted[i + 0] = scores[i + 0] * multiplier;
      boosted[i + 1] = scores[i + 1] * multiplier;
      boosted[i + 2] = scores[i + 2] * multiplier;
      boosted[i + 3] = scores[i + 3] * multiplier;
    }
    
    // Remainder
    for (let i = fullBatches * 4; i < len; i++) {
      boosted[i] = scores[i] * multiplier;
    }
    
    return boosted;
  }

  // -------------------------------------------------------------------------
  // OPTIMIZED RETRIEVAL
  // -------------------------------------------------------------------------
  
  retrieve(query: string, topK: number = 5): { results: ScoredMemory[]; timeMs: number } {
    const startTime = performance.now();
    
    const queryVec = this.textToEmbedding(query);
    
    const allScored: ScoredMemory[] = [];
    
    // Process foundational tier
    if (this.foundationalIds.length > 0) {
      const rawScores = this.batchCosineSimilarity(
        queryVec,
        this.foundationalVectors,
        this.foundationalIds.length
      );
      const boostedScores = this.applyGravityBatch(rawScores, this.FOUNDATIONAL_MULT);
      
      for (let i = 0; i < this.foundationalIds.length; i++) {
        const record = this.memories.get(this.foundationalIds[i])!;
        allScored.push({
          id: record.id,
          content: record.content,
          tier: 'foundational',
          rawScore: rawScores[i],
          boostedScore: boostedScores[i],
          multiplier: this.FOUNDATIONAL_MULT
        });
      }
    }
    
    // Process episodic tier
    if (this.episodicIds.length > 0) {
      const rawScores = this.batchCosineSimilarity(
        queryVec,
        this.episodicVectors,
        this.episodicIds.length
      );
      const boostedScores = this.applyGravityBatch(rawScores, this.EPISODIC_MULT);
      
      for (let i = 0; i < this.episodicIds.length; i++) {
        const record = this.memories.get(this.episodicIds[i])!;
        allScored.push({
          id: record.id,
          content: record.content,
          tier: 'episodic',
          rawScore: rawScores[i],
          boostedScore: boostedScores[i],
          multiplier: this.EPISODIC_MULT
        });
      }
    }
    
    // Process transient tier
    if (this.transientIds.length > 0) {
      const rawScores = this.batchCosineSimilarity(
        queryVec,
        this.transientVectors,
        this.transientIds.length
      );
      const boostedScores = this.applyGravityBatch(rawScores, this.TRANSIENT_MULT);
      
      for (let i = 0; i < this.transientIds.length; i++) {
        const record = this.memories.get(this.transientIds[i])!;
        allScored.push({
          id: record.id,
          content: record.content,
          tier: 'transient',
          rawScore: rawScores[i],
          boostedScore: boostedScores[i],
          multiplier: this.TRANSIENT_MULT
        });
      }
    }
    
    // Sort by boosted score descending
    allScored.sort((a, b) => b.boostedScore - a.boostedScore);
    
    const endTime = performance.now();
    
    return {
      results: allScored.slice(0, topK),
      timeMs: endTime - startTime
    };
  }

  // -------------------------------------------------------------------------
  // STATS
  // -------------------------------------------------------------------------
  
  getStats(): { foundational: number; episodic: number; transient: number; total: number } {
    return {
      foundational: this.foundationalIds.length,
      episodic: this.episodicIds.length,
      transient: this.transientIds.length,
      total: this.memories.size
    };
  }
}

// ============================================================================
// INTEGRATION WITH EXISTING POC
// ============================================================================

// Global store instance
let vectorStore: OptimizedVectorStore | null = null;

export function initOptimizedStore(embeddingDim: number = 64): OptimizedVectorStore {
  vectorStore = new OptimizedVectorStore(embeddingDim);
  return vectorStore;
}

export function getStore(): OptimizedVectorStore {
  if (!vectorStore) {
    vectorStore = new OptimizedVectorStore(64);
  }
  return vectorStore;
}
