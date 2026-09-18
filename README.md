# Code walkthrough

Reading a finished PR rarely gives you the same understanding as building it yourself. When an AI agent writes the code, it's easy to miss the learning that happens along the way.

Code walkthrough is an agent skill that reconstructs a change step by step, as if you were watching someone write it and explain the design as they go. Follow the implementation from its starting point to the finished change, at your own pace.

[Try the live demo](https://abro.dev/code-walkthrough/)

## What you get

- A guided walkthrough in your browser, with explanations alongside incremental code changes.
- Source links, diffs, and a full repository tree to explore as you read.
- Support for pull requests, branches, commits, revision ranges, and uncommitted changes.

## Install

Copy or link the entire [`skills/code-walkthrough`](skills/code-walkthrough/) directory into your coding agent's skills directory as `code-walkthrough`.

<!-- TODO: Upload to skills.sh and add install command here:
```sh
npx skills add Alex979/code-walkthrough
```
-->

You'll need **Node.js 22+** and **Git** in the environment where your agent runs. Pull requests also require an authenticated GitHub CLI (`gh`). Your agent must be able to run a local server that your browser can reach. No build step is needed.

## Use

Ask your agent to use the skill in the repository you want to understand:

> /code-walkthrough PR #42.

> Generate a code walkthrough for this branch against main.

> Use code-walkthrough on these uncommitted changes.

The agent creates the lesson and gives you a local URL. Open it in your browser and advance through the implementation one step at a time.
