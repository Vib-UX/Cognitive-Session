// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CCIP, IAny2EVMMessageReceiver} from "./interfaces/CCIP.sol";

/// @notice Receives a SessionLock CCIP message and pays the winner (or splits a draw).
contract SessionPayout is IAny2EVMMessageReceiver {
    error NotRouter();
    error BadSource();
    error BadSender();
    error AlreadySettled();
    error BadOutcome();
    error NotOwner();

    address public owner;
    address public immutable router;
    uint64 public immutable expectedSourceChainSelector;
    address public expectedSender;

    mapping(bytes32 matchId => bool) public settled;
    mapping(bytes32 matchId => address winner) public winners;

    event Paid(bytes32 indexed matchId, address indexed to, uint256 amount, uint8 outcome);
    event Split(bytes32 indexed matchId, address playerA, address playerB, uint256 each);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address router_, uint64 expectedSourceChainSelector_, address expectedSender_) {
        owner = msg.sender;
        router = router_;
        expectedSourceChainSelector = expectedSourceChainSelector_;
        expectedSender = expectedSender_;
    }

    function setExpectedSender(address expectedSender_) external onlyOwner {
        expectedSender = expectedSender_;
    }

    /// @dev Called by the CCIP router (or our mock in tests).
    function ccipReceive(Any2EVMMessage calldata message) external override {
        if (msg.sender != router) revert NotRouter();
        if (message.sourceChainSelector != expectedSourceChainSelector) revert BadSource();

        address sender = abi.decode(message.sender, (address));
        if (sender != expectedSender) revert BadSender();

        (bytes32 matchId, address playerA, address playerB, uint256 amount, uint8 outcome) =
            abi.decode(message.data, (bytes32, address, address, uint256, uint8));

        if (settled[matchId]) revert AlreadySettled();
        settled[matchId] = true;

        if (outcome == 1) {
            winners[matchId] = playerA;
            _send(playerA, amount);
            emit Paid(matchId, playerA, amount, outcome);
        } else if (outcome == 2) {
            winners[matchId] = playerB;
            _send(playerB, amount);
            emit Paid(matchId, playerB, amount, outcome);
        } else if (outcome == 3) {
            uint256 each = amount / 2;
            _send(playerA, each);
            _send(playerB, amount - each);
            emit Split(matchId, playerA, playerB, each);
        } else {
            revert BadOutcome();
        }
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "send failed");
    }

    receive() external payable {}
}
