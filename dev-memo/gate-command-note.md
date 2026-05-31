# Gate command note

The lawbar-tool quality gate run by the workflow lifecycle (and by
`scripts/workflow/check-gates.sh`) is the desktop app test suite:

```
npm --prefix apps/lawbar-desktop test
```

`check-gates.sh` runs exactly this command and exits non-zero on any failure, printing
`GATES OK` on success. It is the single gate every Work Item passes before commit.
