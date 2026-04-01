# Atlas AI Phase 2 — Card Engine + Channel Integration

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Implement the card rendering pipeline mapping AgentMessage to Feishu interactive cards.

**Architecture:** CardStateStore (state) -> CardRenderPipeline (render) -> FeishuCardRenderer (channel). MessageCorrelationStore links agent IDs to card IDs. StreamingStateMachine handles live text output.

**Tech Stack:** TypeScript 5.x strict ESM, Vitest, Zod

**Spec:** `docs/superpowers/specs/2026-03-30-atlas-ai-phase2-design.md`

---

## Task 1: CardStateStore

## Task 2: StreamBuffer + StreamingStateMachine

## Task 3: MessageCorrelationStore

## Task 4: CardRenderPipeline

## Task 5: ToolCardBuilder

## Task 6: PermissionCard + PayloadValidator

## Task 7: CardEngine

## Task 8: SessionManager

## Task 9: CommandRegistry

## Task 10: FeishuCardRenderer

## Task 11: FeishuAdapter

## Task 12: Engine orchestrator

## Task 13: Barrel exports + build verification
