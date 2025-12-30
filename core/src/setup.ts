import { DatabaseManager } from './db';

console.log('🚀 Mutatis POC - Setup');
console.log('━━━━━━━━━━━━━━━━━━━━━━');

const db = new DatabaseManager();

try {
  db.initializeSchema();
  console.log('✓ Database initialized successfully\n');
  console.log('📁 Database file: ./mutatis.db');
  console.log('📊 Tables created:');
  console.log('   - generic_memories (id, content, embedding, tier, confidence, schema_eligible, created_at, ttl)');
  console.log('   - memory_tiers (id, name, description, created_at)');
  console.log('   - schema_registry (id, pattern_name, table_name, created_at, record_count, mutation_hash)');
  console.log('\n✨ Ready for demo. Run: npm run demo');
} catch (error) {
  console.error('❌ Setup failed:', error);
  process.exit(1);
} finally {
  db.close();
}
