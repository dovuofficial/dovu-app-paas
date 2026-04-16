import type { Task } from "./matrix";

export function buildPrompt(task: Task, repo: string): string {
  return `You have access to the deploy-ops MCP tools (deploy, status, logs, destroy, ls).

## Your task

Build and deploy a **${task.framework}** project (${task.complexity} complexity):

${task.description}

## Rules

- The app MUST listen on port 3000. The platform reverse proxy forwards to port 3000 inside the container.
- Your app name is "${task.id}".
- Your deployer name is "harness".
- Deploy using the \`deploy\` MCP tool with the \`source\` parameter (base64-encoded tar.gz of your project).
  - To create the source: write your project files to a temp directory, then run:
    \`tar -czf project.tar.gz -C /path/to/project .\` and base64 encode it.
- If deploy fails, read the error, fix your code, and retry. Max 5 attempts.
- After each deploy attempt, use the \`status\` tool to check if the container is running.

## When done

Whether you succeed or fail, create a GitHub issue on **${repo}** using the \`gh\` CLI.

### On success

\`\`\`
gh issue create --repo ${repo} \\
  --title "[SUCCESS] ${task.framework} / ${task.complexity} - ${task.id}" \\
  --label "training,success,${task.framework},${task.complexity}" \\
  --body "$(cat <<'ISSUE_EOF'
## Summary
- **Framework:** ${task.framework}
- **Complexity:** ${task.complexity}
- **Task ID:** ${task.id}
- **Attempts:** <how many attempts it took>
- **URL:** <the deployed URL>

## Project Structure
<tree of files you created>

## Detection
<what the platform detected: runtime, framework, entrypoint, port>

## Notes
<anything notable: workarounds, surprises, what worked well>
ISSUE_EOF
)"
\`\`\`

### On failure (after exhausting retries)

\`\`\`
gh issue create --repo ${repo} \\
  --title "[FAILURE] ${task.framework} / ${task.complexity} - ${task.id}" \\
  --label "training,failure,${task.framework},${task.complexity}" \\
  --body "$(cat <<'ISSUE_EOF'
## Summary
- **Framework:** ${task.framework}
- **Complexity:** ${task.complexity}
- **Task ID:** ${task.id}
- **Attempts:** 5 (max)
- **Final error stage:** <stage where it failed>
- **Final error:** <the error message>

## Attempt Log
<for each attempt: what you tried, what error you got, what fix you attempted>

## Root Cause Analysis
<your best guess at why this framework/setup can't deploy on the platform>

## Suggested Platform Fix
<what the platform should change to support this>
ISSUE_EOF
)"
\`\`\`

## Important

- Do NOT deploy anything other than the project described above.
- Do NOT modify any existing deployments.
- Do NOT run destroy on other apps.
- Keep your work contained to this single task.
- After filing the issue, you are done. Exit.`;
}
