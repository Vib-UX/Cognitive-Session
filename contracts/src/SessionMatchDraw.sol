// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverTemplate} from "./cre/Receiver.sol";

interface IVRFCoordinatorV2Plus {
    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }

    function requestRandomWords(RandomWordsRequest calldata req) external returns (uint256 requestId);
}

/// @notice CRE report of a relay pair, then one Base VRF v2.5 word for the opening color.
contract SessionMatchDraw is ReceiverTemplate {
    error EmptyPair();
    error AlreadyDrawn();
    error UnknownRequest();
    error OnlyCoordinator(address sender);

    /// @dev abi.encodeWithSelector(bytes4(keccak256("VRF ExtraArgsV1")), false) pays in LINK.
    bytes4 public constant EXTRA_ARGS_V1_TAG = 0x92fd1338;

    address public immutable coordinator;
    uint256 public immutable subscriptionId;
    bytes32 public immutable keyHash;

    struct Draw {
        bytes32 pairId;
        bytes32 first;
        bytes32 second;
        uint256 requestId;
        uint256 word;
        bool fulfilled;
        bool whiteIsFirst;
    }

    mapping(bytes32 pairId => Draw draw) public draws;
    mapping(uint256 requestId => bytes32 pairId) public requestToPair;

    event DrawRequested(bytes32 indexed pairId, uint256 indexed requestId, bytes32 first, bytes32 second);
    event DrawFulfilled(bytes32 indexed pairId, uint256 indexed requestId, uint256 word, bool whiteIsFirst);

    constructor(address forwarder, address coordinator_, uint256 subscriptionId_, bytes32 keyHash_)
        ReceiverTemplate(forwarder)
    {
        coordinator = coordinator_;
        subscriptionId = subscriptionId_;
        keyHash = keyHash_;
    }

    function _processReport(bytes calldata report) internal override {
        (bytes32 pairId, bytes32 first, bytes32 second) = abi.decode(report, (bytes32, bytes32, bytes32));
        if (pairId == bytes32(0)) revert EmptyPair();
        if (draws[pairId].requestId != 0) revert AlreadyDrawn();

        uint256 requestId = IVRFCoordinatorV2Plus(coordinator).requestRandomWords(
            IVRFCoordinatorV2Plus.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: 3,
                callbackGasLimit: 200_000,
                numWords: 1,
                extraArgs: abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, false)
            })
        );

        draws[pairId] = Draw({
            pairId: pairId,
            first: first,
            second: second,
            requestId: requestId,
            word: 0,
            fulfilled: false,
            whiteIsFirst: false
        });
        requestToPair[requestId] = pairId;
        emit DrawRequested(pairId, requestId, first, second);
    }

    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != coordinator) revert OnlyCoordinator(msg.sender);
        bytes32 pairId = requestToPair[requestId];
        if (pairId == bytes32(0)) revert UnknownRequest();
        Draw storage draw = draws[pairId];
        uint256 word = randomWords[0];
        draw.word = word;
        draw.fulfilled = true;
        draw.whiteIsFirst = word % 2 == 0;
        emit DrawFulfilled(pairId, requestId, word, draw.whiteIsFirst);
    }
}
