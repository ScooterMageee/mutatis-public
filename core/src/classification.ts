import Database from 'better-sqlite3';
import { DatabaseManager } from './db';
import { randomUUID } from 'crypto';

export interface ClassificationResult {
  tier: 'foundational' | 'episodic' | 'transient';
  confidence: number;
  reason: string;
  pattern: string | null;
  entity: string | null;
  schema_eligible: boolean;
  shouldEvolve: boolean;
}

interface PatternMatch {
  pattern: string;
  entity: string | null;
  baseConfidence: number;
}

interface PatternRecord {
  id: string;
  pattern_type: string;
  entity: string;
  mention_count: number;
  base_confidence: number;
  first_seen: string;
  last_seen: string;
  evolved: boolean;
}

const FOUNDATIONAL_PATTERNS: Array<{
  regex: RegExp;
  pattern: string;
  confidence: number;
  entityExtractor: (match: RegExpMatchArray, input: string) => string | null;
}> = [
  // Identity patterns
  {
    regex: /\b(?:my name is|i am called|call me|i'm)\s+([a-z]+)/i,
    pattern: 'identity_name',
    confidence: 0.85,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  // Family relationships
  {
    regex: /\b([a-z]+)\s+is my\s+(wife|husband|spouse|partner)/i,
    pattern: 'family_spouse',
    confidence: 0.85,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  {
    regex: /\b([a-z]+)\s+is my\s+(son|daughter|child|kid|baby)/i,
    pattern: 'family_child',
    confidence: 0.83,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  {
    regex: /\b([a-z]+)\s+is my\s+(mother|father|mom|dad|parent)/i,
    pattern: 'family_parent',
    confidence: 0.83,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  // PET PATTERNS (FIXED)
  {
    regex: /\b([a-z]+)\s+is my\s+(dog|cat|pet)/i,
    pattern: 'family_pet',
    confidence: 0.82,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  {
    regex: /\bmy\s+(dog|cat|pet)\s+([a-z]+)/i,
    pattern: 'family_pet',
    confidence: 0.82,
    entityExtractor: (match) => match[2]?.toLowerCase() || null
  },
  {
    regex: /\bi\s+(?:love|like|have|own)\s+my\s+(dog|cat|pet)\s+([a-z]+)/i,
    pattern: 'family_pet',
    confidence: 0.82,
    entityExtractor: (match) => match[2]?.toLowerCase() || null
  },
  {
    regex: /\bi\s+(?:love|have|own|got)\s+(?:a\s+)?(?:my\s+)?(dog|cat|pet)\s+(?:named\s+)?([a-z]+)/i,
    pattern: 'family_pet',
    confidence: 0.82,
    entityExtractor: (match) => match[2]?.toLowerCase() || null
  },
  {
    regex: /\bi\s+(?:love|have|own)\s+my\s+(dog|cat|pet),?\s+([a-z]+)/i,
    pattern: 'family_pet',
    confidence: 0.82,
    entityExtractor: (match) => match[2]?.toLowerCase() || null
  },
  // Medical/Allergy
  {
    regex: /\b(?:i am |i'm )?allergic to\s+([a-z]+)/i,
    pattern: 'medical_allergy',
    confidence: 0.92,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  // Core beliefs
  {
    regex: /\bi believe\s+(.+)/i,
    pattern: 'core_belief',
    confidence: 0.80,
    entityExtractor: (match) => match[1]?.substring(0, 50) || null
  },
  {
    regex: /\bi always\s+(.+)/i,
    pattern: 'behavioral_always',
    confidence: 0.78,
    entityExtractor: (match) => match[1]?.substring(0, 50) || null
  },
  {
    regex: /\bi never\s+(.+)/i,
    pattern: 'behavioral_never',
    confidence: 0.78,
    entityExtractor: (match) => match[1]?.substring(0, 50) || null
  },
  // Emotional patterns
  {
    regex: /\bi\s+(?:love|adore|cherish)\s+([a-z]+)/i,
    pattern: 'emotional_love',
    confidence: 0.82,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  {
    regex: /\b([a-z]+)\s+(?:is|are)\s+(?:so\s+)?(?:amazing|wonderful|great|awesome|fantastic|incredible)/i,
    pattern: 'emotional_admiration',
    confidence: 0.80,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  // Personal statements
  {
    regex: /\bi\s+(?:want|wish|hope)\s+(.+)/i,
    pattern: 'personal_goal',
    confidence: 0.75,
    entityExtractor: (match) => match[1]?.substring(0, 50) || null
  },
  {
    regex: /\bi\s+(?:like|enjoy|love)\s+(.+)/i,
    pattern: 'personal_preference',
    confidence: 0.75,
    entityExtractor: (match) => match[1]?.substring(0, 50) || null
  },
  // Life events
  {
    regex: /\b([a-z]+)\s+(?:died|passed away|is gone|is dead)/i,
    pattern: 'life_event_death',
    confidence: 0.90,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  {
    regex: /(?:^|\s)(?:i am|i'm)\s+(?:getting|going to be|getting ready to be)\s+married/i,
    pattern: 'life_event_marriage',
    confidence: 0.87,
    entityExtractor: (match) => null
  },
  {
    regex: /(?:^|\s)(?:i am|i'm|we are|we're)\s+(?:having|expecting|getting)\s+(?:a\s+)?(?:baby|son|daughter|child)/i,
    pattern: 'life_event_birth',
    confidence: 0.85,
    entityExtractor: (match) => null
  },
  // Dietary restrictions (high confidence - safety critical)
  {
    regex: /\bi am\s+(?:a\s+)?(vegan|vegetarian|pescatarian|kosher|halal)/i,
    pattern: 'dietary_restriction',
    confidence: 0.90,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  {
    regex: /\bi\s+(?:don't|dont|do not)\s+eat\s+([a-z\s]+)/i,
    pattern: 'dietary_restriction',
    confidence: 0.88,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  // Medical conditions (high confidence - safety critical)
  {
    regex: /\bi\s+(?:have|suffer from|deal with|live with)\s+(diabetes|asthma|anxiety|depression|[a-z\s]+)/i,
    pattern: 'medical_condition',
    confidence: 0.88,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  // Occupation (identity)
  {
    regex: /\bi\s+(?:am|work as)\s+(?:a\s+)?([a-z\s]+?)(?:\s+at\s+|\s+for\s+|$)/i,
    pattern: 'occupation',
    confidence: 0.80,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  // Location (important for context)
  {
    regex: /\bi\s+live\s+in\s+([a-z\s]+)/i,
    pattern: 'location_home',
    confidence: 0.85,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  // Birthday (identity milestone)
  {
    regex: /\bmy birthday is\s+([a-z0-9\s,]+)/i,
    pattern: 'personal_birthday',
    confidence: 0.87,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  // Strong dislikes (preferences)
  {
    regex: /\bi\s+(?:hate|can't stand|despise|loathe)\s+([a-z\s]+)/i,
    pattern: 'strong_dislike',
    confidence: 0.78,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  // Phobias/fears (important for safety)
  {
    regex: /\bi\s+(?:am|have)\s+(?:afraid of|scared of|terrified of|phobic about)\s+([a-z\s]+)/i,
    pattern: 'fear_phobia',
    confidence: 0.82,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  // Life event - graduation
  {
    regex: /\bi\s+graduated\s+from\s+([a-z\s]+)/i,
    pattern: 'life_event_graduation',
    confidence: 0.83,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  },
  // Life event - moved/relocated
  {
    regex: /\bi\s+(?:moved to|relocated to|live in)\s+([a-z\s]+)/i,
    pattern: 'life_event_relocation',
    confidence: 0.80,
    entityExtractor: (match) => match[1]?.toLowerCase() || null
  }
];

const TRANSIENT_PATTERNS: RegExp[] = [
  // Alarms/timers/reminders
  /\b(?:set|create)\s+(?:an?\s+)?(?:alarm|timer|reminder)/i,
  /\bremind me\b/i,
  /\bwhat time\b/i,
  /\bweather\b/i,
  // Time queries
  /\b(?:what's|what is)\s+(?:the )?time\b/i,
  /\b(?:when|what day|what date)\b/i,
  /\b(?:how long|how many|how much)\b/i,
  // Temporary tasks/requests
  /\b(?:call|text|message|email)\s+\w+/i,
  /\b(?:buy|get|pick up|purchase)\s+/i,
  /\b(?:book|schedule|make|find)\s+(?:a\s+)?(?:flight|hotel|restaurant|appointment)/i,
  /\b(?:navigate|directions|route|how to get)/i,
  /\b(?:translate|what does|how do you say)\b/i,
  /\b(?:calculate|math|what's|what is)\s+\d+/i,
  // Current events/temporary info
  /\b(?:traffic|parking|bus|train|flight)\b/i,
  /\b(?:stock|crypto|price)\b/i,
  /\b(?:score|game|match|sport)\b/i,
  /\b(?:news|headline|breaking)\b/i,
  // Ephemeral personal requests
  /\b(?:tired|hungry|thirsty|cold|hot|sleepy)\b/i,
  /\b(?:hurts|aches|pain)\b/i,
  /\b(?:what should i|what do i|should i)\b/i,
  /\b(?:is it okay|is it safe|can i)\b/i
];

function detectPattern(input: string): PatternMatch | null {
  for (const pattern of FOUNDATIONAL_PATTERNS) {
    const match = input.match(pattern.regex);
    if (match) {
      const entity = pattern.entityExtractor(match, input);
      return {
        pattern: pattern.pattern,
        entity: entity,
        baseConfidence: pattern.confidence
      };
    }
  }
  return null;
}

function isTransient(input: string): boolean {
  return TRANSIENT_PATTERNS.some(pattern => pattern.test(input));
}

export function trackPattern(
  db: DatabaseManager,
  patternType: string,
  entity: string,
  baseConfidence: number
): { mentionCount: number; cumulativeConfidence: number; baseConfidence: number; shouldEvolve: boolean; isNew: boolean } {
  
  const database = db.getDatabase();
  const now = new Date().toISOString();
  const entityLower = entity.toLowerCase();
  const EVOLUTION_THRESHOLD = 0.95;
  
  const existing = database.prepare(`
    SELECT * FROM pattern_tracker 
    WHERE pattern_type = ? AND entity = ?
  `).get(patternType, entityLower) as PatternRecord | undefined;

  if (existing) {
    const newCount = existing.mention_count + 1;
    database.prepare(`
      UPDATE pattern_tracker 
      SET mention_count = ?, last_seen = ?
      WHERE id = ?
    `).run(newCount, now, existing.id);

    // FIXED: Use the ORIGINAL base_confidence from first detection
    const cumulative = Math.min(0.99, existing.base_confidence + ((newCount - 1) * 0.08));
    
    return {
      mentionCount: newCount,
      cumulativeConfidence: cumulative,
      baseConfidence: existing.base_confidence,
      shouldEvolve: cumulative >= EVOLUTION_THRESHOLD && !existing.evolved,
      isNew: false
    };
  } else {
    const id = randomUUID();
    database.prepare(`
      INSERT INTO pattern_tracker (id, pattern_type, entity, mention_count, base_confidence, first_seen, last_seen, evolved)
      VALUES (?, ?, ?, 1, ?, ?, ?, 0)
    `).run(id, patternType, entityLower, baseConfidence, now, now);

    return {
      mentionCount: 1,
      cumulativeConfidence: baseConfidence,
      baseConfidence: baseConfidence,
      shouldEvolve: false,
      isNew: true
    };
  }
}

export function findKnownEntity(db: DatabaseManager, input: string): { entity: PatternRecord; isEvolved: boolean } | null {
  const database = db.getDatabase();
  // Get ALL entities, including evolved ones (fixed: removed WHERE evolved = 0)
  const entities = database.prepare(`
    SELECT * FROM pattern_tracker 
    ORDER BY mention_count DESC
  `).all() as PatternRecord[];

  const inputLower = input.toLowerCase();
  
  for (const record of entities) {
    const entityRegex = new RegExp(`\\b${record.entity}\\b`, 'i');
    if (entityRegex.test(inputLower)) {
      return {
        entity: record,
        isEvolved: Boolean(record.evolved)
      };
    }
  }
  return null;
}

export function classifyMemory(db: DatabaseManager, input: string): ClassificationResult {
  const database = db.getDatabase();
  const inputLower = input.toLowerCase().trim();

  // Check for transient first (quick exit)
  if (isTransient(inputLower)) {
    return {
      tier: 'transient',
      confidence: 0.30,
      reason: 'Transient pattern detected (alarm/reminder/temporal)',
      pattern: 'transient_request',
      entity: null,
      schema_eligible: false,
      shouldEvolve: false
    };
  }

  // Try to detect foundational pattern
  const patternMatch = detectPattern(input);

  if (patternMatch && patternMatch.entity) {
    const tracked = trackPattern(
      db,
      patternMatch.pattern,
      patternMatch.entity,
      patternMatch.baseConfidence
    );

    const mentionText = tracked.mentionCount > 1 
      ? ` (${tracked.mentionCount} mentions)` 
      : '';

    return {
      tier: 'foundational',
      confidence: tracked.cumulativeConfidence,
      reason: `Pattern: ${patternMatch.pattern}, Entity: ${patternMatch.entity}${mentionText}`,
      pattern: patternMatch.pattern,
      entity: patternMatch.entity,
      schema_eligible: tracked.cumulativeConfidence >= 0.80,
      shouldEvolve: tracked.shouldEvolve
    };
  }

  // Check if input mentions a known entity
  const known = findKnownEntity(db, inputLower);
  if (known) {
    const { entity: knownEntity, isEvolved } = known;
    
    // Still track mentions even for evolved entities
    const tracked = trackPattern(
      db,
      knownEntity.pattern_type,
      knownEntity.entity,
      knownEntity.base_confidence
    );

    const evolvedNote = isEvolved ? ' [EVOLVED]' : '';
    
    return {
      tier: 'episodic',
      confidence: tracked.cumulativeConfidence,
      reason: `References known entity: ${knownEntity.entity} (${tracked.mentionCount} total mentions)${evolvedNote}`,
      pattern: knownEntity.pattern_type,
      entity: knownEntity.entity,
      schema_eligible: false,  // Already evolved, no need to evolve again
      shouldEvolve: false      // Already evolved
    };
  }

  // Default to episodic
  return {
    tier: 'episodic',
    confidence: 0.50,
    reason: 'No specific pattern detected',
    pattern: null,
    entity: null,
    schema_eligible: false,
    shouldEvolve: false
  };
}
