import { describe, it, expect } from "vitest";
import type {
  EvolveConfig,
  Proposal,
  ArchitectProposal,
  IterationLog,
  LoopProgressEvent,
  KnowledgePattern,
  ResearchConfig,
  ResearchReport,
  ResearchProgressEvent,
  EvolutionReport,
  Mutation,
  Score,
} from "../types.js";

describe("evolve types", () => {
  describe("EvolveConfig", () => {
    it("includes architect scheduling fields", () => {
      const config: EvolveConfig = {
        model: "claude-sonnet-4-6",
        proposerModel: "claude-opus-4-6",
        scorer: "pass-fail",
        maxIterations: 5,
        parallelTasks: 1,
        runsPerTask: 1,
        maxMutationsPerIteration: 3,
        pruneThreshold: 95,
        maxTaskDrop: 20,
        usePrincipal: false,
        evalSampleSize: 0,
        samplingStrategy: "thompson",
        klLambda: 0.1,
        pbtBranches: 3,
        architectEvery: 3,
        schedule: "explore-exploit",
        architectModel: "claude-opus-4-6",
      };

      expect(config.architectEvery).toBe(3);
      expect(config.schedule).toBe("explore-exploit");
      expect(config.architectModel).toBe("claude-opus-4-6");
    });

    it("accepts all valid schedule types", () => {
      const schedules: EvolveConfig["schedule"][] = [
        "explore-exploit",
        "constant",
        "adaptive",
      ];
      expect(schedules).toHaveLength(3);
    });
  });

  describe("ArchitectProposal", () => {
    it("extends Proposal with structural and source fields", () => {
      const proposal: ArchitectProposal = {
        reasoning: "Restructure the harness for better modularity",
        mutations: [
          {
            file: "CLAUDE.md",
            action: "replace",
            oldText: "old",
            newText: "new",
            rationale: "improve structure",
          },
        ],
        expectedImpact: { "task-1": "better modularity" },
        structural: true,
        source: "architect",
      };

      expect(proposal.structural).toBe(true);
      expect(proposal.source).toBe("architect");
      // Verify it still has Proposal fields
      expect(proposal.reasoning).toBe(
        "Restructure the harness for better modularity",
      );
      expect(proposal.mutations).toHaveLength(1);
    });
  });

  describe("IterationLog", () => {
    it("supports optional source field", () => {
      const log: IterationLog = {
        iteration: 1,
        score: 0.85,
        taskResults: {},
        proposal: null,
        diffPatch: null,
        timestamp: new Date().toISOString(),
        source: "architect",
      };

      expect(log.source).toBe("architect");
    });

    it("allows source to be omitted", () => {
      const log: IterationLog = {
        iteration: 0,
        score: 0.5,
        taskResults: {},
        proposal: null,
        diffPatch: null,
        timestamp: new Date().toISOString(),
      };

      expect(log.source).toBeUndefined();
    });
  });

  describe("LoopProgressEvent", () => {
    it("supports architect event types", () => {
      const events: LoopProgressEvent[] = [
        { type: "architect-start", iteration: 3 },
        {
          type: "architect-staging",
          iteration: 3,
          message: "Staging architect proposal",
        },
        {
          type: "architect-accepted",
          iteration: 3,
          score: 0.9,
          message: "Architect proposal accepted",
        },
        {
          type: "architect-rejected",
          iteration: 3,
          score: 0.4,
          message: "Architect proposal rejected",
        },
      ];

      expect(events[0].type).toBe("architect-start");
      expect(events[1].type).toBe("architect-staging");
      expect(events[2].type).toBe("architect-accepted");
      expect(events[3].type).toBe("architect-rejected");
    });
  });

  describe("KnowledgePattern", () => {
    it("has all required fields", () => {
      const pattern: KnowledgePattern = {
        id: "kp_001",
        type: "universal",
        description: "Add explicit error handling instructions",
        mutation: {
          file: "CLAUDE.md",
          action: "add_section",
          newText: "## Error Handling\nAlways use try/catch...",
          rationale: "Improves error recovery across all tasks",
        },
        evidence: {
          repos_tested: 10,
          repos_helped: 8,
          mean_score_delta: 0.15,
          languages: ["typescript", "python"],
        },
        discovered_at: "2026-04-01T00:00:00Z",
        last_validated: "2026-04-03T00:00:00Z",
      };

      expect(pattern.id).toBe("kp_001");
      expect(pattern.type).toBe("universal");
      expect(pattern.evidence.repos_tested).toBe(10);
      expect(pattern.evidence.languages).toContain("typescript");
      expect(pattern.rejected).toBeUndefined();
    });

    it("supports rejected field", () => {
      const pattern: KnowledgePattern = {
        id: "kp_002",
        type: "framework",
        description: "Add React-specific hooks guidance",
        mutation: {
          file: ".claude/rules/react.md",
          action: "create_file",
          newText: "# React Hooks\n...",
          rationale: "Framework-specific guidance",
        },
        evidence: {
          repos_tested: 5,
          repos_helped: 1,
          mean_score_delta: -0.05,
          languages: ["typescript"],
        },
        discovered_at: "2026-04-01T00:00:00Z",
        last_validated: "2026-04-03T00:00:00Z",
        rejected: true,
      };

      expect(pattern.rejected).toBe(true);
    });

    it("accepts all valid pattern types", () => {
      const types: KnowledgePattern["type"][] = [
        "universal",
        "language",
        "framework",
        "project",
      ];
      expect(types).toHaveLength(4);
    });
  });

  describe("ResearchConfig", () => {
    it("has required fields", () => {
      const config: ResearchConfig = {
        repos: ["https://github.com/user/repo1", "https://github.com/user/repo2"],
        iterationsPerRepo: 10,
        convergenceThreshold: 0.7,
      };

      expect(config.repos).toHaveLength(2);
      expect(config.iterationsPerRepo).toBe(10);
      expect(config.convergenceThreshold).toBe(0.7);
      expect(config.outputPath).toBeUndefined();
    });

    it("supports optional outputPath", () => {
      const config: ResearchConfig = {
        repos: [],
        iterationsPerRepo: 5,
        convergenceThreshold: 0.5,
        outputPath: "/tmp/research-output",
      };

      expect(config.outputPath).toBe("/tmp/research-output");
    });
  });

  describe("ResearchReport", () => {
    it("has all required sections", () => {
      const report: ResearchReport = {
        universal: [],
        languageSpecific: {
          typescript: [],
          python: [],
        },
        failed: [],
        repoResults: [
          { repo: "repo1", bestScore: 0.85, patternsFound: 3 },
        ],
      };

      expect(report.universal).toEqual([]);
      expect(report.languageSpecific).toHaveProperty("typescript");
      expect(report.failed).toEqual([]);
      expect(report.repoResults[0].bestScore).toBe(0.85);
    });
  });

  describe("ResearchProgressEvent", () => {
    it("supports all event types", () => {
      const events: ResearchProgressEvent[] = [
        { type: "repo-start", repo: "repo1", repoIndex: 0, totalRepos: 3 },
        {
          type: "repo-complete",
          repo: "repo1",
          repoIndex: 0,
          totalRepos: 3,
          bestScore: 0.9,
        },
        {
          type: "convergence-analysis",
          message: "Analyzing convergence across repos",
        },
        { type: "research-complete", message: "Research complete" },
      ];

      expect(events).toHaveLength(4);
      expect(events[0].type).toBe("repo-start");
      expect(events[1].bestScore).toBe(0.9);
      expect(events[3].type).toBe("research-complete");
    });
  });

  describe("EvolutionReport iterations", () => {
    it("supports optional mode field in iteration entries", () => {
      const report: EvolutionReport = {
        overview: {
          title: "Test",
          totalIterations: 2,
          baselineScore: 0.5,
          bestScore: 0.9,
          bestIteration: 1,
          improvement: 0.4,
        },
        iterations: [
          { iteration: 0, score: 0.5, mutationCount: 0, status: "baseline" },
          {
            iteration: 1,
            score: 0.9,
            mutationCount: 3,
            status: "improved",
            mode: "architect",
          },
        ],
        leaderboard: [],
        counterfactuals: { entries: [] },
      };

      expect(report.iterations[0].mode).toBeUndefined();
      expect(report.iterations[1].mode).toBe("architect");
    });
  });
});
