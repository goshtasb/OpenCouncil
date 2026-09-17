# Project Constitution & Architectural Invariants

This document defines the non-negotiable architectural laws and engineering standards for this repository. Every Open Councilmen draft and PRD must adhere strictly to these principles.

## 1. Single Source of Truth
- State, routing, schema declarations, and business definitions must reside in exactly one authoritative location.
- No shadow data models, parallel arrays, or duplicate configuration maps.

## 2. Guards Wrap Outcomes, Not Entry Points
- Security, authorization, and invariant validation must wrap the point of execution or data persistence.
- Any degraded or fallback path must fail closed safely rather than bypassing invariant checks.

## 3. Structural Solutions Over Symptom Patching
- Always address the underlying class of defect rather than hardcoding special cases for individual error payloads.

## 4. Verifiable & Observable Telemetry
- Logged state, metrics, and event emissions must match what actually executed in the runtime.
- Never report simulated success when an operation was bypassed or failed silently.

## 5. Fixed Means Tested
- Every bug fix requires an automated reproduction test that demonstrably fails before the change and passes after.
- A pull request is not ready for review until the entire regression suite passes cleanly.
