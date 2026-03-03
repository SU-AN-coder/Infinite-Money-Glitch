# Infinite Money Glitch

Autonomous local agent that **earns, secures, and proves** on Sui.

It combines:
- **OpenClaw** (local terminal/browser control),
- **Sui Move** (on-chain bounty logic),
- **Seal** (real encryption),
- **Walrus** (evidence/data persistence),

to run a verifiable cycle:

`health -> earn -> spend -> audit -> verify -> report`

---

## 1. Why this project

Traditional model:
- Human pays -> Agent executes.

Infinite Money Glitch model:
- Agent detects survival pressure -> earns rewards -> pays for security/storage -> outputs verifiable evidence.

This is designed for hackathon review where **working demo + verifiable proof** matters.

---

## 2. Core capabilities

- **Autonomous cycle orchestration**  
  Implemented by `Agent.runCycle()`.

- **Real earning path (not faucet-only narrative)**  
  Bounty-driven earning + extensible earning modes.

- **Real security workload**  
  Static/security audit mode via ESLint / npm audit / TypeScript checks.

- **Real spend path**  
  Encrypt with Seal and persist to Walrus.

- **End-to-end evidence**  
  JSON + Markdown evidence packages for human and machine verification.

---

## 3. Architecture

### 3.1 Runtime flow

1. Wallet init and health check  
2. Earn (bounty / mode execution)  
3. Spend (protection actions)  
4. Audit package generation  
5. On-chain/browser verification  
6. Profit/loss report

### 3.2 Execution model

- **Single-cycle execution** (cron-friendly, no infinite while loop)
- OpenClaw-first execution strategy
- Graceful degradation when dependencies are temporarily unavailable

---

## 4. Repository structure

```text
.
├── contracts/                 # Move package (bounty board)
├── docs/                      # Design + demo + readiness docs
├── evidence/                  # Generated evidence outputs
├── scripts/                   # Utility/debug scripts
├── src/
│   ├── agent/                 # Agent orchestration
│   ├── earn/                  # Earning engine + modes/extensions
│   ├── spend/                 # Seal/Walrus protection flow
│   ├── ledger/                # P&L and audit records
│   ├── evidence/              # Evidence collector
│   ├── tools/                 # preflight/deploy/evidence/ai-proof CLI
│   └── index.ts               # Main entry
├── deployment.json
├── ai-dev-proof.json
└── ai-dev-proof.md
```

---

## 5. Prerequisites

- Node.js >= 22
- npm
- Sui CLI (for contract deployment and chain operations)
- Testnet SUI balance
- OpenClaw gateway
- Valid `.env` configuration

---

## 6. Setup

```bash
npm install
```

Create and fill env:

```bash
cp .env.example .env
```

Then set real values for:
- wallet key
- OpenClaw endpoint/token
- deployed contract IDs
- Seal/Walrus related fields

---

## 7. NPM scripts

- `npm run start` — run entry flow (controlled by env mode flags)
- `npm run preflight` — environment checks (recommended before live run)
- `npm run typecheck` — TypeScript check
- `npm run test` — aggregated tests
- `npm run test:e2e` — mock e2e
- `npm run test:e2e:real` — real-path e2e
- `npm run contract:build` — build Move contract
- `npm run contract:test` — test Move contract
- `npm run contract:deploy` — deploy contract
- `npm run evidence:generate` — generate evidence package/report
- `npm run ai-proof` — generate AI development proof

---

## 8. Running modes

### 8.1 Demo mode

```bash
RUN_DEMO=true npm run start
```

### 8.2 Agent cycle mode (recommended for review)

```bash
RUN_AGENT=true COLLECT_EVIDENCE=true npm run start
npm run evidence:generate
```

### 8.3 Stability mode (earning reliability tuning)

```bash
RUN_AGENT=true \
COLLECT_EVIDENCE=true \
EARNER_AUTO_SEED_BOUNTY=true \
EARNER_FORCE_SEED_BOUNTY=true \
npm run start
```

---

## 9. Real verifiable flow (recommended sequence)

```bash
npm install
npm run preflight

npm run contract:build
npm run contract:test
npm run contract:deploy

npm run test:e2e:real

RUN_AGENT=true COLLECT_EVIDENCE=true EARNER_AUTO_SEED_BOUNTY=true EARNER_FORCE_SEED_BOUNTY=true npm run start
npm run evidence:generate

npm run ai-proof
```

Expected outputs:
- chain transaction digests
- Walrus blob records
- evidence JSON/Markdown
- AI proof JSON/Markdown

---

## 10. Evidence and audit artifacts

- `evidence/evidence-*.json`
- `evidence/evidence-report-*.md`
- `deployment.json`
- `ai-dev-proof.json`
- `ai-dev-proof.md`

These artifacts are used for reviewer replay and audit.

---

## 11. Extensible earning modes

Reserved for future monetization strategies:
- Airdrop / points farming
- DEX arbitrage
- Multi-board routing
- Additional on-chain/off-chain opportunities

Current interfaces and placeholders:
- `src/earn/modes/EarnMode.ts`
- `src/earn/modes/AirdropMode.ts`
- `src/earn/modes/ArbitrageMode.ts`
- `src/earn/modes/CodeAuditMode.ts`
- `src/earn/extensions/OpportunityExpansion.ts`

Design goal: add new mode with minimal impact on core cycle.

---

## 12. Security notes

- Use testnet/temporary keys for demo.
- Never commit `.env`.
- Rotate exposed secrets immediately.
- Keep least-privilege runtime settings where possible.

---

## 13. Documentation index

- `docs/00-redesign-proposal.md`
- `docs/01-wallet-module.md`
- `docs/02-earner-module.md`
- `docs/03-spender-module.md`
- `docs/04-ledger-module.md`
- `docs/05-agent-module.md`
- `docs/06-demo-plan.md`
- `docs/07-hackathon-readiness-report.md`

---

## 14. Hackathon submission checklist

- [ ] Public repository
- [ ] 90-second demo video
- [ ] `deployment.json`
- [ ] clean-positive evidence set
- [ ] `ai-dev-proof.json` + `ai-dev-proof.md`
- [ ] updated README
- [ ] readiness report

---

## 15. License

MIT
