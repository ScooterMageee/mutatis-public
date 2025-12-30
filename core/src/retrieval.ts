import { Memory, RetrievedMemory, MemoryTier } from './types';

// PATENT CLAIM: The √2 Gravity Constant
const RITUAL_GRAVITY_CONSTANT = Math.SQRT2;

export class GravityWeighting {
  calculateSimilarity(query: string, text: string): number {
    const queryWords = new Set(query.toLowerCase().split(/\W+/));
    const textWords = new Set(text.toLowerCase().split(/\W+/));
    
    let matches = 0;
    for (const word of queryWords) {
      if (textWords.has(word)) matches++;
    }
    
    const union = queryWords.size + textWords.size - matches;
    return union > 0 ? matches / union : 0;
  }

  getMultiplier(tier: MemoryTier): number {
    switch (tier) {
      case 'foundational':
        return RITUAL_GRAVITY_CONSTANT;
      case 'episodic':
        return 1.0;
      case 'transient':
        return 0.5;
    }
  }

  applyGravity(memories: Memory[], query: string): RetrievedMemory[] {
    return memories
      .map((memory) => {
        const similarity = this.calculateSimilarity(query, memory.content);
        const multiplier = this.getMultiplier(memory.tier);
        const boosted_score = similarity * multiplier;

        return {
          ...memory,
          similarity,
          raw_score: similarity,
          boosted_score,
          multiplier
        };
      })
      .sort((a, b) => b.boosted_score - a.boosted_score);
  }

  formatMemory(mem: RetrievedMemory, rank: number): string {
    const tierLabel = `[${mem.tier.toUpperCase()}]`;
    const similarity = mem.raw_score.toFixed(3);
    const boosted = mem.boosted_score.toFixed(3);
    const multiplier = mem.multiplier.toFixed(3);
    
    return `
    #${rank} ${tierLabel}
    Content: ${mem.content}
    Raw Score: ${similarity} | Boosted: ${boosted} (×${multiplier}) | CONFIDENCE: ${(mem.confidence * 100).toFixed(0)}%
    `;
  }
}

export const createGravityWeighting = (): GravityWeighting => new GravityWeighting();
