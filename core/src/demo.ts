// ============================================================================
// MUTATIS POC - UPDATED DEMO.TS
// Features: Evolved table queries + Path display
// ============================================================================

import * as readline from 'readline';
import { DatabaseManager } from './db';
import { classifyMemory } from './classification';
import { checkAndTriggerEvolution } from './schema-evolution-new';
import { GravityWeighting } from './retrieval';
import { OptimizedVectorStore, initOptimizedStore } from './optimized-retrieval';

const db = new DatabaseManager();
const gravity = new GravityWeighting();
const vectorStore = initOptimizedStore(64);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

// ============================================================================
// NEW: Query evolved tables for O(log N) indexed lookups
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

function queryEvolvedTables(dbInstance: any, queryText: string): EvolvedQueryResult {
  const start = performance.now();
  const queryLower = queryText.toLowerCase();

  // Get all evolved entities from pattern_tracker
  let evolvedEntities: { pattern_type: string; entity: string }[] = [];
  try {
    evolvedEntities = dbInstance.prepare(`
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
        const results = dbInstance.prepare(`
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

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  try {
    db.initializeSchema();
    db.reset();

    console.log('🎬 Mutatis POC - Interactive CLI with Classification\n');
    console.log('Commands: add <text> | query <text> | show | exit\n');

    let running = true;
    while (running) {
      const input = await prompt('> ');
      const [command, ...args] = input.trim().split(' ');
      const text = args.join(' ');

      if (command === 'exit') {
        running = false;
        break;
      } else if (command === 'add' && text) {
        console.log();
        
        // Classify the memory
        const classification = classifyMemory(db, text);
        console.log(`📊 Classification: ${classification.tier.toUpperCase()}`);
        console.log(`   Confidence: ${(classification.confidence * 100).toFixed(0)}%`);
        console.log(`   Reason: ${classification.reason}`);
        
        // Store in database
        const now = new Date().toISOString();
        const ttl = classification.tier === 'transient' ? 24 : 
                    classification.tier === 'episodic' ? 720 : undefined;
        
        const memoryId = db.insertMemory({
          content: text,
          tier: classification.tier,
          confidence: classification.confidence,
          schema_eligible: classification.schema_eligible,
          created_at: now,
          ttl: ttl
        });

        // Also add to optimized vector store for fast retrieval
        vectorStore.addMemory(memoryId, text, classification.tier, classification.confidence);

        console.log(`✅ Stored (ttl: ${ttl ? ttl + 'h' : 'permanent'})\n`);

        // Check for schema evolution
        if (classification.shouldEvolve && classification.pattern && classification.entity) {
          const evolution = checkAndTriggerEvolution(
            db,
            classification.pattern,
            classification.entity,
            classification.confidence
          );
        }

      // ================================================================
      // UPDATED QUERY COMMAND - Now checks evolved tables first!
      // ================================================================
      } else if (command === 'query' && text) {
        const totalStart = performance.now();
        
        // Step 1: Check evolved tables FIRST (O(log N))
        // @ts-ignore - accessing internal db
        const evolved = queryEvolvedTables(db.db, text);
        
        // Step 2: Vector search for additional results  
        const { results: vectorResults, timeMs: vectorTime } = vectorStore.retrieve(text, 5);
        
        const totalTime = performance.now() - totalStart;
        
        // Display header
        console.log(`\n⚡ Retrieved in ${totalTime.toFixed(2)}ms`);
        
        // ============================================================
        // PATH DISPLAY - Shows where data came from
        // ============================================================
        if (evolved.source === 'indexed') {
          console.log(`   Path: INDEXED → ${evolved.tableName} (O(log N)) ✓`);
          console.log(`   Entity: "${evolved.entity}" found in evolved schema\n`);
          
          // Show indexed results first (these are the O(log N) wins!)
          console.log(`━━━ INDEXED RESULTS (${evolved.results.length} records) ━━━\n`);
          evolved.results.slice(0, 3).forEach((r, i) => {
            const boostedScore = r.confidence * 1.4142; // √2 boost
            console.log(`${i + 1}. "${r.content}" [INDEXED]`);
            console.log(`   Tier: foundational | Raw: ${(r.confidence * 100).toFixed(0)}% | Boosted: ${(boostedScore * 100).toFixed(1)}%`);
            console.log(`   ↑ O(log N) indexed lookup\n`);
          });
          
          // Show additional vector results that aren't duplicates
          const indexedContents = new Set(evolved.results.map(r => r.content.toLowerCase()));
          const additionalResults = vectorResults.filter(r => 
            !indexedContents.has(r.content.toLowerCase())
          );
          
          if (additionalResults.length > 0) {
            console.log(`━━━ VECTOR RESULTS (additional) ━━━\n`);
            additionalResults.slice(0, 2).forEach((m, i) => {
              console.log(`${i + 1}. "${m.content}"`);
              console.log(`   Tier: ${m.tier} | Raw: ${(m.rawScore * 100).toFixed(1)}% | Boosted: ${(m.boostedScore * 100).toFixed(1)}%\n`);
            });
          }
        } else {
          // No evolved tables matched - show vector scan path
          console.log(`   Path: VECTOR SCAN (O(N))\n`);
          
          if (vectorResults.length > 0) {
            vectorResults.slice(0, 3).forEach((m, i) => {
              console.log(`${i + 1}. "${m.content}"`);
              console.log(`   Tier: ${m.tier} | Raw: ${(m.rawScore * 100).toFixed(1)}% | Boosted: ${(m.boostedScore * 100).toFixed(1)}%`);
            });
          } else {
            console.log('   No matching memories found');
          }
        }
        console.log();

      } else if (command === 'show') {
        const stats = vectorStore.getStats();
        console.log(`\n${stats.total} memories stored`);
        console.log(`  Foundational: ${stats.foundational}`);
        console.log(`  Episodic: ${stats.episodic}`);
        console.log(`  Transient: ${stats.transient}\n`);
      } else if (command !== '') {
        console.log('Unknown command. Use: add <text> | query <text> | show | exit\n');
      }
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    rl.close();
    db.close();
  }
}

main().catch(console.error);