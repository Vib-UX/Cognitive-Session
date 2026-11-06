// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CCIP, IRouterClient} from "./interfaces/CCIP.sol";

/// @notice Locks equal ETH stakes on the source chain and sends the result over CCIP.
contract SessionLock {
    error NotPlayer();
    error BadStake();
    error AlreadyDeposited();
    error MatchMissing();
    error NotReady();
    error AlreadySettled();
    error DeadlinePassed();
    error BadResult();
    error RefundUnavailable();
    error NotOwner();

    struct MatchEscrow {
        address playerA;
        address playerB;
        uint256 stake;
        bool depositedA;
        bool depositedB;
        uint64 deadline;
        bool settled;
    }

    enum Outcome {
        None,
        PlayerA,
        PlayerB,
        Draw
    }

    IRouterClient public immutable router;
    uint64 public immutable destinationChainSelector;
    address public owner;
    address public payoutReceiver;
    address public referee;

    mapping(bytes32 matchId => MatchEscrow) public matches;

    event MatchOpened(bytes32 indexed matchId, address playerA, address playerB, uint256 stake, uint64 deadline);
    event Deposited(bytes32 indexed matchId, address player, uint256 amount);
    event Settled(bytes32 indexed matchId, Outcome outcome, bytes32 ccipMessageId);
    event Refunded(bytes32 indexed matchId, address player, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address router_, uint64 destinationChainSelector_, address payoutReceiver_, address referee_) {
        owner = msg.sender;
        router = IRouterClient(router_);
        destinationChainSelector = destinationChainSelector_;
        payoutReceiver = payoutReceiver_;
        referee = referee_;
    }

    function setPayoutReceiver(address payoutReceiver_) external onlyOwner {
        payoutReceiver = payoutReceiver_;
    }

    function setReferee(address referee_) external onlyOwner {
        referee = referee_;
    }

    function open(bytes32 matchId, address playerA, address playerB, uint256 stake, uint64 deadline) external {
        MatchEscrow storage m = matches[matchId];
        if (m.playerA != address(0)) revert AlreadyDeposited();
        if (playerA == address(0) || playerB == address(0) || playerA == playerB) revert NotPlayer();
        if (stake == 0) revert BadStake();
        if (deadline <= block.timestamp) revert DeadlinePassed();

        matches[matchId] = MatchEscrow({
            playerA: playerA,
            playerB: playerB,
            stake: stake,
            depositedA: false,
            depositedB: false,
            deadline: deadline,
            settled: false
        });
        emit MatchOpened(matchId, playerA, playerB, stake, deadline);
    }

    /// @notice Open (if needed) and deposit. msg.value must equal the match stake.
    function deposit(bytes32 matchId, address playerA, address playerB) external payable {
        MatchEscrow storage m = matches[matchId];
        if (m.playerA == address(0)) {
            if (msg.value == 0) revert BadStake();
            matches[matchId] = MatchEscrow({
                playerA: playerA,
                playerB: playerB,
                stake: msg.value,
                depositedA: false,
                depositedB: false,
                deadline: uint64(block.timestamp + 1 hours),
                settled: false
            });
            m = matches[matchId];
            emit MatchOpened(matchId, playerA, playerB, msg.value, m.deadline);
        }

        if (msg.sender != m.playerA && msg.sender != m.playerB) revert NotPlayer();
        if (msg.value != m.stake) revert BadStake();
        if (m.settled) revert AlreadySettled();

        if (msg.sender == m.playerA) {
            if (m.depositedA) revert AlreadyDeposited();
            m.depositedA = true;
        } else {
            if (m.depositedB) revert AlreadyDeposited();
            m.depositedB = true;
        }
        emit Deposited(matchId, msg.sender, msg.value);
    }

    function bothDeposited(bytes32 matchId) external view returns (bool) {
        MatchEscrow storage m = matches[matchId];
        return m.depositedA && m.depositedB;
    }

    function settleMutual(bytes32 matchId, Outcome outcome, bytes calldata sigA, bytes calldata sigB)
        external
        returns (bytes32 messageId)
    {
        MatchEscrow storage m = matches[matchId];
        if (m.playerA == address(0)) revert MatchMissing();
        if (!(m.depositedA && m.depositedB)) revert NotReady();
        if (m.settled) revert AlreadySettled();
        if (outcome == Outcome.None) revert BadResult();

        bytes32 digest = _digest(matchId, outcome);
        if (_recover(digest, sigA) != m.playerA) revert NotPlayer();
        if (_recover(digest, sigB) != m.playerB) revert NotPlayer();

        return _settleAndSend(matchId, m, outcome);
    }

    function settleReferee(bytes32 matchId, Outcome outcome, bytes calldata sig)
        external
        returns (bytes32 messageId)
    {
        MatchEscrow storage m = matches[matchId];
        if (m.playerA == address(0)) revert MatchMissing();
        if (!(m.depositedA && m.depositedB)) revert NotReady();
        if (m.settled) revert AlreadySettled();
        if (outcome == Outcome.None) revert BadResult();
        if (_recover(_digest(matchId, outcome), sig) != referee) revert NotPlayer();

        return _settleAndSend(matchId, m, outcome);
    }

    function refund(bytes32 matchId) external {
        MatchEscrow storage m = matches[matchId];
        if (m.playerA == address(0)) revert MatchMissing();
        if (m.settled) revert AlreadySettled();
        if (block.timestamp < m.deadline) revert RefundUnavailable();
        if (m.depositedA && m.depositedB) revert RefundUnavailable();

        m.settled = true;
        if (m.depositedA) {
            m.depositedA = false;
            _send(m.playerA, m.stake);
            emit Refunded(matchId, m.playerA, m.stake);
        }
        if (m.depositedB) {
            m.depositedB = false;
            _send(m.playerB, m.stake);
            emit Refunded(matchId, m.playerB, m.stake);
        }
    }

    function _settleAndSend(bytes32 matchId, MatchEscrow storage m, Outcome outcome)
        internal
        returns (bytes32 messageId)
    {
        m.settled = true;
        uint256 amount = m.stake * 2;

        CCIP.EVM2AnyMessage memory message = CCIP.EVM2AnyMessage({
            receiver: abi.encode(payoutReceiver),
            data: abi.encode(matchId, m.playerA, m.playerB, amount, uint8(outcome)),
            tokenAmounts: new CCIP.EVMTokenAmount[](0),
            extraArgs: CCIP.extraArgsV1(200_000),
            feeToken: address(0)
        });

        uint256 fee = router.getFee(destinationChainSelector, message);
        messageId = router.ccipSend{value: amount + fee}(destinationChainSelector, message);
        emit Settled(matchId, outcome, messageId);
    }

    function _digest(bytes32 matchId, Outcome outcome) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n52", matchId, uint8(outcome)));
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert NotPlayer();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        return ecrecover(digest, v, r, s);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "send failed");
    }

    receive() external payable {}
}
