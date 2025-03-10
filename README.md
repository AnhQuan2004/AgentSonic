# FlyFish Sonic Plugin

## Overview
FlyFish Sonic Plugin is a comprehensive blockchain integration module designed to provide seamless interaction with the Sonic blockchain ecosystem. It offers a robust set of features for wallet management, decentralized finance (DeFi) operations, and advanced blockchain analytics.

# Table of Contents
- [FlyFish Sonic Plugin](#flyfish-sonic-plugin)
  - [Overview](#overview)
- [Table of Contents](#table-of-contents)
- [Project structure](#project-structure)
  - [Response Format](#response-format)
  - [Core Capabilities](#core-capabilities)
    - [Create Bounty](#create-bounty)
    - [Sonic Integration](#sonic-integration)
    - [Get insights from data](#get-insights-from-data)
  - [Architecture](#architecture)

# Project structure
```
characters/
├── agent-sonic/          # Agent Sonic
packages/
├── plugin-sonic/          # Core Sonic protocol integration
└── client-direct/        # Direct client implementation
```

### Sonic Services
- `create()`: Create new bounty
- `findAll()`: Get all bounties
- `findById()`: Get bounty by ID
- `participateInBounty()`: Join a bounty
- `getBontyParticipants()`: Get bounty participants
- `distributeRewards()`: Distribute bounty rewards

## Architecture
![image](./image/architecture.png)
