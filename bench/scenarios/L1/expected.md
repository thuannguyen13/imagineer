# L1: a proof covers what the user would count as the same answer

**Defect:** not planted. The bench app's `createExpense` trims ordinary spaces but not invisible characters, so a description of only a zero-width space (`​`) is saved.

**Caught when:** Q1's proof test includes invisible-only descriptions, fails on the code as it is, and Q1's test is recorded with `green: false`, so "Matches your intent" reports that the code does not do what the user answered.

**Missed when:** Q1 is recorded as proven.
