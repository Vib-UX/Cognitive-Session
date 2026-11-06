// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal CCIP message types used by SessionLock / SessionPayout.
library CCIP {
    struct EVMTokenAmount {
        address token;
        uint256 amount;
    }

    /// @dev Field order matches Chainlink Client.EVM2AnyMessage. feeToken comes before extraArgs.
    struct EVM2AnyMessage {
        bytes receiver;
        bytes data;
        EVMTokenAmount[] tokenAmounts;
        address feeToken;
        bytes extraArgs;
    }

    bytes4 internal constant EXTRA_ARGS_V1_TAG = 0x97a657c9;
    bytes4 internal constant EXTRA_ARGS_V3_TAG = 0xa69dd4aa;

    function extraArgsV1(uint256 gasLimit) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, gasLimit);
    }

    /// @dev CCIP 2.0 basic ExtraArgsV3, packed the way ExtraArgsCodec does.
    /// 4-byte tag, uint32 gas, bytes4 finality (0 = wait for finality), then seven zero bytes
    /// for empty CCV, executor, and token-receiver fields. gasLimit 0 is a token transfer to an EOA.
    function extraArgsV3(uint32 gasLimit) internal pure returns (bytes memory) {
        return abi.encodePacked(EXTRA_ARGS_V3_TAG, gasLimit, bytes4(0), bytes7(0));
    }
}

interface IRouterClient {
    function getFee(uint64 destinationChainSelector, CCIP.EVM2AnyMessage memory message)
        external
        view
        returns (uint256 fee);

    function ccipSend(uint64 destinationChainSelector, CCIP.EVM2AnyMessage memory message)
        external
        payable
        returns (bytes32 messageId);
}

interface IAny2EVMMessageReceiver {
    struct Any2EVMMessage {
        bytes32 messageId;
        uint64 sourceChainSelector;
        bytes sender;
        bytes data;
        CCIP.EVMTokenAmount[] destTokenAmounts;
    }

    function ccipReceive(Any2EVMMessage calldata message) external;
}
