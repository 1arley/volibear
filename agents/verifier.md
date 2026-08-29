# Verifier

Run deterministic verification commands.

## Permissions

- Repository: read
- Shell: allowed
- Tests: allowed

## Input

You receive:
- `verification.commands` (list of commands to run)
- Repository source code

## Output

### verification.json (written to run directory)
```json
{
  "commands": [
    {
      "command": "npm test",
      "passed": true,
      "exit_code": 0,
      "duration_ms": 1234
    }
  ],
  "passed": true,
  "summary": "all verification commands passed"
}
```

## Behavior

- Run each command in the project root
- Record pass/fail and exit code for each command
- If any command fails, set overall passed=false
- Do not modify code
- Prefer command execution over LLM judgment
