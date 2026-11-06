// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SessionTreasury} from "../src/SessionTreasury.sol";

/// @notice Deploy the USDC treasury on Base mainnet.
/// The broadcaster becomes the owner, so use the same key the relay holds.
///   forge script script/DeployTreasury.s.sol --rpc-url base --broadcast
contract DeployTreasury is Script {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant ROUTER = 0x881e3A65B4d4a04dD529061dd0071cf975F58bCD;

    uint64 constant ETHEREUM = 5_009_297_550_715_157_269;
    uint64 constant ARBITRUM = 4_949_039_107_694_359_620;
    uint64 constant OPTIMISM = 3_734_403_246_176_062_136;
    uint64 constant POLYGON = 4_051_577_828_743_386_545;

    function run() external {
        vm.startBroadcast();
        SessionTreasury treasury = new SessionTreasury(ROUTER, USDC);
        treasury.setLane(ETHEREUM, true);
        treasury.setLane(ARBITRUM, true);
        treasury.setLane(OPTIMISM, true);
        treasury.setLane(POLYGON, true);
        vm.stopBroadcast();
        console2.log("SessionTreasury", address(treasury));
    }
}
