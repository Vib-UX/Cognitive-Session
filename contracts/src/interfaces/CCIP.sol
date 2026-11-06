// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal CCIP message types used by SessionLock / SessionPayout.
library CCIP {
    struct EVMTokenAmount {
        address token;
        uint256 amount;
    }

    struct EVM2AnyMessage {
        bytes receiver;
        bytes data;
        EVMTokenAmount[] tokenAmounts;
        bytes extraArgs;
        address feeToken;
    }

    bytes4 internal constant EXTRA_ARGS_V1_TAG = 0x97a657c9;

    function extraArgsV1(uint256 gasLimit) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, gasLimit);
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
