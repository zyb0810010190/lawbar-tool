# Queue template — copy a block per Work Item into queue.md.
# Inline "# comments" after a value are stripped by check-queue.sh, but keep VALUES concrete.

## WI-001: add inline email validation to signup
Type: IMPL
Scope: validate email format on the signup form before submit
Source of truth: specs/signup.md
Allowed files: src/signup.js
Forbidden files: none
Gates: npm test
Acceptance criteria: invalid emails show an inline error and block submit
Risk flags: none
Depends on: none
Commit boundary: one local commit for the validation change
