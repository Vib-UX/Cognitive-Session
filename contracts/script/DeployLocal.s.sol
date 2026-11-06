// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SessionLock} from "../src/SessionLock.sol";
import {SessionPayout} from "../src/SessionPayout.sol";
import {SessionNameRegistry} from "../src/SessionNameRegistry.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";

/// @notice Local / mock deploy for demos when real CCIP routers are unavailable.
contract DeployLocal is Script {
    uint64 constant SEPOLIA_SELECTOR = 16015286601757825753;
    uint64 constant BASE_SEPOLIA_SELECTOR = 10344971235874465080;

    function run() external {
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0xA11CE));
        address referee = vm.envOr("REFEREE", vm.addr(pk));

        vm.startBroadcast(pk);
        MockRouter router = new MockRouter();
        router.setFee(0);
        SessionPayout payout = new SessionPayout(address(router), BASE_SEPOLIA_SELECTOR, address(0));
        SessionLock lock = new SessionLock(address(router), SEPOLIA_SELECTOR, address(payout), referee);
        payout.setExpectedSender(address(lock));
        SessionNameRegistry names = new SessionNameRegistry("session.eth");
        vm.stopBroadcast();

        console2.log("MockRouter", address(router));
        console2.log("SessionLock", address(lock));
        console2.log("SessionPayout", address(payout));
        console2.log("SessionNameRegistry", address(names));
    }
}
