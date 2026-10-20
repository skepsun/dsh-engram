/**
 * Shared preset fixtures for the web-provision / CLI tests.
 *
 * A pruned slice of `@deepseek-ai/dsh-web-app/presets/standard.patch.yml`
 * (DSH ≥ 0.2.0): one patch operation, the preset declaration, and the
 * compaction group at 14/16/18 spaces. Indentation must match the real file
 * exactly — the whole point of the declarative-layout coverage is that rows are
 * located structurally, not by depth.
 */

export const DECLARATIVE_STOCK = `# Agent preset standard: one \`@deepseek-ai/dsh-agent-preset\` declaration inserted
# after the web patch. Edits saved from the Web editor override this row's
# \`config.plugins\` by id from the profile patch.
- insert:
    - id: preset-standard
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: standard
        order: 1
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              suffix: Your working directory is {{cwd}}.
          - id: compaction
            name: cordis:group
            group: true
            isolate:
              compaction: true
              toolResultPruner: true
            config:
              - id: compaction-basic
                name: '@deepseek-ai/dsh-compaction-basic'
              - id: command-compact
                name: '@deepseek-ai/dsh-command-compact'
              - id: tool-result-pruner
                name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
                config:
                  thresholdChars: 8192
          - id: delegation
            name: cordis:group
            group: true
            isolate:
              workflowEngine: true
            config:
              - id: tool-subagent-control
                name: '@deepseek-ai/dsh-tool-subagent-control'
`;

/** The `minimal` preset ships no compaction group at all. */
export const DECLARATIVE_MINIMAL = `- insert:
    - id: preset-minimal
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: minimal
        order: 3
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: You are a helpful software engineer assistant.
`;
