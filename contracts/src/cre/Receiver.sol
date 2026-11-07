// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts@5.3.0/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts@5.3.0/utils/introspection/IERC165.sol";

interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @notice Consumer side of a CRE write. The Keystone forwarder is the only caller.
abstract contract ReceiverTemplate is IReceiver, Ownable {
    error InvalidSender(address sender);

    address private s_forwarderAddress;

    constructor(address initialForwarder) Ownable(msg.sender) {
        s_forwarderAddress = initialForwarder;
    }

    function setForwarder(address nextForwarder) external onlyOwner {
        s_forwarderAddress = nextForwarder;
    }

    function forwarderAddress() public view returns (address) {
        return s_forwarderAddress;
    }

    function onReport(bytes calldata, bytes calldata report) external override {
        if (msg.sender != s_forwarderAddress) revert InvalidSender(msg.sender);
        _processReport(report);
    }

    function _processReport(bytes calldata report) internal virtual;

    function supportsInterface(bytes4 interfaceId) public view virtual returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
