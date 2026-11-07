// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {BurnMintERC677Helper} from "@chainlink/local/src/ccip/BurnMintERC677Helper.sol";
import {CCIPLocalSimulator} from "@chainlink/local/src/ccip/CCIPLocalSimulator.sol";
import {CCIP} from "../src/interfaces/CCIP.sol";
import {SessionTreasury} from "../src/SessionTreasury.sol";

/// @notice Sends a reward through Chainlink's CCIPLocalSimulator (v0.3.1).
/// The simulator has one chain selector and pays in CCIP-BnM, not Base USDC.
contract SessionTreasurySimulatorTest is Test {
    function testOfficialSimulatorDeliversBnM() public {
        CCIPLocalSimulator simulator = new CCIPLocalSimulator();
        (
            uint64 chainSelector,
            IRouterClient sourceRouter,
            ,
            ,
            ,
            BurnMintERC677Helper bnM,
        ) = simulator.configuration();

        SessionTreasury treasury = new SessionTreasury(address(sourceRouter), address(bnM), 1, new uint64[](0));
        treasury.setLane(chainSelector, true);
        bnM.drip(address(treasury));

        address recipient = makeAddr("recipient");
        uint256 amount = 1e18;
        bytes memory extra = CCIP.extraArgsV3(0);
        assertEq(extra.length, 19);

        uint256 fee = treasury.quote(chainSelector, recipient, amount, extra);
        treasury.sendReward{value: fee}(chainSelector, recipient, amount, extra);

        assertEq(bnM.balanceOf(recipient), amount);
        assertEq(bnM.balanceOf(address(treasury)), 0);
    }
}
