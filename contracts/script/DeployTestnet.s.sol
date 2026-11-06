// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SessionLock} from "../src/SessionLock.sol";
import {SessionPayout} from "../src/SessionPayout.sol";
import {SessionNameRegistry} from "../src/SessionNameRegistry.sol";

/// @notice Deploy payout on Ethereum Sepolia, then lock on Base Sepolia with the real CCIP router.
/// Set ROUTER_SEPOLIA, ROUTER_BASE_SEPOLIA, PRIVATE_KEY, REFEREE in the env.
contract DeployTestnet is Script {
    uint64 constant SEPOLIA_SELECTOR = 16015286601757825753;
    uint64 constant BASE_SEPOLIA_SELECTOR = 10344971235874465080;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address referee = vm.envAddress("REFEREE");
        address routerSepolia = vm.envAddress("ROUTER_SEPOLIA");
        address routerBase = vm.envAddress("ROUTER_BASE_SEPOLIA");

        // 1) Deploy payout + name registry on Sepolia
        vm.createSelectFork(vm.envString("SEPOLIA_RPC_URL"));
        vm.startBroadcast(pk);
        SessionPayout payout = new SessionPayout(routerSepolia, BASE_SEPOLIA_SELECTOR, address(0));
        SessionNameRegistry names = new SessionNameRegistry("session.eth");
        vm.stopBroadcast();
        console2.log("SessionPayout", address(payout));
        console2.log("SessionNameRegistry", address(names));

        // 2) Deploy lock on Base Sepolia pointing at payout
        vm.createSelectFork(vm.envString("BASE_SEPOLIA_RPC_URL"));
        vm.startBroadcast(pk);
        SessionLock lock = new SessionLock(routerBase, SEPOLIA_SELECTOR, address(payout), referee);
        vm.stopBroadcast();
        console2.log("SessionLock", address(lock));

        // 3) Point payout at the lock sender (back on Sepolia)
        vm.createSelectFork(vm.envString("SEPOLIA_RPC_URL"));
        vm.startBroadcast(pk);
        payout.setExpectedSender(address(lock));
        vm.stopBroadcast();
    }
}
