// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {SessionMatchDraw} from "../src/SessionMatchDraw.sol";

/// @notice Deploys the Base consumer. Not broadcast by the build.
/// The forwarder below is the local-simulation MockKeystoneForwarder. Do not leave LINK
/// on a subscription whose consumer trusts that forwarder.
contract DeployMatchDraw is Script {
    address constant FORWARDER = 0x5E342a8438B4f5d39e72875FCee6f76B39CCE548;
    address constant COORDINATOR = 0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634;
    bytes32 constant KEY_HASH = 0xdc2f87677b01473c763cb0aee938ed3341512f6057324a584e5944e786144d70;

    function run() external {
        uint256 subscriptionId = vm.envUint("VRF_SUBSCRIPTION_ID");
        vm.startBroadcast();
        new SessionMatchDraw(FORWARDER, COORDINATOR, subscriptionId, KEY_HASH);
        vm.stopBroadcast();
    }
}
