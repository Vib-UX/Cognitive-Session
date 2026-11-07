// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SessionTreasury} from "../src/SessionTreasury.sol";

/// @notice Deploy the USDC treasury on Ethereum mainnet.
/// Home pays USDC directly. The other lanes are CCIP 2.0 from this treasury.
///   forge script script/DeployTreasuryEthereum.s.sol --rpc-url ethereum --broadcast
contract DeployTreasuryEthereum is Script {
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant ROUTER = 0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D;

    uint64 constant HOME = 5_009_297_550_715_157_269;
    uint64 constant BASE = 15_971_525_489_660_198_786;
    uint64 constant ARBITRUM = 4_949_039_107_694_359_620;
    uint64 constant OPTIMISM = 3_734_403_246_176_062_136;
    uint64 constant POLYGON = 4_051_577_828_743_386_545;

    function run() external {
        uint64[] memory lanes = new uint64[](4);
        lanes[0] = BASE;
        lanes[1] = ARBITRUM;
        lanes[2] = OPTIMISM;
        lanes[3] = POLYGON;
        vm.startBroadcast();
        SessionTreasury treasury = new SessionTreasury(ROUTER, USDC, HOME, lanes);
        vm.stopBroadcast();
        console2.log("SessionTreasury", address(treasury));
    }
}
