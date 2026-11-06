export const SESSION_LOCK_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "playerA", type: "address" },
      { name: "playerB", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "open",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "playerA", type: "address" },
      { name: "playerB", type: "address" },
      { name: "stake", type: "uint256" },
      { name: "deadline", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "matches",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "bytes32" }],
    outputs: [
      { name: "playerA", type: "address" },
      { name: "playerB", type: "address" },
      { name: "stake", type: "uint256" },
      { name: "depositedA", type: "bool" },
      { name: "depositedB", type: "bool" },
      { name: "deadline", type: "uint64" },
      { name: "settled", type: "bool" },
    ],
  },
] as const;

export const SESSION_PAYOUT_ABI = [
  {
    type: "function",
    name: "settled",
    stateMutability: "view",
    inputs: [{ name: "matchId", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
] as const;
