// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CCIP} from "../src/interfaces/CCIP.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";
import {SessionTreasury} from "../src/SessionTreasury.sol";

contract SessionTreasuryTest is Test {
    uint64 constant ETHEREUM = 5_009_297_550_715_157_269;

    MockRouter router;
    MockERC20 usdc;
    SessionTreasury treasury;
    address recipient = makeAddr("recipient");

    function setUp() public {
        router = new MockRouter();
        router.setFee(0.001 ether);
        usdc = new MockERC20();
        treasury = new SessionTreasury(address(router), address(usdc), 15_971_525_489_660_198_786, new uint64[](0));
        usdc.mint(address(treasury), 10_000_000);
        vm.deal(address(this), 1 ether);
    }

    function testPaysOnBaseWithoutCcip() public {
        treasury.sendReward(treasury.homeSelector(), recipient, 750_000, "");
        assertEq(usdc.balanceOf(recipient), 750_000);
        assertEq(usdc.balanceOf(address(treasury)), 10_000_000 - 750_000);
        assertEq(router.lastMessageId(), bytes32(0));
    }

    function testPaysUsdcOnAnotherMainnet() public {
        treasury.setLane(ETHEREUM, true);
        bytes memory extra = CCIP.extraArgsV3(0);
        uint256 fee = treasury.quote(ETHEREUM, recipient, 750_000, extra);
        treasury.sendReward{value: fee}(ETHEREUM, recipient, 750_000, extra);
        assertEq(usdc.balanceOf(recipient), 750_000);
        assertEq(router.lastMessageId() != bytes32(0), true);
    }

    function testUnknownChainReverts() public {
        vm.expectRevert(SessionTreasury.LaneMissing.selector);
        treasury.sendReward(ETHEREUM, recipient, 1, CCIP.extraArgsV3(0));
    }

    function testStrangerCannotSend() public {
        treasury.setLane(ETHEREUM, true);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(SessionTreasury.NotOwner.selector);
        treasury.sendReward(ETHEREUM, recipient, 1, CCIP.extraArgsV3(0));
    }
}
