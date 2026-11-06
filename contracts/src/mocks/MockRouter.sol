// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CCIP, IRouterClient, IAny2EVMMessageReceiver} from "../interfaces/CCIP.sol";
import {IERC20} from "../interfaces/IERC20.sol";

/// @dev Local fork / unit-test router that immediately delivers to the receiver.
contract MockRouter is IRouterClient {
    uint256 public fee = 0.0001 ether;
    bytes32 public lastMessageId;

    function setFee(uint256 fee_) external {
        fee = fee_;
    }

    function getFee(uint64, CCIP.EVM2AnyMessage memory) external view returns (uint256) {
        return fee;
    }

    function ccipSend(uint64 sourceAsDestIgnored, CCIP.EVM2AnyMessage memory message)
        external
        payable
        returns (bytes32 messageId)
    {
        sourceAsDestIgnored;
        messageId = keccak256(abi.encode(block.timestamp, message.data, msg.sender));
        lastMessageId = messageId;

        address receiver = abi.decode(message.receiver, (address));
        for (uint256 i = 0; i < message.tokenAmounts.length; i++) {
            CCIP.EVMTokenAmount memory token = message.tokenAmounts[i];
            if (token.amount == 0) continue;
            require(IERC20(token.token).transferFrom(msg.sender, receiver, token.amount), "token");
        }
        // Token-only CCIP 2.0 transfers deliver to an EOA and do not call back.
        if (message.data.length == 0) return messageId;

        uint256 forward = msg.value > fee ? msg.value - fee : 0;

        IAny2EVMMessageReceiver.Any2EVMMessage memory incoming = IAny2EVMMessageReceiver.Any2EVMMessage({
            messageId: messageId,
            sourceChainSelector: 10344971235874465080, // Base Sepolia selector (placeholder in local mock)
            sender: abi.encode(msg.sender),
            data: message.data,
            destTokenAmounts: new CCIP.EVMTokenAmount[](0)
        });

        if (forward > 0) {
            (bool ok,) = receiver.call{value: forward}("");
            require(ok, "fund receiver");
        }
        IAny2EVMMessageReceiver(receiver).ccipReceive(incoming);
    }
}
