// verify_gravity.ts
// Demonstrates the √2 (SQRT2) gravity weighting for foundational memories

// --- 1. THE MOCKS (Replacing your Imports) ---

// Mocking the OpenAI SDK
class MockOpenAI {
    embeddings: any;
    constructor(config: any) {
        console.log("  [Mock] OpenAI Client Initialized");
        this.embeddings = {
            create: async (params: any) => {
                // Return a fake 1536-dim vector
                return {
                    data: [{ embedding: new Array(1536).fill(0.1) }]
                };
            }
        };
    }
}

// Mocking Supabase Client
const mockSupabase = {
    rpc: async (funcName: string, params: any) => {
        console.log(`  [Mock] Supabase RPC called: '${funcName}'`);

        // SIMULATED DATABASE RETURN
        // SCENARIO:
        // 1. "Toast" is a high match (0.9) but 'transient'.
        // 2. "Philosophy" is a low match (0.65) but 'foundational'.
        // If your math works, Philosophy should win.
        return {
            data: [
                {
                    id: "mem_1",
                    content: "I just ate some toast.",
                    similarity: 0.90, // precise match
                    type: 'transient',
                    created_at: new Date().toISOString()
                },
                {
                    id: "mem_2",
                    content: "I believe in radical self-ownership.",
                    similarity: 0.65, // vague match
                    type: 'foundational',
                    created_at: new Date().toISOString()
                }
            ],
            error: null
        };
    }
};

// --- 2. YOUR EXACT LOGIC (Modified only to use Mocks) ---

// PATENT CLAIM: The Irrational Gravity Constant
const RITUAL_GRAVITY_CONSTANT = Math.SQRT2; // ~1.414

interface RetrievedMemory {
    id: string;
    content: string;
    similarity: number;
    type: 'transient' | 'episodic' | 'foundational';
    created_at: string;
    final_score?: number;
}

// Rewritten slightly to use the mocks defined above
async function runTest(query: string, userId: string): Promise<RetrievedMemory[]> {
    console.log("\n--- STARTING ALGORITHM ---");

    // USE MOCKS INSTEAD OF IMPORTS
    const supabase = mockSupabase;
    const llm = new MockOpenAI({ apiKey: "fake-key" });

    try {
        // 1. Generate Query Vector
        const embeddingResponse = await llm.embeddings.create({
            model: "text-embedding-3-small",
            input: query,
        });
        const queryVector = embeddingResponse.data[0].embedding;

        // 2. Vector Search (Standard Cosine Similarity)
        const { data: rawMemories, error } = await supabase.rpc('match_memories', {
            query_embedding: queryVector,
            match_threshold: 0.5,
            match_count: 20,
            p_user_id: userId
        });

        if (error) throw error;
        if (!rawMemories || rawMemories.length === 0) return [];

        console.log("\n--- RAW VECTOR RESULTS (Standard RAG) ---");
        console.table(rawMemories.map((m: any) => ({
            content: m.content,
            similarity: m.similarity,
            type: m.type
        })));

        // 3. PATENT CLAIM: Gravity Re-Ranking
        const reRankedMemories = rawMemories.map((memory: any) => {
            let multiplier = 1.0;

            if (memory.type === 'foundational') {
                multiplier = RITUAL_GRAVITY_CONSTANT; // 1.414
                console.log(`  [Gravity] Foundational Memory detected ('${memory.content.substring(0, 15)}...'). Applying SQRT2 Boost.`);
            }
            else if (memory.type === 'transient') {
                multiplier = 0.5;
                console.log(`  [Gravity] Transient Memory detected ('${memory.content.substring(0, 15)}...'). Applying Penalty.`);
            }

            const finalScore = memory.similarity * multiplier;

            return {
                ...memory,
                final_score: finalScore
            };
        });

        // 4. Sort by GRAVITY Score
        reRankedMemories.sort((a: any, b: any) => b.final_score - a.final_score);

        return reRankedMemories.slice(0, 5);

    } catch (err) {
        console.error("Retrieval failed:", err);
        return [];
    }
}

// --- 3. THE VERIFICATION ---

(async () => {
    const results = await runTest("Who am I?", "user_123");

    console.log("\n--- FINAL CONTEXT ORDER ---");
    console.table(results.map((m: any) => ({
        content: m.content,
        base_similarity: m.similarity,
        final_gravity_score: m.final_score.toFixed(4)
    })));

    // ASSERTION
    const winner = results[0];
    if (winner.type === 'foundational' && winner.similarity < 0.9) {
        console.log("\n✅ SUCCESS: The 'Foundational' memory outranked the 'Transient' memory despite lower lexical similarity.");
        console.log(`   Proof: ${winner.final_score.toFixed(4)} > ${results[1].final_score?.toFixed(4)}`);
    } else {
        console.log("\n❌ FAIL: The math didn't work. The transient memory is still winning.");
    }
})();
