// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SessionTreasury} from "../src/SessionTreasury.sol";

/// @notice Deploy the USDC treasury on Optimism mainnet.
/// Home pays USDC directly. The other lanes are CCIP 2.0 from this treasury.
///   forge script script/DeployTreasuryOptimism.s.sol --rpc-url optimism --broadcast
contract DeployTreasuryOptimism is Script {
    address constant USDC = 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85;
    address constant ROUTER = 0x3206695CaE29952f4b0c22a169725a865bc8Ce0f;

    uint64 constant HOME = 3_734_403_246_176_062_136;
    uint64 constant ETHEREUM = 5_009_297_550_715_157_269;
    uint64 constant BASE = 15_971_525_489_660_198_786;
    uint64 constant ARBITRUM = 4_949_039_107_694_359_620;
    uint64 constant POLYGON = 4_051_577_828_743_386_545;

    function run() external {
        uint64[] memory lanes = new uint64[](4);
        lanes[0] = ETHEREUM;
        lanes[1] = BASE;
        lanes[2] = ARBITRUM;
        lanes[3] = POLYGON;
        vm.startBroadcast();
        SessionTreasury treasury = new SessionTreasury(ROUTER, USDC, HOME, lanes);
        vm.stopBroadcast();
        console2.log("SessionTreasury", address(treasury));
    }
}
