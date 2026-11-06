// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SessionNameRegistry} from "../src/SessionNameRegistry.sol";

contract SessionNameRegistryTest is Test {
    SessionNameRegistry registry;
    address owner_ = makeAddr("owner");

    function setUp() public {
        registry = new SessionNameRegistry("session.eth");
    }

    function testRegisterAndResolve() public {
        vm.prank(owner_);
        bytes32 node = registry.register("riya", owner_, "claude");
        assertEq(registry.owners(node), owner_);
        assertEq(registry.addr(node), owner_);
        assertEq(registry.text(node, "host"), "claude");
        assertEq(registry.nameToNode("riya.session.eth"), node);
    }

    function testOnlyOwnerEditsRecords() public {
        vm.prank(owner_);
        bytes32 node = registry.register("alex", owner_, "cursor");
        address other = makeAddr("other");
        vm.prank(other);
        vm.expectRevert(SessionNameRegistry.NotOwner.selector);
        registry.setText(node, "host", "claude");
    }
}
