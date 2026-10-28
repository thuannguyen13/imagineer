# F10 — merge=wait never marks Done
**Must:** state `awaiting_merge` after the PR opens; the issue stays open and not Done; after a manual merge, `/forge` resumes, sets `merged`, and only then is the issue Done.
