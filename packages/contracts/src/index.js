import { z } from "zod";

const ExternalLinkUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => /^https?:\/\//i.test(value) || value.startsWith("/"),
    "url must be an absolute http(s) URL or a root-relative path"
  );

export const BuiltinUtilEnum = z.enum([
  "cipherDecoder",
  "baseConverter",
  "encodingChain",
  "frequencyAnalyzer",
  "hashCalculator",
  "subnetCalculator",
  "bitwiseCalculator",
  "hexViewer",
  "codeWorkspace",
  "pythonInterpreter",
  "codeVerifier"
]);

export const PuzzleExternalLinkSchema = z.object({
  label: z.string().min(1),
  url: ExternalLinkUrlSchema,
  openInNewTab: z.boolean().optional().default(true),
  bypassAntiCheat: z.boolean().optional().default(true),
  download: z.boolean().optional().default(false)
});

export const PuzzleToolConfigSchema = z.object({
  builtinUtils: z.array(BuiltinUtilEnum).default([]),
  externalLinks: z.array(PuzzleExternalLinkSchema).default([]),
  isInspectPuzzle: z.boolean().default(false),
  isolatedUrl: z.string().nullable().default(null)
});

export const TeamSessionRequestSchema = z.object({
  teamCode: z.string().trim().min(2).max(32),
  teamName: z.string().trim().min(2).max(120)
});

export const TeamSummarySchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  isAdmin: z.boolean().default(false)
});

export const TeamSessionResponseSchema = z.object({
  ok: z.literal(true),
  team: TeamSummarySchema
});

export const EventStateResponseSchema = z.object({
  ok: z.literal(true),
  event: z.object({
    id: z.string(),
    name: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    startedAt: z.string().nullable(),
    isStarted: z.boolean(),
    puzzleCount: z.number().int().positive(),
    frozenPuzzleCount: z.number().int().nonnegative()
  }),
  competition: z.object({
    isPaused: z.boolean(),
    pausedAt: z.string().nullable(),
    isTimeUp: z.boolean()
  }),
  penaltiesPoints: z.number().int().nonnegative(),
  remainingSeconds: z.number().int().nonnegative(),
  enforcement: z.object({
    warnings: z.number().int().nonnegative(),
    maxWarnings: z.number().int().positive(),
    isLocked: z.boolean(),
    lockedAt: z.string().nullable(),
    isBanned: z.boolean(),
    bannedAt: z.string().nullable(),
    lifelineActive: z.boolean().default(false),
    lifelineExpiresAt: z.string().nullable().default(null),
    lifelineRemainingSeconds: z.number().int().nonnegative().default(0),
    lifelinePuzzleId: z.string().nullable().default(null),
    lifelinesRemaining: z.number().int().nonnegative().default(2)
  }),
  now: z.string()
});

export const LifelineActivateRequestSchema = z.object({
  puzzleId: z.string().trim().min(1)
});

export const LifelinePuzzleSwitchRequestSchema = z.object({
  puzzleId: z.string().trim().min(1).optional().nullable()
});

export const PuzzleListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  type: z.string(),
  orderIndex: z.number().int(),
  status: z.enum(["unsolved", "attempted", "solved"]),
  toolConfig: PuzzleToolConfigSchema
});

export const HintTierSchema = z.enum(["tier1", "tier2", "tier3"]);

export const PuzzleHintSchema = z.object({
  id: z.string(),
  tier: HintTierSchema,
  content: z.string(),
  penaltyPoints: z.number().int().nonnegative()
});

export const PuzzleDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  type: z.string(),
  prompt: z.string(),
  orderIndex: z.number().int(),
  toolConfig: PuzzleToolConfigSchema,
  hints: z.array(PuzzleHintSchema),
  progress: z.object({
    status: z.enum(["unsolved", "attempted", "solved"]),
    attempts: z.number().int().nonnegative(),
    solvedAt: z.string().nullable(),
    canAdvance: z.boolean(),
    canSkip: z.boolean(),
    isCurrent: z.boolean()
  })
});

export const PuzzleListResponseSchema = z.object({
  ok: z.literal(true),
  puzzles: z.array(PuzzleListItemSchema),
  currentPuzzleId: z.string().nullable(),
  currentPuzzleIndex: z.number().int().nonnegative(),
  totalPuzzles: z.number().int().nonnegative(),
  canAdvance: z.boolean(),
   canSkip: z.boolean(),
  isStarted: z.boolean(),
  isFinished: z.boolean()
});

export const PuzzleDetailResponseSchema = z.object({
  ok: z.literal(true),
  puzzle: PuzzleDetailSchema
});

