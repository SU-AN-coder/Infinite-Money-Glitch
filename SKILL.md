---
name: Infinite Money Glitch
description: Self-sustaining autonomous agent on Sui blockchain
metadata:
  openclaw:
    requires:
      bins:
        - node
        - npx
      env:
        - SUI_PRIVATE_KEY
        - BOUNTY_PACKAGE_ID
        - BOUNTY_BOARD_ID
        - SEAL_PACKAGE_ID
    os:
      - macos
      - linux
      - windows
    emoji: 💰
---

# Infinite Money Glitch Agent

A self-sustaining agent that earns SUI through BountyBoard tasks,
spends SUI on Seal encryption and Walrus storage, and reports
profit/loss with on-chain proof.

## Usage

Run a single economic cycle: health-check → earn → spend → audit → verify → report.
