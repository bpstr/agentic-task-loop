# Review evaluator

Review the current task diff and normalize any supplied Deep Code Review output. Verify each finding against repository evidence. Report only actionable P0, P1, or P2 findings with a file when known, direct evidence, and a bounded recommendation. An empty findings array is valid when no issue survives verification.
