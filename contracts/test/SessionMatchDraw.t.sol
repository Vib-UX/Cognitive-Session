// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReceiverTemplate} from "../src/cre/Receiver.sol";
import {SessionMatchDraw, IVRFCoordinatorV2Plus} from "../src/SessionMatchDraw.sol";

contract MockVRF is IVRFCoordinatorV2Plus {
    uint256 public lastId = 1;
    address public consumer;

    function requestRandomWords(RandomWordsRequest calldata) external returns (uint256 requestId) {
        consumer = msg.sender;
        requestId = lastId++;
    }

    function fulfill(uint256 requestId, uint256 word) external {
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        SessionMatchDraw(consumer).rawFulfillRandomWords(requestId, words);
    }
}

contract SessionMatchDrawTest is Test {
    MockVRF vrf;
    SessionMatchDraw draw;
    address forwarder = makeAddr("forwarder");

    function setUp() public {
        vrf = new MockVRF();
        draw = new SessionMatchDraw(forwarder, address(vrf), 1, keccak256("key"));
    }

    function testReportRequestsVrfAndEvenWordMakesFirstWhite() public {
        bytes32 pairId = keccak256("pair");
        bytes memory report = abi.encode(pairId, keccak256("sess_a"), keccak256("sess_b"));

        vm.prank(forwarder);
        draw.onReport("", report);

        (,,, uint256 requestId,, bool fulfilled,) = draw.draws(pairId);
        assertEq(requestId, 1);
        assertFalse(fulfilled);

        vrf.fulfill(1, 4);
        (,,,, uint256 word, bool done, bool white) = draw.draws(pairId);
        assertEq(word, 4);
        assertTrue(done);
        assertTrue(white);
    }

    function testOddWordMakesFirstBlack() public {
        bytes32 pairId = keccak256("odd");
        vm.prank(forwarder);
        draw.onReport("", abi.encode(pairId, keccak256("a"), keccak256("b")));
        vrf.fulfill(1, 5);
        (,,,,,, bool white) = draw.draws(pairId);
        assertFalse(white);
    }

    function testStrangerCannotReportOrFulfill() public {
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, address(this)));
        draw.onReport("", abi.encode(keccak256("x"), keccak256("a"), keccak256("b")));

        vm.expectRevert(abi.encodeWithSelector(SessionMatchDraw.OnlyCoordinator.selector, address(this)));
        uint256[] memory words = new uint256[](1);
        words[0] = 1;
        draw.rawFulfillRandomWords(1, words);
    }
}
