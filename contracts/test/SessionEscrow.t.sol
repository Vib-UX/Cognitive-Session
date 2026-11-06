// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SessionLock} from "../src/SessionLock.sol";
import {SessionPayout} from "../src/SessionPayout.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";

contract SessionEscrowTest is Test {
    MockRouter router;
    SessionLock lock;
    SessionPayout payout;

    address playerA = makeAddr("a");
    address playerB = makeAddr("b");
    uint256 refereePk = 0xA11CE;
    address referee;

    uint64 constant DEST = 16015286601757825753; // Ethereum Sepolia selector
    uint64 constant SRC = 10344971235874465080; // Base Sepolia selector

    function setUp() public {
        referee = vm.addr(refereePk);
        router = new MockRouter();
        router.setFee(0);
        payout = new SessionPayout(address(router), SRC, address(0));
        lock = new SessionLock(address(router), DEST, address(payout), referee);
        payout.setExpectedSender(address(lock));

        vm.deal(playerA, 10 ether);
        vm.deal(playerB, 10 ether);
    }

    function _id() internal pure returns (bytes32) {
        return keccak256("match_demo");
    }

    function _sign(uint256 pk, bytes32 matchId, SessionLock.Outcome outcome) internal pure returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n52", matchId, uint8(outcome)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function testDepositAndRefereeSettle() public {
        bytes32 matchId = _id();
        vm.prank(playerA);
        lock.deposit{value: 0.01 ether}(matchId, playerA, playerB);
        vm.prank(playerB);
        lock.deposit{value: 0.01 ether}(matchId, playerA, playerB);
        assertTrue(lock.bothDeposited(matchId));

        uint256 beforeA = playerA.balance;
        bytes memory sig = _sign(refereePk, matchId, SessionLock.Outcome.PlayerA);
        lock.settleReferee(matchId, SessionLock.Outcome.PlayerA, sig);

        assertTrue(payout.settled(matchId));
        assertEq(payout.winners(matchId), playerA);
        assertGt(playerA.balance, beforeA);
    }

    function testRefundWhenOnlyOneDeposits() public {
        bytes32 matchId = _id();
        vm.prank(playerA);
        lock.deposit{value: 0.01 ether}(matchId, playerA, playerB);

        vm.warp(block.timestamp + 2 hours);
        uint256 before = playerA.balance;
        lock.refund(matchId);
        assertEq(playerA.balance, before + 0.01 ether);
    }

    function testDrawSplits() public {
        bytes32 matchId = keccak256("draw");
        vm.prank(playerA);
        lock.deposit{value: 0.02 ether}(matchId, playerA, playerB);
        vm.prank(playerB);
        lock.deposit{value: 0.02 ether}(matchId, playerA, playerB);

        uint256 beforeA = playerA.balance;
        uint256 beforeB = playerB.balance;
        bytes memory sig = _sign(refereePk, matchId, SessionLock.Outcome.Draw);
        lock.settleReferee(matchId, SessionLock.Outcome.Draw, sig);

        assertEq(playerA.balance, beforeA + 0.02 ether);
        assertEq(playerB.balance, beforeB + 0.02 ether);
    }
}