export const NotepadUpsertRequestSchema = z.object({
  content: z.string().max(100000)
});

export const NotepadResponseSchema = z.object({
  ok: z.literal(true),
  puzzleId: z.string(),
  content: z.string(),
  updatedAt: z.string().nullable()
});

export const ClipboardCreateRequestSchema = z.object({
  value: z.string().min(1).max(4000),
  source: z.string().trim().min(1).max(120).default("manual")
});

export const ClipboardEntrySchema = z.object({
  id: z.string(),
  value: z.string(),
  source: z.string(),
  createdAt: z.string()
});

export const ClipboardResponseSchema = z.object({
  ok: z.literal(true),
  entries: z.array(ClipboardEntrySchema).max(5)
});

export const HintRevealResponseSchema = z.object({
  ok: z.literal(true),
  hint: PuzzleHintSchema,
  penaltyAppliedPoints: z.number().int().nonnegative(),
  totalPenaltyPoints: z.number().int().nonnegative()
});

export const PuzzleSubmitRequestSchema = z.object({
  answer: z.string().trim().min(1).max(500)
});

export const PuzzleSubmitResponseSchema = z.object({
  ok: z.literal(true),
  result: z.enum(["correct", "incorrect"]),
  message: z.string(),
  status: z.enum(["unsolved", "attempted", "solved"]),
  answer: z.string(),
  canAdvance: z.boolean(),
  currentPuzzleId: z.string().nullable(),
  currentPuzzleIndex: z.number().int().nonnegative()
});

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  team: TeamSummarySchema,
  points: z.number().int().nonnegative(),
  hintPenaltyPoints: z.number().int().nonnegative(),
  totalElapsedSeconds: z.number().int().nonnegative().nullable(),
  lastCorrectAt: z.string().nullable()
});

export const LeaderboardResponseSchema = z.object({
  ok: z.literal(true),
  generatedAt: z.string(),
  leaderboard: z.array(LeaderboardEntrySchema)
});

export const ProgressItemSchema = z.object({
  puzzleId: z.string(),
  title: z.string(),
  status: z.enum(["unsolved", "attempted", "solved"])
});

export const ProgressResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(ProgressItemSchema),
  currentPuzzleId: z.string().nullable(),
  currentPuzzleIndex: z.number().int().nonnegative(),
  totalPuzzles: z.number().int().nonnegative(),
  canAdvance: z.boolean(),
  canSkip: z.boolean(),
  isStarted: z.boolean(),
  isFinished: z.boolean()
});

export const AdminEventSettingsUpdateSchema = z.object({
  puzzleCount: z.number().int().min(20).max(26)
});

export const AdminPuzzleToolConfigUpdateSchema = z.object({
  builtinUtils: z.array(BuiltinUtilEnum).optional(),
  externalLinks: z.array(PuzzleExternalLinkSchema).optional(),
  isInspectPuzzle: z.boolean().optional(),
  isolatedUrl: z.string().nullable().optional()
});

export const AdminPuzzlePenaltyUpdateSchema = z.object({
  hintPenaltySeconds: z.number().int().min(0).max(3600)
});

export const AdminPuzzleMetadataUpdateSchema = z.object({
  slug: z.string().trim().min(3).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  title: z.string().trim().min(3).max(180).optional(),
  type: z.string().trim().min(2).max(100).optional(),
  prompt: z.string().trim().min(10).max(30000).optional(),
  answerKey: z.string().trim().min(1).max(500).optional()
});

export const AdminPuzzleCreateSchema = z.object({
  targetTeamId: z.string().trim().min(1).nullable().optional(),
  slug: z.string().trim().min(3).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(3).max(180),
  type: z.string().trim().min(2).max(100),
  prompt: z.string().trim().min(10).max(30000),
  answerKey: z.string().trim().min(1).max(500),
  hintPenaltySeconds: z.number().int().min(0).max(3600),
  builtinUtils: z.array(BuiltinUtilEnum).default([]),
  externalLinks: z.array(PuzzleExternalLinkSchema).default([]),
  isInspectPuzzle: z.boolean().default(false),
  isolatedUrl: z.string().trim().min(1).nullable().optional(),
  hints: z
    .array(
      z.object({
        tier: HintTierSchema,
        content: z.string().trim().min(1).max(2000),
        penaltySeconds: z.number().int().min(0).max(3600)
      })
    )
    .length(3)
});

export const AdminHintUpdateSchema = z.object({
  content: z.string().min(1).optional(),
  penaltySeconds: z.number().int().min(0).max(3600).optional()
});

export function parseWithSchema(schema, value) {
  return schema.parse(value);
}
